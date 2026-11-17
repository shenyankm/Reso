# /// script
# requires-python = ">=3.11"
# dependencies = ["pglast==7.23"]
# ///
"""Parse database review drafts offline. Never connect to PostgreSQL or execute SQL."""
import argparse
import copy
import hashlib
import json
from pathlib import Path

from pglast.parser import parse_sql_json
from pglast import split
from database_artifacts import load_json, self_test as check_artifact_json

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'docs/database-drafts'


def parse(source):
    return [clean(s['stmt']) for s in json.loads(parse_sql_json(source))['stmts']]


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if k != 'location'}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from walk(child)
    elif isinstance(value, list):
        for child in value: yield from walk(child)


def columns(items):
    return tuple(item['String']['sval'] for item in items)


def m1_migrations(write=False):
    """The two opt-in files must reconstruct the reviewed cumulative M1 exactly."""
    a, b = [(DIRECTORY / name).read_text() for name in ('wang-m1a.sql', 'wang-m1.sql')]
    first, full = parse(a)[1:-1], parse(b)[1:-1]
    identity = lambda node: json.dumps(node, sort_keys=True)
    first_keys = {identity(n) for n in first}
    assert len(first_keys) == len(first)
    assert first_keys <= {identity(n) for n in full}, 'M1a is not a statement subset of M1'
    first_sql, full_sql = split(a)[1:-1], split(b)[1:-1]
    assert len(first_sql) == len(first) and len(full_sql) == len(full)
    remaining = [s for n, s in zip(full, full_sql) if identity(n) not in first_keys]
    for name, statements in [('0008_m1a_expand.sql', first_sql), ('0009_m1_foundation_expand.sql', remaining)]:
        path = ROOT / 'server/migrations/m1' / name
        expected = '-- Explicit opt-in M1 batch. Default API/Worker remain on 0001-0007.\n-- Transaction and checksum ledger are owned by server/migrations.ts.\n\n' + ';\n\n'.join(statements) + ';\n'
        if write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected)
        else:
            assert path.read_text() == expected, ('M1 batch drift; run --write-m1-migrations', name)
        assert not any('TransactionStmt' in n for n in parse(expected)), 'Nested COMMIT would defeat migration rollback'
    assert {identity(n) for n in first + parse(';\n'.join(remaining) + ';')} == {identity(n) for n in full}
    return {'m1a_statements': len(first), 'm1_increment_statements': len(remaining), 'cumulative_statements': len(full)}


def relation(node):
    assert node.get('schemaname', 'public') == 'public', 'Unexpected schema'
    return node['relname']


def sql_type(node):
    node = clean(node)
    names = columns(node['names'])
    # SERIAL declarations in the original schema represent integer FK targets.
    serial = {'smallserial': 'int2', 'serial': 'int4', 'bigserial': 'int8'}
    if names[-1] in serial:
        node['names'] = [{'String': {'sval': 'pg_catalog'}}, {'String': {'sval': serial[names[-1]]}}]
    return node


def expected_column(field, nullable):
    default = field['default']
    if default is not None:
        literal = default if default.endswith('()') or default.startswith('ARRAY') or default in ('true', 'false') or default.lstrip('-').isdigit() else "'" + default.replace("'", "''") + "'" + ('::jsonb' if field['type'] == 'jsonb' else '')
    source = 'CREATE TABLE x (c ' + field['type'] + ('' if nullable else ' NOT NULL') + ('' if default is None else ' DEFAULT ' + literal) + ')'
    return parse(source)[0]['CreateStmt']['tableElts'][0]['ColumnDef']


def column_signature(node):
    constraints = [c['Constraint'] for c in node.get('constraints', [])]
    defaults = [clean(c['raw_expr']) for c in constraints if c['contype'] == 'CONSTR_DEFAULT']
    assert len(defaults) <= 1
    return sql_type(node['typeName']), any(c['contype'] in ('CONSTR_NOTNULL', 'CONSTR_PRIMARY') for c in constraints), defaults


def predicate_value(node, row):
    """Offline vectors for the bounded enum/parent CHECK subset, with SQL NULL logic."""
    if 'ColumnRef' in node: return row.get(columns(node['ColumnRef']['fields'])[0])
    if 'A_Const' in node:
        value = node['A_Const']
        if value.get('isnull'): return None
        if 'sval' in value: return value['sval']['sval']
        if 'boolval' in value: return value['boolval'].get('boolval', False)
        return value['ival'].get('ival', 0)
    if 'List' in node: return [predicate_value(n, row) for n in node['List']['items']]
    if 'BoolExpr' in node:
        expr = node['BoolExpr']; values = [predicate_value(n, row) for n in expr['args']]
        if expr['boolop'] == 'AND_EXPR': return False if False in values else None if None in values else True
        if expr['boolop'] == 'OR_EXPR': return True if True in values else None if None in values else False
        assert expr['boolop'] == 'NOT_EXPR'
        return None if values[0] is None else not values[0]
    if 'NullTest' in node:
        expr = node['NullTest']; empty = predicate_value(expr['arg'], row) is None
        assert expr['nulltesttype'] in ('IS_NULL', 'IS_NOT_NULL')
        return empty if expr['nulltesttype'] == 'IS_NULL' else not empty
    if 'BooleanTest' in node:
        expr = node['BooleanTest']; assert expr['booltesttype'] == 'IS_TRUE'
        return predicate_value(expr['arg'], row) is True
    if 'FuncCall' in node:
        expr = node['FuncCall']; name, = columns(expr['funcname']); values = [predicate_value(n, row) for n in expr['args']]
        if name == 'num_nonnulls': return sum(v is not None for v in values)
        assert name == 'jsonb_typeof' and len(values) == 1
        return None if values[0] is None else 'object' if isinstance(values[0], dict) else 'array' if isinstance(values[0], list) else 'string'
    expr = node['A_Expr']; op, = columns(expr['name'])
    left, right = (predicate_value(expr[k], row) for k in ('lexpr', 'rexpr'))
    if op == '->>': return left.get(right) if isinstance(left, dict) else None
    if left is None or right is None: return None
    if expr['kind'] == 'AEXPR_IN': return (left in right) if op == '=' else (left not in right)
    assert op in ('=', '<>')
    return left == right if op == '=' else left != right


def check(source, manifest, model):
    tables = {t['name']: t for t in model['tables']}
    created = set(manifest['create_tables'])
    expanded = manifest['expand_columns']
    altered = created | set(expanded) | set(manifest['parent_unique_keys'])
    assert manifest['design_version'] == model['design_version']
    assert manifest['stage'] in ('M1a-expand-review-only', 'M1-expand-review-only', 'M2-cumulative-expand-review-only', 'M3-cumulative-expand-review-only', 'M4-cumulative-expand-review-only')
    phases = tuple('M' + str(i) for i in range(1, int(manifest['stage'][1]) + 1))
    for table in tables.values():
        for field in table['fields']:
            if (field['default'] or '').startswith('ARRAY'):
                assert not any('ColumnRef' in node for expr in column_signature(expected_column(field, field['nullable']))[2] for node in walk(expr)), (table['name'], field['name'], 'array default contains an identifier')
    assert created and all(tables[t]['mode'] == '新增' and tables[t]['phase'] in phases for t in created)
    assert all(t in model['baseline_columns'] for t in expanded)
    if manifest['stage'] != 'M1a-expand-review-only':
        assert created == {t['name'] for t in tables.values() if t['phase'] in phases and t['mode'] == '新增'}, 'Incomplete phase creation scope'
        for table in tables.values():
            name = table['name']
            if table['phase'] in phases and table['mode'] in ('扩展', '重构'):
                needed = {f['name'] for f in table['fields'] if f['name'] not in model['baseline_columns'][name] and name + '.' + f['name'] not in manifest['deferred_columns']}
                assert set(expanded.get(name, [])) == needed, (name, 'Incomplete phase expand scope')
    schema = {'user': {'id': expected_column({'type': 'text', 'default': None}, False)}}
    keys = {'user': {('id',)}}
    index_names = set()
    unique_nodes = {}
    added, actual_created, names = {}, set(), set()
    foreign_keys, checks, indexes, exclusions, extensions, rls = [], [], [], [], [], {t: set() for t in created}

    def constraint(table, node, col=None, draft=True):
        if draft:
            name = node.get('conname')
            assert name and len(name.encode()) <= 63 and (table, name) not in names, 'Duplicate or unnamed constraint'
            names.add((table, name))
        kind = node['contype']
        if kind in ('CONSTR_PRIMARY', 'CONSTR_UNIQUE'):
            assert not node.get('deferrable') and not node.get('initdeferred'), 'Referenced candidate keys must not be deferrable'
            key = (col,) if col else columns(node['keys'])
            index_name = node.get('conname') or table + ('_pkey' if kind == 'CONSTR_PRIMARY' else '_' + '_'.join(key) + '_key')
            assert index_name not in index_names, 'Duplicate constraint index name'
            index_names.add(index_name)
            keys.setdefault(table, set()).add(key)
            if draft: unique_nodes[table, node['conname']] = node
        elif draft and kind == 'CONSTR_FOREIGN':
            foreign_keys.append((table, node))
        elif draft and kind == 'CONSTR_CHECK':
            checks.append((table, node['raw_expr'], node['conname']))
        elif draft and kind == 'CONSTR_EXCLUSION':
            assert 'M3' in phases and table == 'appointments'
            assert node['conname'] not in index_names
            index_names.add(node['conname']);exclusions.append((table, node))

    for migration in model['baseline_migrations']:
        path = ROOT / 'server/migrations' / migration['name']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == migration['checksum'], path.name
        for stmt in parse(path.read_text()):
            if 'CreateStmt' in stmt:
                node = stmt['CreateStmt']; table = relation(node['relation'])
                schema.setdefault(table, {})
                for item in node.get('tableElts', []):
                    if 'ColumnDef' in item:
                        col = item['ColumnDef']; schema[table][col['colname']] = col
                        for c in col.get('constraints', []): constraint(table, c['Constraint'], col['colname'], False)
                    elif 'Constraint' in item: constraint(table, item['Constraint'], draft=False)
            elif 'AlterTableStmt' in stmt:
                node = stmt['AlterTableStmt']; table = relation(node['relation'])
                for item in node['cmds']:
                    cmd = item['AlterTableCmd']
                    if cmd['subtype'] == 'AT_AddColumn':
                        col = cmd['def']['ColumnDef']; schema[table][col['colname']] = col
                    elif cmd['subtype'] == 'AT_AddConstraint': constraint(table, cmd['def']['Constraint'], draft=False)
            elif 'IndexStmt' in stmt:
                name = stmt['IndexStmt']['idxname']
                assert name not in index_names, 'Duplicate baseline index name'
                index_names.add(name)

    statements = parse(source)
    assert statements[0] == {'TransactionStmt': {'kind': 'TRANS_STMT_BEGIN'}}
    assert statements[-1] == {'TransactionStmt': {'kind': 'TRANS_STMT_COMMIT'}}
    for stmt in statements[1:-1]:
        if 'CreateExtensionStmt' in stmt:
            assert 'M3' in phases
            assert stmt == parse('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;')[0], 'Unreviewed extension or schema'
            extensions.append('btree_gist')
        elif 'CreateStmt' in stmt:
            node = stmt['CreateStmt']; table = relation(node['relation'])
            assert table in created and table not in schema and not node.get('if_not_exists'), 'Unexpected table creation'
            actual_created.add(table); schema[table] = {}
            for item in node['tableElts']:
                if 'ColumnDef' in item:
                    col = item['ColumnDef']; name = col['colname']
                    assert name not in schema[table]
                    schema[table][name] = col; added[(table, name)] = col
                    for c in col.get('constraints', []):
                        assert c['Constraint']['contype'] in ('CONSTR_NOTNULL', 'CONSTR_DEFAULT')
                else: constraint(table, item['Constraint'])
        elif 'AlterTableStmt' in stmt:
            node = stmt['AlterTableStmt']; table = relation(node['relation'])
            assert table in altered, 'Unexpected table alteration'
            for item in node['cmds']:
                cmd = item['AlterTableCmd']; subtype = cmd['subtype']
                if subtype == 'AT_AddColumn':
                    col = cmd['def']['ColumnDef']; name = col['colname']
                    assert name in expanded.get(table, []) and name not in schema[table]
                    schema[table][name] = col; added[(table, name)] = col
                elif subtype == 'AT_AddConstraint': constraint(table, cmd['def']['Constraint'])
                else:
                    assert table in created and subtype in ('AT_EnableRowSecurity', 'AT_ForceRowSecurity'), 'Destructive or unreviewed ALTER'
                    rls[table].add(subtype)
        elif 'IndexStmt' in stmt:
            node = stmt['IndexStmt']; table = relation(node['relation'])
            assert table in altered and not node.get('concurrent') and not node.get('if_not_exists')
            assert node['idxname'] not in index_names, 'Index name collides with the existing schema'
            index_names.add(node['idxname'])
            cols = tuple(p['IndexElem']['name'] for p in node['indexParams'])
            assert set(cols) <= set(schema[table])
            indexes.append((table, node))
            if node.get('unique') and not node.get('whereClause'): keys.setdefault(table, set()).add(cols)
        else:
            raise AssertionError('Only additive DDL is permitted: ' + str(list(stmt)))

    assert actual_created == created
    expected = {(t, f['name']): f for t in created for f in tables[t]['fields'] if t + '.' + f['name'] not in manifest['deferred_columns']}
    expected.update({(t, f['name']): f for t, cols in expanded.items() for f in tables[t]['fields'] if f['name'] in cols})
    assert set(added) == set(expected), 'Draft column coverage drift'
    for (table, name), field in expected.items():
        field = dict(field)
        if table + '.' + name in manifest.get('expand_default_overrides', {}):
            assert table + '.' + name in manifest['expand_nullable']
            field['default'] = manifest['expand_default_overrides'][table + '.' + name]
        nullable = field['nullable'] or table + '.' + name in manifest['expand_nullable']
        assert column_signature(added[table, name]) == column_signature(expected_column(field, nullable)), (table, name, 'type/nullability/default drift')
    for field in manifest['deferred_columns']:
        table, col = field.split('.')
        assert col not in schema[table] and any(f['name'] == col for f in tables[table]['fields'])
    assert all(v == {'AT_EnableRowSecurity', 'AT_ForceRowSecurity'} for v in rls.values()), 'New tables must deny runtime access'

    examples = load_json((ROOT / 'docs/database-contract-examples-v2.json').read_text())['field_examples']
    json_kinds = {}
    for table, expression, _ in checks:
        for node in walk(expression):
            if 'ColumnRef' in node:
                refs = columns(node['ColumnRef']['fields'])
                assert len(refs) == 1 and refs[0] in schema[table], (table, 'CHECK uses an unavailable column', refs)
            expr = node.get('A_Expr', {})
            function = expr.get('lexpr', {}).get('FuncCall', {})
            if columns(expr.get('name', [])) != ('=',) or columns(function.get('funcname', [])) != ('jsonb_typeof',): continue
            col = columns(function['args'][0]['ColumnRef']['fields'])
            assert len(col) == 1 and col[0] in schema[table]
            kind = expr['rexpr']['A_Const']['sval']['sval']
            json_kinds.setdefault((table, col[0]), set()).add(kind)
    for (table, name), field in expected.items():
        if field['type'] == 'jsonb':
            sample = examples[table + '.' + name]['valid']
            assert json_kinds.get((table, name)) == {'object' if isinstance(sample, dict) else 'array'}, (table, name, 'JSON container drift')
    actual_checks = {table + '.' + name: expr for table, expr, name in checks}
    skill_plan = 'cardinality(skill_codes) BETWEEN 1 AND 8 AND array_ndims(skill_codes) = 1 AND array_lower(skill_codes,1) = 1 AND array_position(skill_codes,NULL) IS NULL AND skill_codes[1] = skill_code'
    for key, expression in {
        'agent_policy_rules.ck_rule_schema': 'schema_version = 2',
        'agent_policy_rules.ck_rule_skill_plan': skill_plan,
        'agent_decisions.ck_decision_schemas': 'assessment_schema_version = 2 AND route_schema_version = 2 AND gate_schema_version = 1',
    }.items():
        assert actual_checks.get(key) == parse('SELECT 1 WHERE ' + expression)[0]['SelectStmt']['whereClause'], (key, 'native skill schema drift')
    positive_branches = 0
    if 'record_versions' in created:
        types = ['understanding'] + (['narrative', 'nvc', 'roleplay'] if 'M2' in phases else []) + (['professional_note'] if 'M3' in phases else [])
        scopes = ['account', 'event', 'conversation', 'understanding', 'record_version', 'message'] + (['assessment_session', 'exercise'] if 'M2' in phases else []) + (['research_participant', 'corpus_asset'] if 'M4' in phases else [])
        assert manifest['restricted_kinds']['record_versions.content.type'] == types
        assert manifest['restricted_kinds']['data_requests.scope_kind'] == scopes
        content = "(content->>'type' = 'understanding' AND understanding_id IS NOT NULL)"
        if 'M2' in phases: content += " OR (content->>'type' IN ('narrative','nvc','roleplay') AND exercise_id IS NOT NULL)"
        if 'M3' in phases: content += " OR (content->>'type' = 'professional_note' AND note_application_id IS NOT NULL)"
        content = '(' + content + ') IS TRUE'
        scope_check = 'scope_kind IN (' + ','.join("'" + s + "'" for s in scopes) + ')'
        for key, expr in {'record_versions.ck_record_content_parent': content, 'data_requests.ck_request_scope_kind': scope_check}.items():
            assert actual_checks.get(key) == parse('SELECT 1 WHERE ' + expr)[0]['SelectStmt']['whereClause'], (key, 'phase range or parent pairing drift')
        # An additional predecessor CHECK can silently intersect a correct enum.
        # Inspect every constraint that restricts these fields, not just the desired one.
        for table, expr, name in checks:
            refs = {columns(n['ColumnRef']['fields'])[0] for n in walk(expr) if 'ColumnRef' in n}
            if table == 'record_versions' and 'content' in refs:
                assert name in ('ck_record_content_parent', 'ck_record_versions_containers'), ('extra record content restriction', name)
            if table == 'data_requests' and 'scope_kind' in refs:
                typed = 'ck_request_m4_scope' if 'M4' in phases else 'ck_request_m2_scope' if 'M2' in phases else 'ck_request_m1_scope'
                allowed = ('ck_request_scope_kind', typed) + (('ck_research_requester',) if 'M4' in phases else ())
                assert name in allowed, ('extra request scope restriction', name)
        content_checks = [expr for table, expr, _ in checks if table == 'record_versions' and any('ColumnRef' in n and columns(n['ColumnRef']['fields']) == ('content',) for n in walk(expr))]
        scope_checks = [expr for table, expr, _ in checks if table == 'data_requests' and any('ColumnRef' in n and columns(n['ColumnRef']['fields']) == ('scope_kind',) for n in walk(expr))]
        for kind in types:
            row = dict(content={'type': kind}, confirmation_scope={}, understanding_id='u' if kind == 'understanding' else None,
                       exercise_id='e' if kind in ('narrative', 'nvc', 'roleplay') else None, note_application_id='n' if kind == 'professional_note' else None)
            assert all(predicate_value(expr, row) is not False for expr in content_checks), ('legal content rejected', kind)
            positive_branches += 1
        for kind in scopes:
            research = kind in ('research_participant', 'corpus_asset')
            row = dict(scope_kind=kind, target_erased_at=None, status='requested', requester_kind='research_participant' if research else 'user', requester_participant_id='p' if research else None, requester_user_id=None if research else 'u')
            target = {'account': 'subject_user_id', 'research_participant': 'participant_id'}.get(kind, kind + '_id')
            row[target] = 'target'
            if kind in ('understanding', 'record_version', 'message', 'assessment_session', 'exercise'): row['conversation_id'] = 'c'
            assert all(predicate_value(expr, row) is not False for expr in scope_checks), ('legal request scope rejected', kind)
            positive_branches += 1
        assert any(predicate_value(expr, {'content': {}, 'confirmation_scope': {}}) is False for expr in content_checks), 'missing type must reject, not SQL UNKNOWN'
        assert any(predicate_value(expr, {'scope_kind': 'unregistered'}) is False for expr in scope_checks), 'unknown scope must reject'
        for key, expr in manifest['reviewed_row_checks'].items():
            assert actual_checks.get(key) == parse('SELECT 1 WHERE ' + expr)[0]['SelectStmt']['whereClause'], (key, 'reviewed row check drift')
    if len(phases) >= 2:
        required_checks = manifest['reviewed_row_checks']
        parent_check = 'record_versions.ck_record_m3_parent' if 'M3' in phases else 'record_versions.ck_record_m2_parent'
        assert {'message_cards.ck_card_typed_target', 'interaction_events.ck_interaction_target', parent_check, 'record_sources.ck_source_origin', 'record_sources.ck_source_m1_role', 'agent_method_refs.ck_method_ref_used', 'agent_method_refs.ck_method_ref_restriction', 'method_versions.ck_method_review', 'agent_actions.ck_action_native_resolution'} <= set(required_checks)
        if 'M3' in phases:
            assert {'saved_items.ck_saved_target', 'appointments.ck_appointment_time_pair', 'appointments.ck_appointment_native_confirmation', 'appointment_proposals.ck_proposal_decider', 'notification_outbox.ck_outbox_typed_target', 'notification_outbox.ck_outbox_delivery', 'notification_attempts.ck_attempt_delivery', 'notification_receipts.ck_receipt_link', 'notification_receipts.ck_receipt_identity'} <= set(required_checks)
        if 'M4' in phases:
            assert not manifest['deferred_columns'], 'Complete target still defers fields'
            assert {'consent_grants.ck_consent_m4_scope', 'consent_grants.ck_research_consent_evidence', 'data_requests.ck_request_m4_scope', 'data_requests.ck_research_requester', 'corpus_assets.ck_asset_scope', 'corpus_assets.ck_asset_review', 'corpus_assets.ck_asset_usable_sources', 'decision_cases.ck_decision_case_review', 'dataset_versions.ck_dataset_approval', 'dataset_versions.ck_dataset_release', 'evaluation_runs.ck_evaluation_provider', 'evaluation_runs.ck_evaluation_metrics_schema', 'evaluation_results.ck_evaluation_result_output', 'evaluation_reviews.ck_evaluation_reviewer', 'evaluation_reviews.ck_evaluation_review_schema', 'evaluation_reviews.ck_evaluation_safety_failure'} <= set(required_checks)
        actual_checks = {table + '.' + name: expr for table, expr, name in checks}
        for key, expr in required_checks.items():
            assert actual_checks.get(key) == parse('SELECT 1 WHERE ' + expr)[0]['SelectStmt']['whereClause'], (key, 'reviewed row check drift')

    actual_fk = {}
    delete_actions = {'RESTRICT': 'r', 'NO ACTION': 'a', 'CASCADE': 'c', 'SET NULL': 'n'}
    for table, node in foreign_keys:
        target = relation(node['pktable']); cols, parent = columns(node['fk_attrs']), columns(node['pk_attrs'])
        assert len(cols) == len(parent) and set(cols) <= set(schema[table]) and set(parent) <= set(schema[target])
        assert parent in keys[target], (node['conname'], 'FK target is not a complete candidate key')
        assert node['fk_del_action'] in ('r', 'a'), 'No new cascading deletes in this expand draft'
        assert node['fk_upd_action'] == 'a', 'No cascading key updates in this expand draft'
        for child, key in zip(cols, parent): assert sql_type(schema[table][child]['typeName']) == sql_type(schema[target][key]['typeName'])
        actual_fk[node['conname']] = (table, cols, target, parent, node['fk_del_action'], node.get('deferrable', False), node.get('initdeferred', False))
    required = [r for r in model['composite_relationships'] if r['from_table'] in altered and set(r['columns']) <= set(schema[r['from_table']]) and r['to_table'] in schema and set(r['target_columns']) <= set(schema[r['to_table']])]
    for r in required:
        assert actual_fk.get(r['name']) == (r['from_table'], tuple(r['columns']), r['to_table'], tuple(r['target_columns']), delete_actions[r['on_delete']], r['deferrable'], r['deferrable']), r['name']
    for (table, name), field in expected.items():
        if field['reference']:
            target, key = field['reference'].split('.')
            assert any(t == table and dest == target and (name, key) in zip(cols, parent) for t, cols, dest, parent, *_ in actual_fk.values()), (table, name, 'missing FK')
    for table in created | set(expanded):
        for key in tables[table].get('candidate_keys', []):
            if set(key) <= set(schema[table]): assert tuple(key) in keys[table], (table, key)
    for table, required_keys in manifest['parent_unique_keys'].items():
        assert all(tuple(k) in keys[table] for k in required_keys)
    partial = {(t, columns([{'String': {'sval': p['IndexElem']['name']}} for p in n['indexParams']])) for t, n in indexes if n.get('unique') and n.get('whereClause')}
    assert {('conversations', ('event_id',)), ('conversations', ('event_id', 'kind', 'owner_user_id')), ('conversations', ('application_id',)), ('agent_decision_rule_matches', ('decision_id',)), ('agent_tool_calls', ('conversation_id', 'request_id'))} <= partial
    predicates = {
        'uq_conversation_room': "kind = 'room'",
        'uq_conversation_private': "kind IN ('private','intake')",
        'uq_conversation_application': "kind = 'professional'",
        'uq_decision_selected_rule': "outcome = 'selected'",
        'uq_tool_request': 'request_id IS NOT NULL',
    }
    if 'guardian_links' in created: predicates['uq_guardian_unclosed'] = "status IN ('pending','verified')"
    if 'safety_cases' in created: predicates['uq_safety_unclosed'] = "status IN ('open','assigned','handling','followup')"
    if len(phases) >= 2: predicates['uq_invite_request'] = 'created_by IS NOT NULL AND request_id IS NOT NULL'
    if 'M3' in phases:
        predicates.update(uq_proposal_pending="status = 'pending'", uq_people_linked='linked_user_id IS NOT NULL AND archived_at IS NULL', uq_saved_record='record_version_id IS NOT NULL', uq_saved_media='record_version_id IS NULL', uq_attempt_message='provider_message_id IS NOT NULL')
    if 'M4' in phases:
        predicates['uq_asset_session_version'] = "asset_scope = 'session'"
        predicates['uq_asset_primary_subject'] = 'is_primary'
    indexed = {node['idxname']: node for _, node in indexes}
    assert len(indexed) == len(indexes), 'Duplicate new index name'
    for name, predicate in predicates.items():
        node = indexed[name]
        assert node.get('unique') and node.get('whereClause') == parse('SELECT 1 WHERE ' + predicate)[0]['SelectStmt']['whereClause'], name
    if 'safety_cases' in created: assert indexed['uq_safety_unclosed'].get('nulls_not_distinct'), 'Unknown subjects still require one open safety case'
    if 'M3' in phases:
        assert extensions == manifest['reviewed_extensions'] == ['btree_gist']
        assert {node['conname'] for _, node in exclusions} == set(manifest['reviewed_exclusions']) == {'ex_appointment_consultant', 'ex_appointment_applicant'}
        for _, node in exclusions:
            expected = parse(manifest['reviewed_exclusions'][node['conname']])[0]['AlterTableStmt']['cmds'][0]['AlterTableCmd']['def']['Constraint']
            assert node == expected, (node['conname'], 'exclusion shape drift')
    if 'M4' in phases:
        stream = unique_nodes['evaluation_reviews', 'uq_eval_review_stream']
        assert stream.get('nulls_not_distinct') and columns(stream['keys']) == ('evaluation_result_id','reviewer_kind','reviewer_user_id','judge_provider_code','judge_model','rubric_version','revision'), 'Review revision uniqueness drift'
    return {'created_tables': len(created), 'expanded_tables': len(expanded), 'added_column_definitions': len(added), 'foreign_keys': len(foreign_keys), 'composite_foreign_keys': len(required), 'indexes': len(indexes), 'exclusion_constraints': len(exclusions), 'reviewed_extensions': extensions, 'new_tables_default_deny': len(rls), 'positive_phase_branches': positive_branches, 'database_connections': 0, 'sql_statements_executed': 0}


def self_test(source, manifest, model):
    if manifest['stage'].startswith(('M3','M4')):
        parent = 'num_nonnulls(understanding_id,exercise_id,note_application_id) = 1 AND (NOT professional_client_visible OR note_application_id IS NOT NULL)'
        unavailable = 'participant_id'
    elif manifest['stage'].startswith('M2'):
        parent = 'num_nonnulls(understanding_id,exercise_id) = 1 AND NOT professional_client_visible'
        unavailable = 'note_application_id'
    else:
        parent = 'understanding_id IS NOT NULL AND NOT professional_client_visible'
        unavailable = 'exercise_id'
    future_column = source.replace('CHECK (' + parent + ')', 'CHECK (' + unavailable + ' IS NOT NULL)')
    mutations = [
        ('destructive DDL', source + '\nDROP TABLE public.events;'),
        ('data modification', source.replace('COMMIT;', "INSERT INTO public.policy_versions DEFAULT VALUES; COMMIT;")),
        ('role grant', source.replace('COMMIT;', 'GRANT SELECT ON public.conversations TO PUBLIC; COMMIT;')),
        ('legacy NOT NULL', source.replace('ADD COLUMN "conversation_id" uuid;', 'ADD COLUMN "conversation_id" uuid NOT NULL;', 1)),
        ('wrong column type', source.replace('"priority" integer NOT NULL', '"priority" text NOT NULL')),
        ('skill plan primary check bypassed', source.replace('skill_codes[1] = skill_code', 'true')),
        ('skill plan nullable', source.replace('"skill_codes" text[] NOT NULL', '"skill_codes" text[]')),
        ('rule schema v1 silently reused', source.replace('CONSTRAINT "ck_rule_schema" CHECK (schema_version = 2)', 'CONSTRAINT "ck_rule_schema" CHECK (schema_version = 1)')),
        ('route schema v1 silently reused', source.replace('assessment_schema_version = 2 AND route_schema_version = 2', 'assessment_schema_version = 2 AND route_schema_version = 1')),
        ('missing parent key', source.replace('ADD CONSTRAINT "uq_applications_1" UNIQUE ("id", "event_id", "applicant_id")', 'ADD CONSTRAINT "uq_applications_1" UNIQUE ("id", "consultant_id", "applicant_id")')),
        ('cross-conversation response', source.replace('"fk_run_response_message" FOREIGN KEY ("conversation_id", "response_message_id")', '"fk_run_response_message" FOREIGN KEY ("event_id", "response_message_id")')),
        ('missing RLS', source.replace('ALTER TABLE public."conversations" FORCE ROW LEVEL SECURITY;', '')),
        ('unexpected new table', source.replace('COMMIT;', 'CREATE TABLE public.unreviewed(id uuid); COMMIT;')),
        ('new cascade', source.replace('ON DELETE RESTRICT;', 'ON DELETE CASCADE;', 1)),
        ('cascading key update', source.replace('ON DELETE RESTRICT;', 'ON UPDATE CASCADE ON DELETE RESTRICT;', 1)),
        ('deferrable referenced parent key', source.replace('ADD CONSTRAINT "uq_applications_1" UNIQUE ("id", "event_id", "applicant_id")', 'ADD CONSTRAINT "uq_applications_1" UNIQUE ("id", "event_id", "applicant_id") DEFERRABLE INITIALLY IMMEDIATE')),
        ('existing index name collision', source.replace('INDEX "ix_policy_active"', 'INDEX "agent_actions_event"')),
        ('wrong JSON container', source.replace("jsonb_typeof(region_scope) = 'array'", "jsonb_typeof(region_scope) = 'object'")),
        ('disabled selected-rule predicate', source.replace("WHERE outcome = 'selected';", 'WHERE false;')),
    ]
    if 'safety_cases' in manifest['create_tables']:
        mutations += [
            ('unknown subjects duplicate safety cases', source.replace(' NULLS NOT DISTINCT WHERE', ' WHERE')),
            ('borrowed staff credential', source.replace('"fk_staff_credential_subject" FOREIGN KEY ("user_id", "credential_id")', '"fk_staff_credential_subject" FOREIGN KEY ("granted_by", "credential_id")')),
            ('forged acceptance audit', source.replace('"fk_handoff_acceptance" FOREIGN KEY ("conversation_id", "acceptance_audit_event_id")', '"fk_handoff_acceptance" FOREIGN KEY ("conversation_id", "acknowledgement_audit_event_id")')),
            ('CHECK references an unavailable column', future_column),
            ('professional recipient mistaken for conversation', source.replace('"fk_grant_application_conversation" FOREIGN KEY ("application_id", "target_conversation_id")', '"fk_grant_application_conversation" FOREIGN KEY ("application_id", "recipient_id")')),
        ]
    if 'record_versions' in manifest['create_tables']:
        mutations += [
            ('extra stale understanding-only CHECK', source.replace('COMMIT;', "ALTER TABLE public.record_versions ADD CONSTRAINT ck_stale_content CHECK (content->>'type' = 'understanding'); COMMIT;")),
            ('extra stale six-scope CHECK', source.replace('COMMIT;', "ALTER TABLE public.data_requests ADD CONSTRAINT ck_stale_scope CHECK (scope_kind IN ('account','event','conversation','understanding','record_version','message')); COMMIT;")),
            ('signature tuple may be partial', source.replace('CONSTRAINT "ck_record_signature" CHECK (', 'CONSTRAINT "ck_record_signature" CHECK (true OR ')),
            ('version signer borrows a credential', source.replace('"fk_record_signer_credential" FOREIGN KEY ("signed_by_user_id", "signer_credential_id")', '"fk_record_signer_credential" FOREIGN KEY ("created_by", "signer_credential_id")')),
        ]
    if manifest['stage'].startswith(('M2', 'M3', 'M4')):
        mutations += [
            ('record practice type blocked by predecessor', source.replace("content->>'type' IN ('narrative','nvc','roleplay')", "content->>'type' = 'understanding'")),
            ('new answer schema silently relabeled old', source.replace('CHECK (answers_schema_version = 2)', 'CHECK (answers_schema_version = 1)')),
            ('recommendation snapshot schema relabeled old', source.replace('CONSTRAINT "ck_card_schema" CHECK (payload_schema_version = 2)', 'CONSTRAINT "ck_card_schema" CHECK (payload_schema_version = 1)')),
            ('followup source exclusivity disabled', source.replace('CONSTRAINT "ck_followup_source" CHECK (', 'CONSTRAINT "ck_followup_source" CHECK (true OR ')),
            ('followup source version borrowed from another exercise', source.replace('"fk_followup_exercise_version" FOREIGN KEY ("conversation_id", "exercise_id", "source_record_version_id")', '"fk_followup_exercise_version" FOREIGN KEY ("conversation_id", "exercise_id", "id")')),
            ('followup snapshot grant borrowed from another user', source.replace('"fk_followup_source_recipient" FOREIGN KEY ("source_grant_id", "source_snapshot_id", "user_id")', '"fk_followup_source_recipient" FOREIGN KEY ("source_grant_id", "source_snapshot_id", "id")')),
            ('borrowed method-review credential', source.replace('"fk_method_reviewer_subject" FOREIGN KEY ("reviewed_by", "reviewer_credential_id")', '"fk_method_reviewer_subject" FOREIGN KEY ("reviewed_by", "agent_policy_version_id")')),
            ('exercise from another event', source.replace('"fk_exercise_event" FOREIGN KEY ("event_id", "conversation_id")', '"fk_exercise_event" FOREIGN KEY ("id", "conversation_id")')),
            ('followup from another owner', source.replace('"fk_followup_owner" FOREIGN KEY ("conversation_id", "user_id")', '"fk_followup_owner" FOREIGN KEY ("conversation_id", "id")')),
            ('submission insight from another conversation', source.replace('"fk_submission_insight" FOREIGN KEY ("conversation_id", "insight_understanding_id")', '"fk_submission_insight" FOREIGN KEY ("assessment_version_id", "insight_understanding_id")')),
            ('missing same-conversation method save', source.replace('"fk_action_applied_version" FOREIGN KEY ("conversation_id", "applied_record_version_id")', '"fk_action_applied_version" FOREIGN KEY ("event_id", "applied_record_version_id")')),
            ('legacy JSON relabelled native v2', source.replace('ADD COLUMN "proposal_schema_version" integer;', 'ADD COLUMN "proposal_schema_version" integer NOT NULL DEFAULT 2;')),
            ('legacy exercise falsely active', source.replace('ADD COLUMN "status" text;', 'ADD COLUMN "status" text NOT NULL DEFAULT \'active\';')),
            ('legacy invite falsely delivered', source.replace('ADD COLUMN "delivery_state" text;', 'ADD COLUMN "delivery_state" text DEFAULT \'sent\';')),
            ('blocked method used', source.replace("CHECK (NOT used OR applicability = 'eligible')", 'CHECK (true)')),
            ('unregistered assessment source role', source.replace("source_role IN ('fact','quote','score','hypothesis','user_confirmed_summary')", "source_role IN ('fact','quote','assessment_answer','hypothesis','user_confirmed_summary')")),
            ('method source list omitted from approval', source.replace('AND sources_sha256 IS NOT NULL)', ')')),
            ('card target check disabled', source.replace('CONSTRAINT "ck_card_typed_target" CHECK (', 'CONSTRAINT "ck_card_typed_target" CHECK (true OR ')),
            ('interaction targets mixed', source.replace('CHECK (num_nonnulls(card_id,agent_run_id,exercise_id,assessment_session_id) = 1)', 'CHECK (num_nonnulls(card_id,agent_run_id,exercise_id,assessment_session_id) >= 1)')),
            ('invitation idempotency disabled', source.replace('WHERE created_by IS NOT NULL AND request_id IS NOT NULL;', 'WHERE false;')),
        ]
    if manifest['stage'].startswith(('M3','M4')):
        mutations += [
            ('unreviewed extension', source.replace('CREATE EXTENSION IF NOT EXISTS btree_gist', 'CREATE EXTENSION IF NOT EXISTS dblink')),
            ('wrong extension schema', source.replace('btree_gist WITH SCHEMA public', 'btree_gist WITH SCHEMA private')),
            ('missing extension', source.replace('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;', '')),
            ('wrong appointment interval bounds', source.replace("tstzrange(confirmed_starts_at,confirmed_ends_at,'[)')", "tstzrange(confirmed_starts_at,confirmed_ends_at,'[]')", 1)),
            ('applicant conflict removed', source.replace('WHERE (status IN (\'confirmed\',\'completed\',\'no_show\'));', 'WHERE (false);', 1)),
            ('wrong receipt provider key', source.replace('"fk_receipt_request_identity" FOREIGN KEY ("provider_code", "attempt_id", "provider_request_key")', '"fk_receipt_request_identity" FOREIGN KEY ("provider_code", "attempt_id", "provider_message_id")')),
            ('note linked to wrong application', source.replace('"fk_note_application_conversation" FOREIGN KEY ("application_id", "conversation_id")', '"fk_note_application_conversation" FOREIGN KEY ("current_record_version_id", "conversation_id")')),
            ('notification linked to wrong handoff target', source.replace('"fk_notification_handoff_recipient" FOREIGN KEY ("handoff_id", "recipient_user_id")', '"fk_notification_handoff_recipient" FOREIGN KEY ("handoff_id", "resource_id")')),
            ('legacy profile falsely verified', source.replace('ADD COLUMN "verification_status" text;', 'ADD COLUMN "verification_status" text DEFAULT \'verified\';')),
            ('pending receipt linked before matching', source.replace("CHECK ((correlation_status = 'matched') = (attempt_id IS NOT NULL))", 'CHECK (true)')),
            ('proposal pending uniqueness disabled', source.replace('ON public."appointment_proposals" (appointment_id) WHERE status = \'pending\';', 'ON public."appointment_proposals" (appointment_id) WHERE false;')),
            ('appointment self acceptance', source.replace("status IN ('accepted','declined') AND decided_by <> proposed_by", "status IN ('accepted','declined') AND decided_by = proposed_by")),
            ('delivered fact may be downgraded', source.replace("CHECK ((status = 'delivered') = (delivered_at IS NOT NULL))", 'CHECK (true)', 1)),
        ]
    if manifest['stage'].startswith('M4'):
        mutations += [
            ('research primary subject absent from roster', source.replace('"fk_research_session_primary" FOREIGN KEY ("id", "participant_id")', '"fk_research_session_primary" FOREIGN KEY ("participant_id", "id")')),
            ('research consent falsely restricted to primary subject', source.replace('REFERENCES public."research_session_participants" ("participant_id", "research_session_id") ON DELETE RESTRICT;', 'REFERENCES public."research_sessions" ("participant_id", "id") ON DELETE RESTRICT;')),
            ('asset subject borrowed from a different call', source.replace('"fk_asset_subject_session" FOREIGN KEY ("asset_id", "research_session_id")', '"fk_asset_subject_session" FOREIGN KEY ("asset_id", "participant_id")')),
            ('asset subject absent from its physical call', source.replace('"fk_asset_subject_member" FOREIGN KEY ("research_session_id", "participant_id")', '"fk_asset_subject_member" FOREIGN KEY ("asset_id", "participant_id")')),
            ('multiple primary subjects per asset', source.replace('ON public."corpus_asset_participants" (asset_id) WHERE is_primary;', 'ON public."corpus_asset_participants" (asset_id) WHERE false;')),
            ('research consent borrowed from another session', source.replace('"fk_consent_research_session" FOREIGN KEY ("participant_id", "scope_research_session_id")', '"fk_consent_research_session" FOREIGN KEY ("participant_id", "guardian_link_id")')),
            ('case reviewer borrows a credential', source.replace('"fk_case_reviewer_subject" FOREIGN KEY ("reviewed_by", "reviewer_credential_id")', '"fk_case_reviewer_subject" FOREIGN KEY ("reviewed_by", "agent_policy_version_id")')),
            ('expert score borrows a credential', source.replace('"fk_eval_reviewer_subject" FOREIGN KEY ("reviewer_user_id", "reviewer_credential_id")', '"fk_eval_reviewer_subject" FOREIGN KEY ("reviewer_user_id", "evaluation_result_id")')),
            ('case derivative assigned a different group', source.replace('"fk_case_parent_group" FOREIGN KEY ("derived_from_case_id", "leakage_group_id")', '"fk_case_parent_group" FOREIGN KEY ("id", "leakage_group_id")')),
            ('asset points at a different file hash', source.replace('"fk_asset_file_digest" FOREIGN KEY ("file_id", "content_sha256")', '"fk_asset_file_digest" FOREIGN KEY ("file_id", "sources_sha256")')),
            ('evaluation case borrowed from a different dataset', source.replace('"fk_eval_dataset_case" FOREIGN KEY ("dataset_version_id", "case_id")', '"fk_eval_dataset_case" FOREIGN KEY ("evaluation_run_id", "case_id")')),
            ('leakage assignment check removed', source.replace('"fk_dataset_group_split" FOREIGN KEY ("dataset_version_id", "leakage_group_id")', '"fk_dataset_group_split" FOREIGN KEY ("dataset_version_id", "case_id")')),
            ('review stream NULL identities duplicate', source.replace('uq_eval_review_stream UNIQUE NULLS NOT DISTINCT', 'uq_eval_review_stream UNIQUE')),
            ('case approved without frozen sources', source.replace('CONSTRAINT "ck_decision_case_review" CHECK (', 'CONSTRAINT "ck_decision_case_review" CHECK (true OR ')),
            ('deidentification confused with non-existent approval state', source.replace("deidentification_status IN ('not_reviewed','processing','reviewed','rejected')", "deidentification_status IN ('not_reviewed','processing','approved','rejected')")),
            ('research requester confused with its target', source.replace('CONSTRAINT "ck_research_requester" CHECK (', 'CONSTRAINT "ck_research_requester" CHECK (true OR ')),
            ('research grant asserted by unrelated app account', source.replace("CHECK (participant_id IS NULL OR (decision_source = 'verified_document' AND guardian_link_id IS NULL))", 'CHECK (true)')),
            ('failed evaluation silently marked complete', source.replace('CONSTRAINT "ck_evaluation_result_output" CHECK (', 'CONSTRAINT "ck_evaluation_result_output" CHECK (true OR ')),
            ('safety failure averaged into a pass', source.replace("CHECK (NOT (safety_failure OR authorization_failure) OR verdict = 'fail')", 'CHECK (true)')),
            ('authorization veto removed', source.replace("CHECK (NOT (safety_failure OR authorization_failure) OR verdict = 'fail')", "CHECK (NOT safety_failure OR verdict = 'fail')")),
            ('old review array mislabeled as v2', source.replace('CONSTRAINT "ck_evaluation_review_schema" CHECK (scores_schema_version = 2)', 'CONSTRAINT "ck_evaluation_review_schema" CHECK (scores_schema_version = 1)')),
            ('raw asset session uniqueness disabled', source.replace('ON public."corpus_assets" (research_session_id,asset_kind,version) WHERE asset_scope = \'session\';', 'ON public."corpus_assets" (research_session_id,asset_kind,version) WHERE false;')),
            ('model grade forged as an expert', source.replace('CONSTRAINT "ck_evaluation_reviewer" CHECK (', 'CONSTRAINT "ck_evaluation_reviewer" CHECK (true OR ')),
            ('old pooled metrics written as native v2', source.replace('CONSTRAINT "ck_evaluation_metrics_schema" CHECK (metrics_schema_version = 2)', 'CONSTRAINT "ck_evaluation_metrics_schema" CHECK (metrics_schema_version = 1)')),
        ]
    for label, changed in mutations:
        assert changed != source, label
        try:
            check(changed, copy.deepcopy(manifest), model)
        except (AssertionError, KeyError):
            continue
        raise AssertionError('Bad draft accepted: ' + label)
    if manifest['stage'].startswith(('M3','M4')):
        bad_model = copy.deepcopy(model)
        language = next(f for t in bad_model['tables'] if t['name'] == 'consultants' for f in t['fields'] if f['name'] == 'languages')
        language['default'] = 'ARRAY[zh-CN]'
        try:
            check(source, copy.deepcopy(manifest), bad_model)
        except AssertionError:
            return len(mutations) + 1
        raise AssertionError('Invalid target array default accepted behind a legacy NULL override')
    return len(mutations)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--write-m1-migrations', action='store_true')
    args = parser.parse_args()
    model = load_json((ROOT / 'docs/database-model-v2.json').read_text())
    if args.self_test: check_artifact_json()
    result = {}
    for stem in ('wang-m1a', 'wang-m1', 'wang-m2', 'wang-m3', 'wang-m4'):
        manifest = load_json((DIRECTORY / (stem + '.json')).read_text())
        assert manifest['sql_file'] == stem + '.sql'
        source = (DIRECTORY / manifest['sql_file']).read_text()
        checked = check(source, manifest, model)
        if args.self_test: checked['rejected_mutations'] = self_test(source, manifest, model)
        result[stem] = checked
    result['m1_migrations'] = m1_migrations(args.write_m1_migrations)
    print(json.dumps(result, indent=2))

# /// script
# requires-python = ">=3.11"
# dependencies = ["jsonschema[format]==4.25.1"]
# ///
"""Check design artifacts only. No SQL, environment credentials or application imports."""
import argparse
import collections
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import re

from jsonschema import Draft202012Validator, FormatChecker
from database_artifacts import load_json

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'


def load(name):
    return load_json((DOCS / name).read_text())


@lru_cache(maxsize=None)
def contract_validator(name):
    bundle = load('database-json-contracts-v2.json')
    return Draft202012Validator({'$defs': bundle['$defs'], '$ref': '#/$defs/' + name}, format_checker=FormatChecker())


def acyclic(edges):
    graph = collections.defaultdict(list)
    for child, parent in edges:
        graph[child].append(parent)
    active, done = set(), set()

    def visit(node):
        assert node not in active, 'source cycle'
        if node in done:
            return
        active.add(node)
        for parent in graph[node]:
            visit(parent)
        active.remove(node)
        done.add(node)

    for node in list(graph):
        visit(node)


def scoped_source(source_id, data):
    source = data['sources'][source_id]
    assert source['id'] == source_id and source['conversation'] == data['conversation']
    assert source['authorized'] and source['context_version'] <= data['context_version']
    return source


def review_quality(review):
    version = review['scores_schema_version']
    scores = review['scores']
    if version == 1:
        assert isinstance(scores, list) and scores
        assert all(type(r['score']) in (int, float) and 0 <= r['score'] <= 1 for r in scores)
        weights = review.get('legacy_rubric_weights')
        if weights is None or len({r['criterion_id'] for r in scores}) != len(scores):
            return 'legacy_normalized_0_1', None
        assert set(weights) == {r['criterion_id'] for r in scores}
        assert all(type(v) in (int, float) and 0 <= v <= 1 for v in weights.values())
        total_weight = sum(weights.values())
        assert total_weight == 0 or abs(total_weight - 1) < 1e-9
        return 'legacy_normalized_0_1', sum(r['score'] * weights[r['criterion_id']] for r in scores) if total_weight else None
    assert version == 2 and isinstance(scores, dict)
    scale, ratings = scores['scale_code'], scores['ratings']
    assert scale in ('normalized_0_1', 'wang_dialogue_0_2') and 1 <= len(ratings) <= 32
    assert len({r['criterion_id'] for r in ratings}) == len(ratings)
    maximum = 2 if scale == 'wang_dialogue_0_2' else 1
    if maximum == 2:
        assert {r['criterion_id'] for r in ratings} == {'understanding_accuracy', 'human_care', 'depth_and_guidance', 'natural_language', 'rhythm_and_feedback'}
        assert all(r['raw_score'] is None or r['raw_score'] in (0, 1, 2) for r in ratings)
        assert all(r['weight'] == 0.2 for r in ratings)
    for rating in ratings:
        assert type(rating['weight']) in (int, float) and 0 <= rating['weight'] <= 1
        if rating['raw_score'] is not None:
            assert type(rating['raw_score']) in (int, float) and 0 <= rating['raw_score'] <= maximum
            assert rating['evidence_summary']
    total_weight = sum(r['weight'] for r in ratings)
    assert total_weight == 0 or abs(total_weight - 1) < 1e-9
    assert scores['maximum_total'] == maximum * len(ratings)
    if any(r['raw_score'] is None for r in ratings):
        assert scores['raw_total'] is None and scores['normalized_quality'] is None
        return scale, None
    assert type(scores['raw_total']) in (int, float)
    assert abs(scores['raw_total'] - sum(r['raw_score'] for r in ratings)) < 1e-9
    quality = math.fsum(r['raw_score'] * r['weight'] / maximum for r in ratings) if total_weight else None
    if quality is None:
        assert scores['normalized_quality'] is None
    else:
        assert type(scores['normalized_quality']) in (int, float)
        assert abs(scores['normalized_quality'] - quality) < 1e-9
    return scale, quality


def semantic_case(rule, d):
    """Executable examples of cross-row rules, not the future DB/auth implementation."""
    if rule == 'private_hint':
        assert d['private_owner'] == d['actor'] and d['membership_active']
        assert d['private_event'] == d['room_event']
        assert d['purpose'] == 'private_hint' and d['author_role'] == 'assistant'
        assert int(d['room_message_id']) >= int(d['history_from_message_id'])
        assert d['delivery_conversation'] == d['private_conversation']
    elif rule == 'expression_privacy':
        report, source = d['report'], d['source']
        status = report['status']
        assert status in ('unknown', 'reported_private', 'reported_not_private')
        if status == 'unknown':
            assert all(report[k] is None for k in ('subject_user_id', 'source_id', 'context_version'))
            effective = 'unknown'
        else:
            assert report['source_id'] == source['id'] and source['id'] in d['evidence_source_ids']
            assert source['conversation'] == d['conversation']
            assert source['author'] == report['subject_user_id']
            assert source['role'] == 'user' and source['provenance'] == 'user_quoted'
            assert source['reported_status'] == status and source['id'] == d['latest_self_report_source_id']
            assert source['context_version'] <= report['context_version'] <= d['context_version']
            current = report['context_version'] == d['context_version'] and report['subject_user_id'] == d['actor']
            effective = status if current else 'unknown'
        assert d['effective_status'] == effective
        if effective != 'reported_private' or not d['authorized'] or d['safety_restricted']:
            assert not d['reply_includes_private_context']
            assert set(d['route']['allowed_tools']) <= {'safety_check'}
            assert not any(d['route'][k] for k in ('may_offer_method', 'may_start_practice', 'may_prepare_record'))
            assert not d['invites_or_shares']
        if d['safety_restricted']:
            assert d['route']['strategy_code'] == 'H'
    elif rule == 'wang_support_preference':
        report = d['report']
        if report['mode'] == 'unknown':
            assert all(report[k] is None for k in ('subject_user_id', 'source_id', 'context_version'))
            effective = 'unknown'
        else:
            source = scoped_source(report['source_id'], d)
            assert source['author'] == report['subject_user_id'] and source['provenance'] == 'user_quoted'
            assert source['preference_mode'] == report['mode'] and source['id'] == d['latest_preference_source_id']
            assert source['context_version'] <= report['context_version'] <= d['context_version']
            current = report['subject_user_id'] == d['actor'] and report['context_version'] == d['context_version']
            effective = report['mode'] if current else 'unknown'
        assert d['effective_preference'] == effective
        assert not d['grants_access_or_clears_safety']
        if effective not in ('explore', 'action_support') or d['advice_declined'] or not d['authorized_for_guidance']:
            assert not d['automatic_guidance']
    elif rule == 'wang_mechanism_history':
        before = {h['hypothesis_key']: h for h in d['before']}
        after = {h['hypothesis_key']: h for h in d['after']}
        assert len(before) == len(d['before']) and len(after) == len(d['after'])
        latest, historical, versions = {}, {}, set()
        for row in sorted(d['persisted_updates'], key=lambda row: row['context_version']):
            hypothesis = row['hypothesis']
            key, version = hypothesis['hypothesis_key'], row['context_version']
            assert row['conversation'] == d['conversation'] and row['published'] and row['decision_id']
            assert version == hypothesis['updated_context_version'] and version <= d['context_version']
            assert (key, version) not in versions
            versions.add((key, version))
            latest[key] = hypothesis
            if version < d['context_version']:
                historical[key] = hypothesis
        for key, hypothesis in before.items():
            assert hypothesis == historical[key]
        for hypothesis in after.values():
            assert hypothesis == latest[hypothesis['hypothesis_key']]
            assert hypothesis['status'] in ('unconfirmed', 'partially_confirmed', 'rejected')
            support, counter, feedback = (hypothesis[k] for k in ('support_source_ids', 'counterevidence_source_ids', 'confirmation_source_ids'))
            assert support and not set(support) & set(counter)
            assert hypothesis['updated_context_version'] <= d['context_version']
            for source_id in set(support + counter + feedback):
                source = scoped_source(source_id, d)
                assert source['provenance'] in ('user_quoted', 'user_confirmed', 'assessment_answer')
                assert source['context_version'] <= hypothesis['updated_context_version']
            if hypothesis['status'] in ('partially_confirmed', 'rejected'):
                assert feedback
                for source_id in feedback:
                    source = scoped_source(source_id, d)
                    assert source['author'] == hypothesis['subject_user_id'] and source['provenance'] == 'user_quoted'
                    assert source['hypothesis_key'] == hypothesis['hypothesis_key'] and source['reported_status'] == hypothesis['status']
            if hypothesis['status'] == 'rejected':
                assert counter
        for key, old in historical.items():
            source_ids = old['support_source_ids'] + old['counterevidence_source_ids'] + old['confirmation_source_ids']
            if any(not d['sources'][source_id]['authorized'] for source_id in source_ids):
                assert key not in after
                continue
            if key not in after:
                continue  # The immutable decision update remains authoritative after cache eviction.
            current = after[key]
            assert current['subject_user_id'] == old['subject_user_id']
            assert current['updated_context_version'] >= old['updated_context_version']
            assert set(old['counterevidence_source_ids']) <= set(current['counterevidence_source_ids'])
            if old['status'] == 'rejected' and current['status'] != 'rejected':
                assert any(source['author'] == old['subject_user_id'] and source['provenance'] == 'user_quoted'
                           and source.get('reopens_hypothesis_key') == key
                           and source['context_version'] > old['updated_context_version']
                           for source in (scoped_source(i, d) for i in current['confirmation_source_ids']))
    elif rule == 'wang_support_feedback':
        seen = set()
        for episode in d['prior_support']:
            key = episode['decision_id'], episode['subject_user_id']
            assert key not in seen
            seen.add(key)
            decision = d['decisions'][episode['decision_id']]
            assert decision['conversation'] == d['conversation'] and decision['published']
            assert decision['context_version'] <= d['context_version']
            effects = set()
            for interaction_id in episode['feedback_interaction_ids']:
                interaction = d['interactions'][interaction_id]
                assert interaction['conversation'] == d['conversation'] and interaction['authorized']
                assert interaction['context_version'] <= d['context_version']
                assert interaction['actor'] == episode['subject_user_id'] and interaction['decision_id'] == episode['decision_id']
                assert interaction['action_code'] == interaction['payload']['type'] == 'feedback'
                assert interaction['provenance'] == 'user_action'
                assert contract_validator('InteractionPayload').is_valid(interaction['payload'])
                effects.add('helpful' if interaction['payload']['rating'] == 'helpful' else 'unhelpful')
            effect = 'mixed' if len(effects) == 2 else next(iter(effects)) if effects else 'unknown'
            assert episode['reported_effect'] == effect
            for issue in episode['unresolved_issues']:
                assert issue['source_ids']
                for source_id in issue['source_ids']:
                    source = scoped_source(source_id, d)
                    assert source['author'] == episode['subject_user_id'] and source['provenance'] == 'user_quoted'
            if episode['followup_id'] is not None:
                followup = d['followups'][episode['followup_id']]
                assert followup['conversation'] == d['conversation'] and followup['subject'] == episode['subject_user_id']
    elif rule == 'assessment_progress':
        assert d['current_item_id'] in d['item_ids']
        assert set(d['answers']) <= set(d['item_ids'])
        assert d['status'] in ('draft', 'paused')
        assert d['expected_revision'] == d['revision']
        if d['status'] == 'paused':
            assert d['paused_at'] and (not d['resumed_at'] or d['paused_at'] > d['resumed_at'])
        elif d['paused_at']:
            assert d['resumed_at'] and d['resumed_at'] >= d['paused_at']
    elif rule == 'assessment_submission':
        items = {item['item_id']: item for item in d['items']}
        assert len(items) == len(d['items'])
        assert set(d['answers']) <= set(items)
        assert {i['item_id'] for i in items.values() if i['required']} <= set(d['answers'])
        values = {}
        for item_id, code in d['answers'].items():
            options = {o['code']: o['value'] for o in items[item_id]['options']}
            assert len(options) == len(items[item_id]['options']) and code in options
            values[item_id] = options[code]
        scales = {scale['scale_id']: scale for scale in d['scales']}
        scores = {score['scale_id']: score for score in d['scores']}
        assert len(scales) == len(d['scales']) and len(scores) == len(d['scores'])
        assert set(scales) == set(scores)
        for key, scale in scales.items():
            score = scores[key]
            assert score['item_ids'] == scale['item_ids']
            assert score['aggregation'] == scale['aggregation']
            assert score['item_count'] == len(scale['item_ids'])
            assert score['raw_sum'] == sum(values[i] for i in scale['item_ids'])
        if d['instrument'] == 'SCQA':
            assert len(items) == 24 and len(scales) == 8
            assert all(s['aggregation'] == 'mean' and len(s['item_ids']) == 3 for s in scales.values())
            assert sorted(i for s in scales.values() for i in s['item_ids']) == sorted(items)
    elif rule == 'rectification':
        assert d['actor'] == d['owner'] and d['expected_version'] == d['current_version']
        allowed = {
            'understanding': {'/text'},
            'nvc': {'/fields/observation', '/fields/feeling', '/fields/need', '/fields/request'},
            'narrative': {'/story'},
            'roleplay': {'/scene', '/reflection'},
        }
        assert set(d['paths']) <= allowed[d['content_type']] and d['paths']
        assert d['new_version'] and not d['rewrite_history']
    elif rule == 'record_lineage':
        nodes = {n['id']: n for n in d['nodes']}
        decisions = {n['id']: n for n in d['decisions']}
        for n in nodes.values():
            if n['origin'] == 'native' and n['provenance'] == 'model_inference':
                assert n.get('decision_id') in decisions
                assert decisions[n['decision_id']]['conversation'] == n['conversation']
        for edge in d['edges']:
            target, source = nodes[edge['target']], nodes[edge['source']]
            assert target['conversation'] == source['conversation']
            if edge['source_role'] in ('fact', 'quote', 'user_confirmed_summary'):
                assert source['provenance'] != 'model_inference' and not source.get('hypothetical')
        acyclic([(e['target'], e['source']) for e in d['edges']])
    elif rule == 'research_lineage':
        assets = {a['id']: a for a in d['assets']}
        parents = collections.defaultdict(list)
        for child, parent in d['edges']:
            assert child in assets and parent in assets
            parents[child].append(parent)
        acyclic(d['edges'])

        def ancestors(node):
            return {node}.union(*(ancestors(p) for p in parents[node]))

        for a in assets.values():
            if a['scope'] == 'compiled':
                assert a['session'] is None and len(set(parents[a['id']])) >= 2
            else:
                assert a['session'] is not None
                assert all(assets[p]['session'] == a['session'] for p in ancestors(a['id']))
        case_assets = set(d['case_assets'])
        if 'cases' in d:
            cases = {c['id']: c for c in d['cases']}
            assert len(cases) == len(d['cases'])
            acyclic([(c['id'], c['parent']) for c in cases.values() if c['parent'] is not None])

            def add_case(case_id):
                case = cases[case_id]
                assert case['group'] == d['case_group']
                case_assets.update(case['assets'])
                if case['parent'] is not None:
                    add_case(case['parent'])

            add_case(d['case_id'])
        closure = set().union(*(ancestors(a) for a in case_assets))
        assert closure and all(assets[a]['permitted'] for a in closure)
        assert {assets[a]['group'] for a in closure} == {d['case_group']}
        assert len({split for group, split in d['assignments'] if group == d['case_group']}) == 1
        session_ids = {assets[a]['session'] for a in closure if assets[a]['session'] is not None}
        for session_id in session_ids:
            session = d['sessions'][session_id]
            roster = session['participants']
            assert roster and len({p['participant_id'] for p in roster}) == len(roster)
            active = [p for p in roster if p['status'] == 'active']
            assert session['participant'] in {p['participant_id'] for p in active} and session['status'] == 'usable'
            frozen = sorted([dict(participant_id=p['participant_id'], role_code=p['role_code'], is_primary=p['participant_id'] == session['participant']) for p in active], key=lambda p: p['participant_id'])
            for asset in (assets[a] for a in closure if assets[a]['session'] == session_id):
                assert asset['subject_roster'] == frozen
            for participant in active:
                subject = participant['participant_id']
                assert d['participant_groups'][subject] == d['case_group']
                grants = [g for g in d['grants'] if g['participant'] == subject and g['purpose'] == d['purpose'] and g['policy'] == d['policy']]
                specific = [g for g in grants if g['scope_kind'] == 'research_session' and g['session'] == session_id]
                grants = specific or [g for g in grants if g['scope_kind'] == 'participant' and g['session'] is None]
                superseded = {g['supersedes'] for g in grants if g['supersedes'] is not None}
                grants = [g for g in grants if g['id'] not in superseded]
                assert len(grants) == 1
                grant = grants[0]
                assert grant['verified'] and not grant['withdrawn']
                assert grant['expires_at'] is None or grant['expires_at'] > d['evaluated_at']
        assert d['session_count'] == len(session_ids)
        durations = [d['sessions'][s]['duration_seconds'] for s in session_ids]
        assert d['duration_seconds'] == (sum(durations) if all(v is not None for v in durations) else None)
    elif rule == 'research_roster_history':
        session = d['session']
        active = [p for p in session['participants'] if p['status'] == 'active']
        assert session['participant'] in {p['participant_id'] for p in active}
        current = sorted([dict(participant_id=p['participant_id'], role_code=p['role_code'], is_primary=p['participant_id'] == session['participant']) for p in active], key=lambda p: p['participant_id'])
        assets = {a['id']: a for a in d['after']}
        assert len(assets) == len(d['after'])
        for before in d['before']:
            after = assets[before['id']]
            assert after['subject_rows'] == before['subject_rows'] and after['session'] == before['session']
        for asset in assets.values():
            assert asset['session'] == session['id']
            ids = [p['participant_id'] for p in asset['subject_rows']]
            assert len(ids) == len(set(ids)) and sum(p['is_primary'] for p in asset['subject_rows']) == 1
            assert set(ids) <= {p['participant_id'] for p in session['participants']}
            if asset['subject_rows'] != current:
                assert not asset['usable'] and asset['descendants_invalidated']
        assert d['session_count'] == 1 and d['duration_seconds'] == session['duration_seconds']
        affected = {a['id'] for a in assets.values() if any(p['participant_id'] == d['withdrawn_participant'] for p in a['subject_rows'])}
        assert set(d['withdrawal_affected_assets']) == affected
    elif rule == 'data_request':
        scope = d['scope']
        column = {'account': 'subject_user_id', 'event': 'event_id', 'conversation': 'conversation_id',
                  'research_participant': 'participant_id'}.get(scope, scope + '_id')
        target_columns = {'understanding_id', 'record_version_id', 'assessment_session_id',
                          'exercise_id', 'message_id', 'corpus_asset_id', 'participant_id'}
        assert d['manifest_scope'] == scope
        assert d['verified']
        if d['erased']:
            assert d['state'] in ('partial', 'completed') and not any(d['targets'].values())
            assert d['manifest_ids']
        else:
            assert d['targets'].get(column)
            assert not any(value for key, value in d['targets'].items() if key in target_columns and key != column)
            assert d['targets'][column] in d['manifest_ids']
        assert len(d['resource_keys']) == len(set(d['resource_keys']))
        assert all(item['owner'] == d['subject'] for item in d['resolved_objects'])
    elif rule == 'legacy_domains':
        for row in d['rows']:
            expected = row['kind'] if row['kind'] in ('private', 'room') else None
            assert row['domain'] == expected
            assert row['conversation_id'] and row['reader'] == 'conversation_permission'
            if row['table'] == 'agent_actions':
                assert row['kind'] == 'private'
    elif rule == 'appointment_history':
        proposals = {p['id']: p for p in d['proposals']}
        assert len([p for p in proposals.values() if p['status'] == 'pending']) <= 1
        for p in proposals.values():
            assert p['appointment_id'] == d['appointment_id']
            assert p['start'] < p['end']
            if p['status'] in ('accepted', 'declined'):
                assert p['decided_by'] and p['decided_by'] != p['proposed_by'] and p['decided_at']
            if p['status'] == 'pending':
                assert not p['decided_at'] and not p['decided_by']
            if p.get('being_accepted'):
                assert p['status'] == 'pending' and p['base_revision'] == d['expected_revision']
                assert p['expires_at'] is None or p['expires_at'] > d['now']
        accepted = proposals[d['accepted_proposal_id']]
        assert accepted['status'] == 'accepted'
        assert [accepted['start'], accepted['end']] == d['confirmed_range']
        assert d['latest_proposal_id'] == max(proposals.values(), key=lambda p: p['no'])['id']
    elif rule == 'notification_history':
        attempts = {a['id']: a for a in d['attempts']}
        keys = [(a['provider'], a['request_key']) for a in attempts.values()]
        assert len(keys) == len(set(keys))
        deliveries = False
        receipts = set()
        for r in d['receipts']:
            key = r['provider'], r['dedupe_key']
            assert key not in receipts and r['verified']
            receipts.add(key)
            if r['correlation'] == 'matched':
                a = attempts[r['attempt_id']]
                assert a['provider'] == r['provider']
                assert r.get('message_id') or r.get('request_key')
                if r.get('message_id'): assert a['message_id'] == r['message_id']
                if r.get('request_key'): assert a['request_key'] == r['request_key']
                deliveries |= r['kind'] == 'delivered'
            else:
                assert r['attempt_id'] is None
        if deliveries:
            assert d['aggregate'] == 'delivered'
        for a in attempts.values():
            if a['status'] == 'unknown':
                assert not d['automatic_new_dispatch']
        assert not d['stored_plaintext_token']
    elif rule == 'invite_replay':
        assert re.fullmatch('[a-f0-9]{64}', d['stored_hash']) and not d['stored_plaintext']
        if d['repeated_request']:
            assert d['http_status'] == 409 and not d['token_returned']
        else:
            assert d['http_status'] == 201 and d['token_returned']
    elif rule == 'record_content':
        if d['type'] == 'narrative':
            assert sorted(a['act'] for a in d['acts']) == list(range(6))
        elif d['type'] == 'nvc':
            for field, state in d['field_states'].items():
                if state in ('unknown', 'declined'):
                    assert d['fields'][field] == ''
        elif d['type'] == 'roleplay':
            roles = {r['role_id']: r for r in d['roles']}
            assert len(roles) == len(d['roles']), 'duplicate role_id'
            assert sum(r['is_user'] for r in roles.values()) == 1
            assert len({u['line_id'] for u in d['utterances']}) == len(d['utterances'])
            for line in d['utterances']:
                assert line['role_id'] in roles
                if not roles[line['role_id']]['is_user'] and line['provenance'] == 'model_inference':
                    assert line['hypothetical']
    elif rule == 'record_parent':
        assert contract_validator('RecordContent').is_valid(d['content'])
        kind = d['content']['type']
        assert kind in d['allowed_types'] and d['parent']['conversation'] == d['conversation']
        if kind in ('narrative', 'nvc', 'roleplay'):
            assert d['parent']['type'] == 'exercise' and d['parent']['kind'] == kind
        else:
            assert d['parent']['type'] == kind
    elif rule == 'note_signature':
        versions = {v['id']: v for v in d['versions']}
        assert len(versions) == len(d['versions'])
        for version in versions.values():
            signature = version['signature']
            if signature is None:
                continue
            assert version['type'] == 'professional_note' and version['application'] == d['application']
            assert signature['user'] == d['credential']['subject'] == d['assigned_professional']
            assert signature['credential'] == d['credential']['id']
            assert d['credential']['verified'] and d['credential']['valid_from'] <= signature['signed_at'] < d['credential']['valid_until']
            assert signature['signed_at'] >= version['created_at']
        for before in d['before']:
            after = versions[before['id']]
            assert all(after[k] == before[k] for k in ('application', 'type', 'content_sha256', 'created_at'))
            if before['signature'] is not None:
                assert after['signature'] == before['signature']
        current = versions[d['current_version_id']]
        assert d['root_signed_at'] == (current['signature']['signed_at'] if current['signature'] else None)
    elif rule == 'professional_recommendation':
        assert contract_validator('MessageCard').is_valid(d['card'])
        candidates = d['card']['consultants']
        assert len({p['consultant_id'] for p in candidates}) == len(candidates)
        for candidate in candidates:
            source = d['directory_at_recommendation'][candidate['consultant_id']]
            assert all(candidate[k] == source[k] for k in ('profile_version', 'service_profile_snapshot', 'specialties'))
        assert d['replayed_card'] == d['card']
        if d['applying']:
            assert d['current_qualification_valid'] and d['current_availability_valid'] and d['current_terms_confirmed']
    elif rule == 'followup_origin':
        row = d['followup']
        refs = [row[k] for k in ('source_record_version_id', 'source_snapshot_id', 'source_grant_id')]
        assert not (refs[0] and any(refs[1:])) and (refs[1] is None) == (refs[2] is None)
        assert row['exercise_id'] is None or refs[0] is not None
        assert not any(refs) or row['conversation'] is not None
        assert (row['conversation'], row['user']) == (d['private']['id'], d['private']['owner'])
        before = d['before']
        if before is None:
            assert row['source_invalidated_at'] is None
        elif not d['controlled_erasure']:
            assert all(row[k] == before[k] for k in ('source_record_version_id', 'source_snapshot_id', 'source_grant_id', 'exercise_id'))
            assert before['source_invalidated_at'] is None or row['source_invalidated_at'] == before['source_invalidated_at']
        else:
            assert row['source_invalidated_at'] and not any(refs) and row['exercise_id'] is None and d['derived_content_erased']
        authorized = not row['source_invalidated_at']
        if refs[0]:
            source = d['source_version']
            assert (refs[0], row['conversation']) == (source['id'], source['conversation'])
            assert source['owner'] == row['user']
            assert row['exercise_id'] is None or row['exercise_id'] == source['exercise']
            authorized &= source['available']
        if refs[1]:
            snapshot, grant = d['snapshot'], d['grant']
            assert (refs[1], refs[2], row['conversation'], row['user']) == (snapshot['id'], grant['id'], grant['conversation'], grant['recipient'])
            assert grant['snapshot'] == snapshot['id'] and snapshot['confirmed_action']
            assert snapshot['kind'] == 'common_outcome' and snapshot['record_kind'] == 'action_agreement'
            assert snapshot['source_conversation_kind'] == 'room' and snapshot['source_event'] == d['private']['event']
            authorized &= snapshot['available'] and grant['active'] and {'read', 'use_in_agent'} <= set(grant['permissions']) and grant['purpose'] == 'action_followup'
        if not authorized:
            assert row['source_invalidated_at'] and not d['used_in_context'] and not d['reminder_pending']
    elif rule == 'audit_transition':
        assert d['action_code'] == d['metadata']['type']
        assert d['metadata']['result_revision'] > d['metadata']['expected_revision']
        if d['action_code'] == 'safety_transition':
            assert d['metadata']['assignment_id'] and d['metadata']['gate_outcomes']
    elif rule == 'wang_rule_lineage':
        run, decision, route = d['run'], d['decision'], d['route']
        assert decision['conversation'] == run['conversation']
        assert decision['policy'] == run['policy'] == d['published_policy']
        assert d['policy_published'] and d['rules_hash_matches']
        assert len({m['rule_id'] for m in d['matches']}) == len(d['matches'])
        selected = [m for m in d['matches'] if m['outcome'] == 'selected']
        assert len(selected) == 1 and selected[0]['rule_id'] == route['selected_rule_id']
        rules = {r['id']: r for r in d['rules']}
        chosen = rules[route['selected_rule_id']]
        for match in d['matches']:
            rule_row = rules[match['rule_id']]
            assert match['decision_id'] == decision['id'] and match['conversation'] == decision['conversation']
            assert match['policy'] == rule_row['policy'] == decision['policy']
            if match['outcome'] in ('matched', 'selected', 'blocked'):
                assert set(route['allowed_tools']) <= set(rule_row['allowed_tools'])
                assert set(rule_row['forbidden_actions']) <= set(route['forbidden_actions'])
        assert route['skill'] == chosen['skill'] == decision['skill']
        assert route['skills'] == chosen['skills'] and route['skills'][0] == route['skill']
        assert len(set(route['skills'])) == len(route['skills']) and 1 <= len(route['skills']) <= 8
        assert route['strategy'] == chosen['strategy'] == decision['strategy']
        sources = {s['id']: s for s in d['sources']}
        for source_id in d['evidence_source_ids']:
            assert sources[source_id]['decision_id'] == decision['id']
            assert sources[source_id]['conversation'] == decision['conversation']
    elif rule == 'wang_practice_choice':
        assert d['actor'] == d['owner'] and d['conversation_kind'] == 'private'
        assert d['expected_revision'] == d['current_revision']
        assert d['explicit_user_action'] and d['interaction_id']
        assert not d['created_share_count']
        if d['action'] == 'practice_decline':
            assert not d['created_exercise_count'] and not d['created_record_version_count']
            assert d['method_key'] in d['declined_method_keys_after']
        elif d['action'] == 'practice_start':
            assert d['safety_state'] == 'clear' and d['method_eligible']
            assert d['method_id'] in d['candidate_method_ids']
            assert d['confirmation_purpose'] == 'method_start'
            assert d['created_exercise_count'] == (0 if d['replay'] else 1)
            assert not d['created_record_version_count'] and not d['applied_record_version_id']
            assert d['method_key'] not in d['declined_method_keys_after']
        else:
            assert d['action'] == 'record_save' and d['confirmation_purpose'] == 'record_save'
            assert d['safety_state'] == 'clear' and not d['created_exercise_count']
            assert d['created_record_version_count'] == (0 if d['replay'] else 1)
            assert d['applied_record_version_id']
    elif rule == 'wang_state_transition':
        assert d['expected_revision'] == d['state_revision']
        assert d['input_context_version'] == d['conversation_revision']
        assert d['next_revision'] == d['state_revision'] + 1
        assert d['next_context_version'] == d['input_context_version']
        assert d['interaction_conversation'] == d['conversation']
        if not d['explicit_restart']:
            assert set(d['declined_keys_before']) <= set(d['declined_keys_after'])
        if d['safety_before'] in ('blocked', 'review_required') and d['safety_after'] == 'clear':
            review = d['release_review']
            assert review and review['actor'] == review['assigned_user']
            assert review['role'] == 'safety_responder' and review['assignment_valid']
            assert review['policy_approved'] and review['evidence_id']
    elif rule == 'wang_professional_grant':
        application, conversation, grant = d['application'], d['conversation'], d['grant']
        assert conversation['kind'] == 'professional'
        assert grant['application'] == conversation['application'] == application['id']
        assert grant['target_conversation'] == conversation['id']
        assert grant['source_event'] == grant['target_event'] == conversation['event'] == application['event']
        assert conversation['owner'] == application['applicant']
        assert grant['recipient'] in (application['applicant'], application['provider'])
        assert d['recipient_access_current'] and d['explicit_confirmation']
    elif rule == 'wang_handoff_confirmation':
        audit = d['audit']
        assert d['accepted_at'] and d['acceptance_audit_event_id'] == audit['id']
        assert audit['conversation'] == d['conversation'] and audit['resource_reference'] == d['handoff_id']
        assert audit['resource_type'] == 'support_handoff'
        assert audit['action_code'] == 'handoff_transition' and audit['to_state'] == 'accepted'
        assert audit['outcome'] == 'succeeded' and audit['result_revision'] <= d['revision']
        if audit['actor_kind'] == 'user':
            assert d['receiver'] and audit['actor_user'] == d['receiver']
        else:
            assert audit['actor_kind'] == 'external_receiver' and d['resource'] and d['external_authenticated']
    elif rule == 'wang_identity_scope':
        for left, right in [
            ('staff', 'credential_subject'), ('consent_subject', 'guardian_subject'),
            ('consent_decider', 'guardian_user'), ('case_conversation', 'case_message_conversation'),
            ('case_conversation', 'case_decision_conversation'), ('handoff_conversation', 'handoff_case_conversation'),
            ('handoff_receiver', 'grant_recipient'), ('handoff_snapshot', 'grant_snapshot'),
            ('confirmation_root', 'record_root'), ('confirmation_version', 'record_version'),
            ('snapshot_event', 'snapshot_conversation_event'), ('snapshot_source_conversation', 'snapshot_record_conversation'),
            ('request_event', 'request_conversation_event'), ('request_conversation', 'request_target_conversation'),
        ]:
            assert d[left] == d[right], (left, right)
    elif rule == 'appointment_conflicts':
        active = [row for row in d['rows'] if row['status'] in ('confirmed', 'completed', 'no_show')]
        for i, row in enumerate(active):
            assert row['start'] < row['end']
            for other in active[i + 1:]:
                same_party = row['consultant'] == other['consultant'] or row['applicant'] == other['applicant']
                overlap = row['start'] < other['end'] and other['start'] < row['end']
                assert not (same_party and overlap)
        assert not (d['unresolved_legacy'] and d['automatic_confirmation'])
    elif rule == 'wang_case_provenance':
        scenario, expected = d['scenario'], d['expected']
        sources = {s['ordinal']: s for s in d['sources']}
        assert len(sources) == len(d['sources'])

        def source(ordinal, origin, for_input):
            row = sources[ordinal]
            assert row['case_id'] == d['case_id'] and row['permitted']
            if origin in ('quoted', 'observed'):
                assert row['source_role'] == 'observation'
            if for_input:
                assert row['visible_to_actor'] and row['before_input']
            return row

        for ordinal in scenario['current_input_source_ordinals']:
            row = source(ordinal, scenario['current_input_origin'], True)
            if scenario['actor']['participant_id'] is not None:
                assert row['participant_id'] == scenario['actor']['participant_id']
        if scenario['current_input_origin'] in ('quoted', 'summarized'):
            assert scenario['current_input_source_ordinals']
        for context in scenario['authorized_context']:
            if context['source_ordinal'] is None:
                assert context['origin'] == 'simulated'
            else:
                source(context['source_ordinal'], context['origin'], True)
        outcome = expected['outcome_reference']
        if outcome['origin'] == 'observed':
            assert outcome['source_ordinals'] and outcome['feedback_summary']
        for ordinal in outcome['source_ordinals']:
            source(ordinal, outcome['origin'], False)
        assert d['model_input_fields'] == ['scenario']
    elif rule == 'wang_review_scores':
        review, rubric = d['review'], d['rubric']
        scale, _ = review_quality(review)
        assert review['rubric'] == rubric['version'] and scale == rubric['scale_code']
        assert {r['criterion_id']: r['weight'] for r in review['scores']['ratings']} == rubric['weights']
        if review['safety_failure'] or review['authorization_failure']:
            assert review['verdict'] == 'fail'
        if d['automatic_threshold_decision']:
            assert rubric['pass_threshold'] is not None and rubric['minimum_dimension_score'] is not None and d['calibration_approved']
            if review['safety_failure'] or review['authorization_failure']:
                assert review['verdict'] == 'fail'
            elif review['scores']['normalized_quality'] is None:
                assert review['verdict'] == 'needs_review'
            else:
                passed = review['scores']['raw_total'] >= rubric['pass_threshold'] and all(r['raw_score'] >= rubric['minimum_dimension_score'] for r in review['scores']['ratings'])
                assert review['verdict'] == ('pass' if passed else 'fail')
    elif rule == 'wang_skill_composition':
        rule_row, route = d['rule'], d['route']
        assert route['skill_codes'] == rule_row['skill_codes']
        assert route['skill_codes'][0] == route['skill_code'] == rule_row['skill_code'] == d['primary_skill']
        assert len(set(route['skill_codes'])) == len(route['skill_codes']) and 1 <= len(route['skill_codes']) <= 8
        assert set(route['skill_codes']) <= set(d['registered_skill_codes'])
        assert set(route['skill_codes']) <= set(d['allowed_skill_codes'])
        assert all(r['policy'] == d['policy'] for r in d['evaluated_rules'])
        assert route['candidate_route_codes'] == sorted({r['route_code'] for r in d['evaluated_rules']})
        assert route['strategy_code'] in route['candidate_route_codes']
        assert set(route['allowed_tools']) <= set(d['implemented_tool_codes'])
        assert not d['claims_skill_effect_from_plan']
        if d['allowed_skill_sequences']:
            assert route['skill_codes'] in d['allowed_skill_sequences']
    elif rule == 'evaluation_metrics':
        samples = {s['id']: s for s in d['samples']}
        metrics = d['metrics']
        assert metrics['case_count'] == len({s['case'] for s in samples.values()})
        for status in ('completed','error','blocked'):
            assert metrics[status + '_sample_count'] == sum(s['status'] == status for s in samples.values())
        assert metrics['mean_quality'] is None
        latest, revisions = {}, set()
        for review in d['reviews']:
            review_quality(review)
            key = tuple(review[k] for k in ('sample','kind','user','provider','model','rubric'))
            assert review['sample'] in samples and review['revision'] > 0
            assert (*key, review['revision']) not in revisions
            revisions.add((*key, review['revision']))
            if key not in latest or latest[key]['revision'] < review['revision']:
                latest[key] = review
        groups = collections.defaultdict(lambda: collections.defaultdict(list))
        for review in latest.values():
            if samples[review['sample']]['status'] == 'completed':
                scale, quality = review_quality(review)
                per_sample = groups[(*tuple(review[k] for k in ('kind','provider','model','rubric')), scale)]
                if quality is not None:
                    per_sample[review['sample']].append(quality)
        safety_cases = {s['case'] for s in samples.values() if s.get('safety_failure')}
        safety_cases.update(samples[r['sample']]['case'] for r in latest.values() if r.get('safety_failure'))
        assert metrics['safety_failure_count'] == len(safety_cases)
        authorization_cases = {s['case'] for s in samples.values() if s.get('authorization_failure')}
        authorization_cases.update(samples[r['sample']]['case'] for r in latest.values() if r.get('authorization_failure'))
        assert metrics['authorization_failure_count'] == len(authorization_cases)
        assert metrics['route_mismatch_count'] == len({s['case'] for s in samples.values() if s.get('route_mismatch')})
        buckets = {tuple(b[k] for k in ('reviewer_kind','judge_provider_code','judge_model','rubric_version','score_scale')): b for b in metrics['quality_by_reviewer']}
        assert len(buckets) == len(metrics['quality_by_reviewer']) and set(buckets) == set(groups)
        for key, per_sample in groups.items():
            means = [sum(scores) / len(scores) for scores in per_sample.values()]
            assert buckets[key]['reviewed_sample_count'] == len(means)
            if means:
                assert abs(buckets[key]['mean_quality'] - sum(means) / len(means)) < 1e-9
            else:
                assert buckets[key]['mean_quality'] is None
    elif rule == 'wang_m4_links':
        consent, session = d['consent'], d['session']
        assert consent['subject_user'] is None and consent['participant'] in session['participants']
        assert session['participant'] in session['participants']
        assert consent['research_session'] == session['id'] and consent['source'] == 'verified_document'
        assert (d['asset']['file'], d['asset']['digest']) == (d['file']['id'], d['file']['digest'])
        assert d['case']['parent_group'] == d['case']['group']
        assert d['case']['reviewer'] == d['case_credential']['subject']
        assert d['case']['credential'] == d['case_credential']['id']
        request, actor = d['request'], d['requester']
        assert request['requester_participant'] == actor['id'] and request['requester_user'] is None
        if request['scope'] == 'research_participant':
            assert request['participant'] == actor['id'] and request['asset'] is None
        else:
            assert request['scope'] == 'corpus_asset' and request['participant'] is None
            assert request['asset'] == d['asset']['id'] and actor['id'] in session['participants']
        review = d['review']
        if review['kind'] == 'expert':
            assert review['user'] == d['review_credential']['subject'] and review['credential'] == d['review_credential']['id']
            assert review['model'] is None and review['provider'] is None
        elif review['kind'] == 'model':
            assert review['model'] and review['provider'] and review['user'] is None and review['credential'] is None
        else:
            assert review['kind'] == 'rule' and not any(review[k] for k in ('user','credential','model','provider'))
        assert not (review['safety_failure'] or review.get('authorization_failure')) or review['verdict'] == 'fail'
        assert d['approved_at'] and d['released_at'] >= d['approved_at']
    elif rule == 'wang_m3_links':
        person, link = d['person'], d['person_event']
        assert (link['owner'], link['person']) == (person['owner'], person['id'])
        app, origin = d['application'], d['origin']
        assert (app['origin'], app['event'], app['applicant']) == (origin['id'], origin['event'], origin['owner'])
        assert (d['note']['conversation'], d['note']['application']) == (d['professional']['id'], d['professional']['application'])
        notification, handoff = d['notification'], d['handoff']
        assert (notification['conversation'], notification['handoff']) == (handoff['conversation'], handoff['id'])
        assert (notification['resource'], notification['recipient']) == (handoff['resource'], handoff['receiver'])
        assert (d['request_notification']['conversation'], d['request_notification']['request']) == (d['request']['conversation'], d['request']['id'])
        receipt, attempt = d['receipt'], d['attempt']
        if receipt['correlation'] == 'matched':
            assert (receipt['provider'], receipt['attempt']) == (attempt['provider'], attempt['id'])
            assert receipt['request_key'] or receipt['message_id']
            if receipt['request_key']: assert receipt['request_key'] == attempt['request_key']
            if receipt['message_id']: assert receipt['message_id'] == attempt['message_id']
        else:
            assert receipt['attempt'] is None
    elif rule == 'wang_m2_links':
        conversations = {c['id']: c for c in d['conversations']}
        exercise, followup, session = d['exercise'], d['followup'], d['session']
        private = conversations[exercise['conversation']]
        assert private['kind'] == 'private' and (exercise['event'], exercise['owner']) == (private['event'], private['owner'])
        target = conversations[followup['conversation']]
        assert target['kind'] == 'private' and (followup['event'], followup['user']) == (target['event'], target['owner'])
        assert (followup['conversation'], followup['exercise']) == (exercise['conversation'], exercise['id'])
        intake = conversations[session['conversation']]
        assert intake['kind'] == 'intake' and session['subject'] == intake['owner']
        assert (session['conversation'], session['replaces']) == (d['previous_session']['conversation'], d['previous_session']['id'])
        assert (d['submission']['conversation'], d['submission']['insight']) == (d['insight']['conversation'], d['insight']['id'])
        assert (d['message']['conversation'], d['message']['exercise']) == (exercise['conversation'], exercise['id'])
        assert (d['action']['conversation'], d['action']['applied_version']) == (d['applied_version']['conversation'], d['applied_version']['id'])
        assert (d['method']['reviewer'], d['method']['credential']) == (d['credential']['subject'], d['credential']['id'])
    elif rule == 'wang_scope_links':
        conversations = {c['id']: c for c in d['conversations']}
        applications = {a['id']: a for a in d['applications']}
        messages = {m['id']: m for m in d['messages']}
        for conversation in conversations.values():
            if conversation['kind'] == 'professional':
                application = applications[conversation['application']]
                assert (application['event'], application['applicant']) == (conversation['event'], conversation['owner'])
            else:
                assert conversation['application'] is None
        run = d['run']
        assert conversations[run['conversation']]['event'] == run['event']
        for name in ('trigger', 'response'):
            if run[name] is not None:
                assert messages[run[name]]['conversation'] == run['conversation']
    elif rule == 'wang_evaluation_state':
        expected, output = d['expected'], d['output']
        if 'advice_declined' in expected:
            assert output['state_after']['advice_declined'] == expected['advice_declined']
        if 'declined_method_keys' in expected:
            assert {m['method_key'] for m in output['state_after']['declined_methods']} == set(expected['declined_method_keys'])
        if 'safety_state' in expected:
            assert output['safety_state_after'] == expected['safety_state']
        for field in ('insight_state', 'relationship_dependency'):
            if field in expected:
                assert output['state_after'][field] == expected[field]
        if 'support_preference' in expected:
            assert output['state_after']['support_preference']['mode'] == expected['support_preference']
        if 'mechanism_statuses' in expected:
            statuses = {h['hypothesis_key']: h['status'] for h in output['state_after']['mechanism_hypotheses']}
            assert len(statuses) == len(output['state_after']['mechanism_hypotheses'])
            assert len({h['hypothesis_key'] for h in expected['mechanism_statuses']}) == len(expected['mechanism_statuses'])
            for hypothesis in expected['mechanism_statuses']:
                assert statuses[hypothesis['hypothesis_key']] == hypothesis['status']
    elif rule == 'wang_decision_evidence':
        sources = {s['id']: s for s in d['sources']}
        assert set(d['evidence_ids']) <= set(sources)
        for source_id in d['evidence_ids']:
            assert sources[source_id]['conversation'] == d['conversation']
            assert sources[source_id]['decision'] == d['decision'] and sources[source_id]['authorized']
        if d['understanding_confirmed']:
            source = sources[d['confirmation_source_id']]
            assert source['id'] in d['evidence_ids'] and source['user_confirmation']
        else:
            assert d['confirmation_source_id'] is None
        for hypothesis in d['hypotheses']:
            assert hypothesis['status'] == 'unconfirmed'
            assert hypothesis['source_ids'] and set(hypothesis['source_ids']) <= set(d['evidence_ids'])
        if d['risk_signal'] not in ('none', 'unknown'):
            assert d['evidence_ids'] and d['risk_reason']
    else:
        raise AssertionError('unknown fixture rule: ' + rule)


def render_dictionary(model, bundle):
    out = [f"# Reso V{model['design_version']} 数据库字段字典（目标设计）", '',
           '初稿：2026-11-16；更新：2026-11-17。配套[数据库目标设计](database-design-v2.md)与[JSON 契约](database-json-contracts-v2.json)。现有业务库未迁移；M1a/M1 的一次性合成库验证和维护台账字段见[隔离验收](database-m1-isolated-acceptance.md)。', '',
           '由 [database-model-v2.json](database-model-v2.json) 生成；修改模型后运行 `uv run scripts/check-database-design.py --write`，再去掉 `--write` 复查。', '',
           '字段表列新增／改变／显式保留契约的列；其余沿用 0001–0007，不是最终总列数。可空性指目标状态；回填期可空另见主设计。新增表列出完整业务字段。', '',
           '类型使用 PostgreSQL；默认值为设计值，SQL 实现时需加正确引号和类型。所有 JSONB 绑定 schema；SQL NULL 与 JSON null 不等同。表内“约束”同时列出数据库约束和必须在事务内复验的业务规则，不把跨表检查写作 CHECK。', '',
           'M1＝分域／身份／版本／安全与 Agent；M2＝测评／卡片／练习／方法；M3＝人物／服务／通知；M4＝研究评测。后期目标 FK 延迟到该阶段上线。', '',
           '## 目标清单', '', '| 表 | 处理 | 阶段 | 用途 |', '| --- | --- | --- | --- |']
    for t in model['tables']:
        out.append(f"| [{t['name']}](#{t['name']}) | {t['mode']} | {t['phase']} | {t['purpose']} |")
    group = None
    for t in model['tables']:
        if group != t['group']:
            group = t['group']
            out += ['', '## ' + group, '']
        out += ['### ' + t['name'], '', f"**{t['mode']} · {t['phase']}。** {t['purpose']}", '']
        if t['fields']:
            out += ['| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |', '| --- | --- | --- | --- | --- |']
            for f in t['fields']:
                note = (f"→ `{f['reference']}`。" if f['reference'] else '') + f['note']
                if f.get('json_contract'):
                    binding = bundle['x-field-bindings'][t['name'] + '.' + f['name']]
                    note += f" JSON：`{f['json_contract']}`（v{binding['version']}）。"
                    if binding.get('read_versions'):
                        note += ' 旧版本只读：' + '、'.join(v for v in binding['read_versions'] if int(v) != binding['version']) + '。'
                out.append(f"| `{f['name']}` | `{f['type']}` | {'是' if f['nullable'] else '否'} | {f['default'] if f['default'] is not None else '无'} | {note.replace('|', '/')} |")
            out += ['']
        for label, key in [('约束', 'keys'), ('索引', 'indexes')]:
            out += [label + '：' + '；'.join(t[key]) + '。', '']
        if t.get('candidate_keys'):
            out += ['复合关系使用的完整唯一键：' + '；'.join('UNIQUE(' + ','.join(k) + ')' for k in t['candidate_keys']) + '。', '']
        for relation in model['composite_relationships']:
            if relation['from_table'] == t['name']:
                out += [f"组合外键 `{relation['name']}`：({','.join(relation['columns'])}) → {relation['to_table']}({','.join(relation['target_columns'])})；ON DELETE {relation['on_delete']}；" + ('DEFERRABLE INITIALLY DEFERRED。' if relation['deferrable'] else '即时检查。'), '']
        out += ['权限：' + t['access'], '', '删除／留存：' + t['deletion'], '']
    out += ['## 复用对象', '', '认证 user/session/account/verification、schema_migrations 和 pg-boss 内部表沿用原系统。ASR 原始音频不自动落库；未保存本机草稿不新增表。', '']
    return '\n'.join(out)


def render_coverage(model):
    out = ['## 18．64 项交付清单到数据库对象的映射', '',
           '只表示设计覆盖；原工作包的实现状态不变。', '',
           '| 清单 ID | 数据库对象 | 设计承担的部分 |', '| --- | --- | --- |']
    for task, data in model['coverage'].items():
        tables = '、'.join('`' + name + '`' for name in data['tables']) or '无新增业务表'
        out.append(f"| {task} | {tables} | {data['note']} |")
    return '\n'.join(out) + '\n'


def check(write=False):
    model, bundle, examples = (load(n) for n in ('database-model-v2.json', 'database-json-contracts-v2.json', 'database-contract-examples-v2.json'))
    tables = {t['name']: t for t in model['tables']}
    assert len(tables) == len(model['tables'])
    baseline = set(model['baseline_columns'])
    assert len(baseline) == 21
    assert {t['name'] for t in tables.values() if t['mode'] != '新增'} == baseline
    columns = {k: set(v) for k, v in model['baseline_columns'].items()}
    columns['user'] = {'id', 'name', 'email'}
    for t in tables.values():
        names = [f['name'] for f in t['fields']]
        assert len(names) == len(set(names)), t['name']
        columns.setdefault(t['name'], set()).update(names)
    references = 0
    for t in tables.values():
        for f in t['fields']:
            if f['reference']:
                target, column = f['reference'].split('.')
                assert column in columns[target], (t['name'], f['name'], f['reference'])
                references += 1
    relation_names = set()
    for relation in model['composite_relationships']:
        assert relation['name'] not in relation_names and len(relation['name']) <= 63
        relation_names.add(relation['name'])
        assert len(relation['columns']) == len(relation['target_columns'])
        assert set(relation['columns']) <= columns[relation['from_table']], relation
        assert set(relation['target_columns']) <= columns[relation['to_table']], relation
        assert relation['target_columns'] in tables[relation['to_table']]['candidate_keys'], relation
        assert relation['on_delete'] in ('NO ACTION', 'RESTRICT')
        if relation['deferrable']:
            assert relation['on_delete'] == 'NO ACTION', 'RESTRICT cannot defer a cyclic deletion'
    directory = ROOT / 'server/migrations'
    migrations = model['baseline_migrations'] + model['runtime_migrations_after_baseline']
    for migration in migrations:
        path = directory / migration['name']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == migration['checksum'], path
    assert {p.name for p in directory.glob('*.sql')} == {m['name'] for m in migrations}, 'migration files changed'
    expected_ids = {f'{g}{i:02}' for g, count in dict(A=8, B=7, C=9, D=7, E=8, F=6, G=9, H=10).items() for i in range(1, count + 1)}
    assert set(model['coverage']) == expected_ids
    external = {'user', 'session', 'account', 'verification', 'schema_migrations', 'pgboss'}
    for data in model['coverage'].values():
        assert set(data['tables']) <= set(tables) | external

    Draft202012Validator.check_schema(bundle)
    bindings = bundle['x-field-bindings']
    actual = {t['name'] + '.' + f['name']: f for t in tables.values() for f in t['fields'] if f['type'] == 'jsonb'}
    assert set(actual) == set(bindings), ('unbound JSONB', set(actual) ^ set(bindings))
    assert set(model['legacy_jsonb_fields']) <= set(bindings) | set(bundle['x-legacy-bindings'])
    validators, read_validators, version_columns = {}, {}, {}
    for field, binding in bindings.items():
        assert actual[field]['json_contract'] == binding['schema']
        assert type(binding['version']) is int and binding['version'] > 0
        if binding['version_column']:
            table = field.split('.')[0]
            version_column = binding['version_column']
            assert version_column in columns[table]
            version_field = next(f for f in tables[table]['fields'] if f['name'] == version_column)
            assert version_field['type'] == 'integer' and not version_field['nullable'], (field, 'version column must be a required integer')
            assert int(version_field['default']) == binding['version'], (field, 'version default mismatch')
            key = table, version_column
            assert key not in version_columns or version_columns[key] == binding['version'], (field, 'shared version mismatch')
            version_columns[key] = binding['version']
        schema = {'$defs': bundle['$defs'], '$ref': '#/$defs/' + binding['schema']}
        validators[field] = Draft202012Validator(schema, format_checker=FormatChecker())
        read_validators[field] = {binding['version']: validators[field]}
        for version, definition in binding.get('read_versions', {}).items():
            assert binding['version_column'], (field, 'breaking change needs an explicit version column')
            assert version.isdecimal() and int(version) > 0 and definition in bundle['$defs']
            if int(version) == binding['version']:
                assert definition == binding['schema']
            read_validators[field][int(version)] = Draft202012Validator(
                {'$defs': bundle['$defs'], '$ref': '#/$defs/' + definition}, format_checker=FormatChecker())
        default = actual[field]['default']
        if default is not None:
            validators[field].validate(load_json(default))
    assert set(examples['field_examples']) == set(bindings)
    json_checks = 0
    for field, pair in examples['field_examples'].items():
        for name, valid in [('valid', True), ('invalid', False)]:
            value = pair[name]
            assert len(json.dumps(value, ensure_ascii=False).encode()) <= 262144
            errors = list(validators[field].iter_errors(value))
            assert (not errors) == valid, (field, name, str(errors[0])[:200] if errors else 'unexpectedly valid')
            json_checks += 1
    for fixture in examples['json_cases']:
        binding = bindings[fixture['field']]
        operation = fixture.get('operation', 'write')
        assert operation in ('read', 'write')
        validator = read_validators[fixture['field']].get(fixture['version']) if operation == 'read' else (
            validators[fixture['field']] if fixture['version'] == binding['version'] else None)
        valid = validator is not None and validator.is_valid(fixture['data'])
        assert valid == fixture['valid'], fixture['name']
        json_checks += 1
    for fixture in examples['semantic_cases']:
        try:
            semantic_case(fixture['rule'], fixture['data'])
            valid = True
        except (AssertionError, KeyError):
            valid = False
        assert valid == fixture['valid'], fixture['name']
    required_rules = {'private_hint', 'expression_privacy', 'wang_support_preference', 'wang_mechanism_history', 'wang_support_feedback', 'wang_case_provenance', 'wang_review_scores', 'wang_skill_composition', 'assessment_progress', 'assessment_submission', 'rectification', 'record_lineage', 'research_lineage', 'research_roster_history', 'data_request', 'legacy_domains', 'appointment_history', 'notification_history', 'invite_replay', 'record_content', 'audit_transition', 'wang_rule_lineage', 'wang_practice_choice', 'wang_state_transition', 'wang_decision_evidence', 'wang_evaluation_state', 'wang_scope_links', 'wang_identity_scope', 'wang_handoff_confirmation', 'wang_professional_grant', 'wang_m2_links', 'wang_m3_links', 'appointment_conflicts', 'wang_m4_links', 'evaluation_metrics', 'record_parent', 'note_signature', 'professional_recommendation', 'followup_origin'}
    assert {f['rule'] for f in examples['semantic_cases']} == required_rules
    for rule in required_rules:
        assert {f['valid'] for f in examples['semantic_cases'] if f['rule'] == rule} == {True, False}, rule
    for name in ('DraftAnswers', 'SubmittedAnswers'):
        assert list(bundle['$defs'][name]['patternProperties']) == [bundle['$defs']['Code']['pattern']], 'Question and answer ID alphabets differ'

    dictionary = DOCS / 'database-field-dictionary-v2.md'
    rendered = render_dictionary(model, bundle)
    design = DOCS / 'database-design-v2.md'
    marker = '<!-- COVERAGE_MAP -->'
    assert marker in design.read_text()
    updated = design.read_text().split(marker)[0] + marker + '\n\n' + render_coverage(model)
    assert f"目标清单共 {len(tables)} 张" in updated, 'design table count is stale'
    assert f"{len(relation_names)} 个核心复合关系" in updated, 'design relationship count is stale'
    for phase, count in collections.Counter(t['phase'] for t in tables.values() if t['mode'] == '新增').items():
        assert re.search(r'\| ' + phase + r' [^|]+\| ' + str(count) + r' \|', updated), (phase, count)
    if write:
        dictionary.write_text(rendered)
        design.write_text(updated)
    else:
        assert dictionary.read_text() == rendered, 'dictionary is stale; run --write'
        assert design.read_text() == updated, 'coverage is stale; run --write'
    links = 0
    for document in [dictionary, design, DOCS / 'database-design-review-2026-11-16.md', DOCS / 'wang-database-foundation-2026-11-16.md', DOCS / 'database-drafts/README.md', DOCS / 'database.md']:
        for target in re.findall(r'\]\(([^)]+)\)', document.read_text()):
            if target.startswith(('http:', 'https:')):
                continue
            name, _, anchor = target.partition('#')
            path = document.parent / name if name else document
            assert path.exists(), (document.name, target)
            if anchor and document == dictionary:
                assert anchor in tables, anchor
            links += 1
    stats = {'tables': len(tables), 'existing_tables': len(baseline),
             'new_tables': sum(t['mode'] == '新增' for t in tables.values()),
             'documented_field_rows': sum(len(t['fields']) for t in tables.values()),
             'field_reference_annotations': references, 'jsonb_field_bindings': len(bindings),
             'composite_relationships': len(relation_names),
             'legacy_json_fields': len(bundle['x-legacy-bindings']), 'json_example_checks': json_checks,
             'semantic_example_checks': len(examples['semantic_cases']), 'coverage_items': len(expected_ids),
             'new_by_phase': dict(collections.Counter(t['phase'] for t in tables.values() if t['mode'] == '新增')),
             'local_links': links, 'migration_files_unchanged': len(model['baseline_migrations']),
             'later_runtime_migrations_checked': len(model['runtime_migrations_after_baseline'])}
    print(json.dumps(stats, ensure_ascii=False, indent=2))


def check_m1_imports(path):
    rows = load_json(Path(path).read_text())
    assert isinstance(rows, list) and rows, 'No imported JSON evidence'
    for row in rows:
        assert set(row) == {'content', 'confirmation_scope'}
        assert len(json.dumps(row, ensure_ascii=False).encode()) <= 262144
        contract_validator('RecordContent').validate(row['content'])
        contract_validator('ConfirmationScope').validate(row['confirmation_scope'])
        assert row['confirmation_scope'] == {'type': 'legacy_unknown'}
    print(json.dumps({'m1_imported_json_contracts': len(rows) * 2}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='regenerate dictionary and coverage map only')
    mode.add_argument('--m1-imports', help='validate synthetic JSON read back from the isolated M1 rehearsal')
    args = parser.parse_args()
    if args.m1_imports:
        check_m1_imports(args.m1_imports)
    else:
        check(args.write)

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { Pool, escapeIdentifier } from 'pg'
import type { PoolClient } from 'pg'
import model from '../docs/database-model-v2.json'
import { isolatedM1Target } from '../scripts/verify-m1'
import { initializeDatabase } from './setup-database'
import { migrate, migrationFiles, verifyMigrations } from './migrations'
import { backfillM1, m1ImportId } from './m1-backfill'
import { configureM1ReadAccess, withM1ReadScope } from './m1-access'
import { configureRuntimeAccess, assertRuntimeRole } from './database-access'
import { nativeJsonSha256 } from './policy-integrity'
import { createApp } from './app'

const e1 = '10000000-0000-4000-8000-000000000001', e2 = '10000000-0000-4000-8000-000000000002'
const raw = '原文 😊 e\u0301\n第二行', snapshotText = '旧快照 e\u0301，不是当前理解'
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const count = async (pool: Pool, table: string) => Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)
const imported = (event: string, kind: string, owner = 'owner') => m1ImportId(['conversation', event, kind, kind === 'room' ? '' : owner])
const denied = (error: unknown) => (error as { code: string }).code === '42501'

async function allRows(pool: Pool) {
  const rows: Record<string, string> = {}
  for (const { table_schema, table_name } of (await pool.query(`SELECT table_schema,table_name FROM information_schema.tables
    WHERE table_schema IN ('public','pgboss','reso_migration') AND table_type='BASE TABLE' ORDER BY 1,2`)).rows) {
    const name = `${escapeIdentifier(table_schema)}.${escapeIdentifier(table_name)}`
    rows[table_schema + '.' + table_name] = digest(JSON.stringify((await pool.query(`SELECT to_jsonb(t) AS value FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows))
  }
  return rows
}

async function fingerprint(pool: Pool) {
  const output: Record<string, string> = {}
  for (const [table, columns] of Object.entries(model.baseline_columns)) {
    const projection = columns.map(escapeIdentifier).join(',')
    const rows = (await pool.query(`SELECT to_jsonb(old) AS value FROM (SELECT ${projection} FROM public.${escapeIdentifier(table)}) old ORDER BY to_jsonb(old)::text`)).rows
    output['public.' + table] = digest(JSON.stringify(rows))
  }
  const tables = (await pool.query(`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE'
    AND (table_schema='pgboss' OR (table_schema='public' AND table_name IN ('user','account','session','verification','schema_migrations'))) ORDER BY 1,2`)).rows
  for (const table of tables) {
    const name = escapeIdentifier(table.table_schema) + '.' + escapeIdentifier(table.table_name)
    output[table.table_schema + '.' + table.table_name] = digest(JSON.stringify((await pool.query(`SELECT to_jsonb(t) AS value FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows))
  }
  return output
}

async function catalog(pool: Pool) {
  return {
    tables: (await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`)).rows,
    columns: (await pool.query(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`)).rows,
    constraints: (await pool.query(`SELECT c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2`)).rows,
    indexes: (await pool.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2`)).rows,
  }
}

async function seed(pool: Pool) {
  await pool.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt")
    SELECT u,u,u||'@example.test',false,'2026-11-01','2026-11-01' FROM unnest(ARRAY['owner','member','removed','counselor']) u;
    INSERT INTO profiles(user_id,role) VALUES('owner','member'),('member','member'),('removed','member'),('counselor','counselor');
    INSERT INTO session(id,token,"expiresAt","createdAt","updatedAt","userId") VALUES('synthetic-session','synthetic-session-token','2099-01-01',now(),now(),'owner');
    INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES('synthetic-account','owner','credential','owner','synthetic-no-login-hash',now(),now());
    INSERT INTO verification(id,identifier,value,"expiresAt","createdAt","updatedAt") VALUES('synthetic-verification','synthetic@example.test','synthetic-value','2099-01-01',now(),now());
    INSERT INTO pgboss.job(id,name,data) VALUES(gen_random_uuid(),'agent.reply','{"synthetic":true}');`)
  await pool.query(`INSERT INTO events(id,owner_id,title,summary,summary_version,initial_summary,private_version,room_version,room_title,created_at,updated_at,room_updated_at)
    VALUES($1,'owner','私人标题','当前原摘要',3,'原初摘要',7,2,'房间公开标题','2026-11-01','2026-11-03','2026-11-02'),
      ($2,'member','第二人的私人标题','第二事件',1,'',1,0,'','2026-11-01','2026-11-02','2026-11-01')`, [e1, e2])
  await pool.query(`INSERT INTO members(event_id,user_id,active,joined_at) VALUES($1,'member',true,'2026-11-02'),($1,'removed',false,'2026-11-01')`, [e1])
  const messages: string[] = []
  for (const [event, domain, author, role, content, safety] of [[e1,'private','owner','user',raw,false], [e1,'private',null,'assistant','可能的解释',false], [e1,'room','member','user','房间原话',false], [e1,'room','owner','user','后续房间消息',false], [e2,'private','member','user','第二人的原话',false], [e1,'private',null,'assistant','旧关键词安全卡',true]] as const) {
    messages.push((await pool.query(`INSERT INTO messages(event_id,domain,author_id,author_name,role,content,card_type,created_at,client_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'2026-11-02',$8) RETURNING id`, [event, domain, author, author || 'Reso', role, content, safety ? 'safety' : null, randomUUID()])).rows[0].id)
  }
  const records: string[] = []
  for (const [message, domain, content, provenance, version] of [[messages[0],'private',raw,'user_quoted',3], [messages[1],'private','模型推测，不是事实','model_inference',1], [messages[2],'room','本人修正原话','user_corrected',2]] as const) {
    records.push((await pool.query(`INSERT INTO understandings(event_id,domain,author_id,source_message_id,content,provenance,version,created_at)
      VALUES($1,$2,'owner',$3,$4,$5,$6,'2026-11-02') RETURNING id`, [e1, domain, message, content, provenance, version])).rows[0].id)
  }
  await pool.query(`INSERT INTO understanding_confirmations(understanding_id,user_id,version,agreed,confirmed_at) VALUES($1,'owner',3,true,'2026-11-03'),($1,'owner',1,false,'2026-11-01'),($2,'member',2,false,'2026-11-03')`, [records[0], records[2]])
  const snapshot = (await pool.query(`INSERT INTO share_snapshots(event_id,created_by,content,source_version,created_at) VALUES($1,'owner',$2,1,'2026-11-01') RETURNING id`, [e1, snapshotText])).rows[0].id
  await pool.query(`INSERT INTO share_grants(event_id,snapshot_id,granted_by,recipient_id,source,granted_at,revoked_at,revoked_by)
    VALUES($1,$2,'owner','member','user','2026-11-01',NULL,NULL),($1,$2,'owner','removed','legacy_import','2026-11-01','2026-11-02','owner')`, [e1, snapshot])
  await pool.query(`INSERT INTO invites(id,event_id,token_hash,snapshot_id,status,expires_at,created_at) VALUES(gen_random_uuid(),$1,$2,$3,'pending','2099-01-01','2026-11-01')`, [e1, digest('synthetic-invite'), snapshot])
  await pool.query(`INSERT INTO consent_records(user_id,consent_type,policy_version,action,occurred_at) VALUES('owner','local_test','legacy-unversioned','legacy_import','2026-11-01');
    INSERT INTO exercises(event_id,act,paused,notes,story,saved,version,practice_notes) VALUES('${e1}',2,true,'{"1":"旧笔记"}','原故事',false,4,'{"nvc":"原练习"}');
    INSERT INTO questionnaires(event_id,version,answers,scores,state) VALUES('${e1}','legacy','[1,2]',NULL,'draft');
    INSERT INTO perspectives(event_id,user_id,text,confirmed,version) VALUES('${e1}','member','原视角',false,2);
    INSERT INTO revisions(event_id,actor_id,kind,value) VALUES('${e1}','owner','legacy','{"original":true}');
    INSERT INTO followups(event_id,user_id,reflection,next_step) VALUES('${e1}','owner','原回访','待考虑');`)
  const consultant = (await pool.query(`INSERT INTO consultants(id,user_id,name,approach,qualifications,price) VALUES(gen_random_uuid(),'counselor','合成人员','unknown','test-only','unknown') RETURNING id`)).rows[0].id
  const application = (await pool.query(`INSERT INTO applications(id,client_id,event_id,applicant_id,consultant_id) VALUES(gen_random_uuid(),gen_random_uuid(),$1,'owner',$2) RETURNING id`, [e1, consultant])).rows[0].id
  await pool.query(`INSERT INTO consultation_notes(application_id,author_id,content,version) VALUES($1,'counselor','旧未签署纪要',1)`, [application])
  await pool.query(`INSERT INTO note_shares(application_id,recipient_id,granted_by,content,source_version) VALUES($1,'owner','counselor','旧分享',1)`, [application])
  await pool.query(`INSERT INTO agent_runs(id,event_id,domain,context_version,model,status,trigger_message_id,response_message_id,prompt_version,checkpoint,assessment,finished_at)
    VALUES(gen_random_uuid(),$1,'private',7,'legacy-model','complete',$2,$3,'old-prompt','{"node":"respond","stage":"unknown"}','{"legacy":true}','2026-11-02'),
    (gen_random_uuid(),$1,'room',2,'legacy-model','error',$4,NULL,NULL,'{"node":"plan"}',NULL,NULL)`, [e1, messages[0], messages[1], messages[2]])
  await pool.query(`INSERT INTO agent_actions(event_id,run_id,message_id,slot,base_version,proposal) SELECT $1,id,$2,0,7,'{"legacy":true}' FROM agent_runs WHERE domain='private'`, [e1, messages[1]])
  return { messages, records, snapshot, application }
}

test('M1 isolated migration, backfill, recovery and restricted-role rehearsal', { skip: !process.env.RESO_M1_VERIFY_RUN, timeout: 240000 }, async t => {
  const target = await isolatedM1Target(), admin = new Pool({ connectionString: target.url.toString() })
  const suffix = randomBytes(8).toString('hex'), name = 'm1_case_' + suffix, url = new URL(target.url)
  const databases = [name], pools: Pool[] = [], roles: string[] = [], scenarios: string[] = []
  const evidence: Record<string, unknown> = {}, secret = randomBytes(32).toString('hex')
  await admin.query(`CREATE DATABASE "${name}"`); url.pathname = '/' + name
  const pool = new Pool({ connectionString: url.toString() }); pools.push(pool)
  const check = async (title: string, run: () => Promise<void>) => t.test(title, async () => { await run(); scenarios.push(title) })
  const fresh = async (prefix: string) => {
    const db = prefix + '_' + randomBytes(8).toString('hex'); databases.push(db)
    await admin.query(`CREATE DATABASE "${db}"`)
    const next = new URL(target.url); next.pathname = '/' + db
    const connection = new Pool({ connectionString: next.toString() }); pools.push(connection)
    return { pool: connection, url: next }
  }
  const roleUrl = (base: URL, role: string) => { roles.push(role); const next = new URL(base); next.username = role; next.password = randomBytes(32).toString('hex'); return next.toString() }
  const restoreEncrypted = async (label: string) => {
    const start = Date.now()
    const dump = execFileSync('docker', ['exec', target.containerId, 'pg_dump', '-U', 'm1_verify', '--no-owner', '--no-privileges', name], { maxBuffer: 32 * 1024 * 1024 })
    const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(dump), cipher.final()]), tag = cipher.getAuthTag()
    await writeFile(`${target.evidenceDirectory}/${label}.sql.enc`, Buffer.concat([iv, tag, encrypted]), { mode: 0o600 })
    await writeFile(`${target.evidenceDirectory}/${label}.key`, key, { mode: 0o600 })
    const decrypt = (authTag: Buffer) => { const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(authTag); return Buffer.concat([d.update(encrypted), d.final()]) }
    assert.throws(() => decrypt(Buffer.alloc(16)))
    const restored = await fresh('m1_restore')
    execFileSync('docker', ['exec', '-i', target.containerId, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-U', 'm1_verify', '-d', restored.url.pathname.slice(1)], { input: decrypt(tag), stdio: ['pipe','pipe','pipe'] })
    return { ...restored, elapsedMs: Date.now() - start, sha256: digest(dump) }
  }
  try {
    await initializeDatabase(url.toString(), secret)
    const fixture = await seed(pool), before = await fingerprint(pool), oldLedger = (await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows
    Object.assign(evidence, {
      fixture_snapshot_at: (await pool.query('SELECT now() AS cutoff')).rows[0].cutoff,
      fixture_snapshot_sha256: digest(JSON.stringify(before)),
      converter_version: 1,
      converter_sha256: digest(await readFile(new URL('./m1-backfill.ts', import.meta.url))),
      migration_checksums: (await migrationFiles('m1')).map(({name,checksum}) => ({name,checksum})),
    })
    await mkdir(target.evidenceDirectory, { recursive: true, mode: 0o700 })
    await check('R03 encrypted full backup restores authentication, queue and all legacy rows in a separate database', async () => {
      const restored = await restoreEncrypted('legacy-backup')
      assert.deepEqual(await fingerprint(restored.pool), before)
      await verifyMigrations(restored.pool)
      const runtime = roleUrl(restored.url, 'm1_restore_app_' + suffix)
      await configureRuntimeAccess(restored.url.toString(), runtime)
      const service = await createApp({ databaseUrl: runtime, secret, startJobs: false })
      try { assert.equal((await service.app.inject({ method: 'GET', url: '/api/status' })).statusCode, 200) }
      finally { await service.app.close() }
      evidence.restore_ms = restored.elapsedMs
      evidence.backup_sha256 = restored.sha256
      evidence.legacy_tables_reconciled = Object.keys(before).length
    })
    await check('A02/A03 M1a DDL failure rolls back the entire batch and migration ledger', async () => {
      await pool.query('CREATE TABLE file_objects (collision integer)')
      await assert.rejects(migrate(pool, 'm1a'), /already exists/)
      assert.equal((await pool.query("SELECT to_regclass('policy_versions') AS name")).rows[0].name, null)
      assert.deepEqual((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows, oldLedger)
      await verifyMigrations(pool); await pool.query('DROP TABLE file_objects')
    })
    await check('A01/A02 M1a upgrade serializes concurrent invocations and defaults remain at seven migrations', async () => {
      assert.equal((await migrationFiles()).length, 7)
      await assert.rejects(migrationFiles('unknown' as 'm1'), /Unknown/)
      await Promise.all([migrate(pool, 'm1a'), migrate(pool, 'm1a')]); await verifyMigrations(pool, 'm1a')
      await assert.rejects(verifyMigrations(pool), /mismatch/)
      assert.equal(await count(pool, 'conversations'), 0)
    })
    await check('A05 cross-domain legacy run references stop the page without creating replacement evidence', async () => {
      await pool.query("UPDATE agent_runs SET trigger_message_id=$1 WHERE domain='private'", [fixture.messages[2]])
      try {
        await assert.rejects(backfillM1(pool,'m1a',1), /different event\/domain/)
        assert.equal(await count(pool,'conversations'), 0)
        assert.equal((await pool.query('SELECT count(*) FROM messages WHERE conversation_id IS NOT NULL')).rows[0].count, '0')
      } finally { await pool.query("UPDATE agent_runs SET trigger_message_id=$1 WHERE domain='private'", [fixture.messages[0]]) }
      await assert.rejects(pool.query("UPDATE understandings SET source_message_id=$1 WHERE id=$2", [fixture.messages[2], fixture.records[0]]), /foreign key constraint/)
      await assert.rejects(pool.query("INSERT INTO messages(event_id,domain,author_name,role,content) VALUES($1,'private','Synthetic','user','orphan')", [randomUUID()]), /foreign key constraint/)
    })
    await check('A04 M1a backfill commits whole pages and resumes without replacing original IDs or text', async () => {
      await pool.query(`CREATE FUNCTION public.m1_fail_page() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id='${e2}' THEN RAISE EXCEPTION 'synthetic page failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER m1_fail_page BEFORE INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION m1_fail_page()`)
      await assert.rejects(backfillM1(pool, 'm1a', 1), /synthetic page failure/)
      assert.equal(await count(pool, 'conversations'), 3)
      assert.equal((await pool.query('SELECT count(*) FROM messages WHERE event_id=$1 AND conversation_id IS NOT NULL', [e2])).rows[0].count, '0')
      await pool.query('DROP TRIGGER m1_fail_page ON conversations; DROP FUNCTION m1_fail_page()')
      const result = await backfillM1(pool, 'm1a', 1)
      assert.equal(result.conversations_created, 3)
      const repeat = await backfillM1(pool, 'm1a', 1); assert.equal(repeat.conversations_created, 0); assert.equal(repeat.mapped_items, 0)
      assert.deepEqual(await fingerprint(pool), { ...before, 'public.schema_migrations': (await fingerprint(pool))['public.schema_migrations'] })
      assert.equal((await pool.query('SELECT title FROM conversations WHERE id=$1', [imported(e2,'room','member')])).rows[0].title, null)
    })
    await check('A03 M1 incremental failure leaves M1a and its data intact, then retries once', async () => {
      await pool.query('ALTER TABLE profiles ADD COLUMN age_band_code integer')
      await assert.rejects(migrate(pool, 'm1'), /already exists/)
      assert.equal((await pool.query("SELECT to_regclass('record_versions') AS name")).rows[0].name, null)
      assert.equal(await count(pool, 'schema_migrations'), 8); assert.equal(await count(pool, 'conversations'), 6)
      await pool.query('ALTER TABLE profiles DROP COLUMN age_band_code')
      await Promise.all([migrate(pool, 'm1'), migrate(pool, 'm1')]); await verifyMigrations(pool, 'm1')
      assert.equal(await count(pool, 'schema_migrations'), 9)
      const files = await migrationFiles('m1')
      await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', ['tampered', files[8].name])
      await assert.rejects(migrate(pool, 'm1'), /Applied migration changed/)
      await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', [files[8].checksum, files[8].name])
      await pool.query("INSERT INTO schema_migrations(name,checksum) VALUES('9999_unknown.sql','unknown')")
      await assert.rejects(migrate(pool, 'm1'), /migrations missing/)
      await pool.query("DELETE FROM schema_migrations WHERE name='9999_unknown.sql'")
    })
    await check('A01 real PostgreSQL catalog equals the reviewed cumulative M1 including FK, CHECK, RLS and indexes', async () => {
      const reference = await fresh('m1_reference')
      await initializeDatabase(reference.url.toString(), secret)
      await reference.pool.query(await readFile(new URL('../docs/database-drafts/wang-m1.sql', import.meta.url), 'utf8'))
      assert.deepEqual(await catalog(pool), await catalog(reference.pool))
      const client = await pool.connect()
      try { await assert.rejects(client.query(await readFile(new URL('../docs/database-drafts/wang-m1.sql', import.meta.url), 'utf8')), /already exists/) }
      finally { await client.query('ROLLBACK'); client.release() }
    })
    await check('A04 a terminated backfill connection leaves no half version, source, root pointer or ledger entry', async () => {
      await pool.query(`CREATE FUNCTION public.m1_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(20); RETURN NEW; END $$;
        CREATE TRIGGER m1_pause BEFORE INSERT ON record_versions FOR EACH ROW EXECUTE FUNCTION m1_pause()`)
      const application = 'm1_fault_' + suffix, fault = new Pool({ connectionString: url.toString(), application_name: application, max: 1 }); pools.push(fault)
      fault.on('error', () => {})
      const pending = assert.rejects(backfillM1(fault, 'm1', 1), /terminat|connection|administrator/i)
      let pid: number | undefined
      for (let i = 0; i < 150; i++) {
        pid = (await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event='PgSleep'", [application])).rows[0]?.pid
        if (pid) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert(pid, 'Fault reached the intended isolated transaction')
      await pool.query('SELECT pg_terminate_backend($1)', [pid]); await pending
      assert.equal(await count(pool, 'record_versions'), 0); assert.equal(await count(pool, 'record_sources'), 0)
      assert.equal((await pool.query('SELECT count(*) FROM understandings WHERE current_record_version_id IS NOT NULL')).rows[0].count, '0')
      assert.equal((await pool.query(`SELECT count(*) FROM reso_migration.backfill_items WHERE source_key LIKE '%message_metadata%' OR source_key LIKE '%record%'`)).rows[0].count, '0')
      await pool.query('DROP TRIGGER m1_pause ON record_versions; DROP FUNCTION m1_pause()')
    })
    await check('A04/A06/A07/A08 M1 imports only provable current records, without inventing consent, signatures or old versions', async () => {
      const result = await backfillM1(pool, 'm1', 1)
      assert.equal(result.versions_created, 3); assert.equal(result.sources_created, 3)
      assert.equal(result.legacy_snapshots_without_proven_version, 1); assert.equal(result.confirmations_without_proven_version, 1)
      evidence.backfill = result
      const repeat = await backfillM1(pool, 'm1', 1)
      assert.equal(repeat.mapped_items, 0); assert.equal(repeat.versions_created, 0); assert.equal(repeat.sources_created, 0)
      const after = await fingerprint(pool); delete before['public.schema_migrations']; delete after['public.schema_migrations']; assert.deepEqual(after, before)
      const versions = (await pool.query('SELECT * FROM record_versions ORDER BY id')).rows
      for (const version of versions) {
        assert.equal(version.record_origin, 'legacy_import'); assert.deepEqual(version.confirmation_scope, { type: 'legacy_unknown' })
        assert.equal(version.content_sha256, nativeJsonSha256(version.content)); assert.equal(version.producing_decision_id, null)
        assert.equal(version.signed_by_user_id, null); assert.equal(version.signer_credential_id, null); assert.equal(version.signed_at, null)
      }
      assert.equal(versions.find(v => v.understanding_id === fixture.records[0]).content.text, raw)
      assert.equal(versions.find(v => v.understanding_id === fixture.records[1]).content.kind, 'hypothesis')
      assert.deepEqual((await pool.query('SELECT source_role FROM record_sources ORDER BY source_role')).rows.map(v => v.source_role), ['hypothesis','hypothesis','quote'])
      const oldSnapshot = (await pool.query('SELECT * FROM share_snapshots')).rows[0]
      assert.equal(oldSnapshot.content, snapshotText)
      assert.equal(oldSnapshot.source_record_version_id, null); assert.equal(oldSnapshot.payload, null); assert.equal(oldSnapshot.content_sha256, null)
      assert.equal((await pool.query('SELECT count(*) FROM understanding_confirmations WHERE record_version_id IS NOT NULL')).rows[0].count, '2')
      assert.equal((await pool.query('SELECT count(*) FROM understanding_confirmations WHERE membership_generation IS NOT NULL')).rows[0].count, '0')
      assert((await pool.query('SELECT * FROM share_grants')).rows.every(g => g.permissions.length === 0 && g.membership_generation === null))
      const runs = (await pool.query('SELECT * FROM agent_runs')).rows
      assert(runs.every(r => r.attempt_no === null && r.agent_policy_version_id === null && r.state_revision === null && r.input_manifest === null))
      assert(runs.every(r => r.checkpoint !== null && r.consent_epochs && Object.keys(r.consent_epochs).length === 0))
      assert.equal((await pool.query('SELECT content_kind FROM messages WHERE id=$1', [fixture.messages[5]])).rows[0].content_kind, 'card')
      for (const table of ['policy_versions','file_objects','agent_policy_rules','agent_decisions','agent_decision_rule_matches','agent_tool_calls','consent_grants','guardian_links','professional_credentials','staff_assignments','safety_cases','support_handoffs','data_requests','data_request_items']) assert.equal(await count(pool, table), 0, table)
      await writeFile(target.evidenceDirectory + '/imported-record-json.json', JSON.stringify(versions.map(v => ({ content: v.content, confirmation_scope: v.confirmation_scope }))), { mode: 0o600 })
    })
    await check('A04/A05 erased mappings, changed source bytes and native metadata fail without overwrite or resurrection', async () => {
      for (const [column, id, bad, original, expected] of [
        ['content', fixture.messages[0], raw + ' changed', raw, /source or mapping changed/],
        ['conversation_id', fixture.messages[5], null, imported(e1,'private'), /scope changed/],
        ['content_kind', fixture.messages[0], 'card', 'text', /metadata changed/],
      ] as const) {
        const update = `UPDATE messages SET ${escapeIdentifier(column)}=$1 WHERE id=$2`
        await pool.query(update, [bad, id])
        try { await assert.rejects(backfillM1(pool, 'm1', 1), expected) }
        finally { await pool.query(update, [original, id]) }
      }
      await pool.query('UPDATE understandings SET current_record_version_id=NULL WHERE id=$1', [fixture.records[0]])
      try { await assert.rejects(backfillM1(pool, 'm1', 1), /Mapped record was removed/) }
      finally { await pool.query('UPDATE understandings SET current_record_version_id=$1 WHERE id=$2', [m1ImportId(['record', fixture.records[0], '3']), fixture.records[0]]) }
      await pool.query('UPDATE events SET private_version=private_version+1 WHERE id=$1',[e1])
      try { await assert.rejects(backfillM1(pool,'m1',1), /source or mapping changed/) }
      finally { await pool.query('UPDATE events SET private_version=private_version-1 WHERE id=$1',[e1]) }
      await assert.rejects(pool.query("UPDATE record_versions SET content='{}' WHERE understanding_id=$1", [fixture.records[0]]), /check constraint/)
      assert.equal((await pool.query('SELECT content FROM messages WHERE id=$1', [fixture.messages[0]])).rows[0].content, raw)
    })
    const readerUrl = roleUrl(url, 'm1_reader_' + suffix), workerUrl = roleUrl(url, 'm1_worker_' + suffix)
    roles.push('m1_reader_' + suffix + '_scope')
    const reader = new Pool({ connectionString: readerUrl, max: 1 }), worker = new Pool({ connectionString: workerUrl, max: 1 }); pools.push(reader, worker)
    await check('A03 role configuration failure rolls back role creation, ACL and helper functions together', async () => {
      const role = 'm1_reader_' + suffix
      await pool.query('CREATE SCHEMA m1_read; CREATE TABLE m1_read.messages(collision integer)')
      const acl = (await pool.query('SELECT datacl FROM pg_database WHERE datname=current_database()')).rows
      await assert.rejects(configureM1ReadAccess(url.toString(), readerUrl), /not a view|already exists/)
      assert.equal((await pool.query('SELECT count(*) FROM pg_roles WHERE rolname IN ($1,$2)', [role, role + '_scope'])).rows[0].count, '0')
      assert.deepEqual((await pool.query('SELECT datacl FROM pg_database WHERE datname=current_database()')).rows, acl)
      assert.equal((await pool.query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='m1_read'")).rows[0].count, '0')
      await pool.query('DROP TABLE m1_read.messages; DROP SCHEMA m1_read')
    })
    await check('P02/P07 repeated role configuration preserves deny-by-default Worker and restricted M1 reader privileges', async () => {
      await configureRuntimeAccess(url.toString(), workerUrl)
      await configureM1ReadAccess(url.toString(), readerUrl); await configureM1ReadAccess(url.toString(), readerUrl)
      await configureRuntimeAccess(url.toString(), workerUrl)
      await assertRuntimeRole(reader); await assertRuntimeRole(worker)
      for (const table of ['conversations','record_versions','record_sources','policy_versions','consent_grants','professional_credentials','safety_cases']) await assert.rejects(worker.query(`SELECT * FROM ${table}`), denied)
      for (const statement of ['SELECT * FROM public.messages','SELECT * FROM share_snapshots','SELECT * FROM consent_grants','SELECT * FROM reso_migration.backfill_items',
        'INSERT INTO conversations(id) VALUES(gen_random_uuid())','UPDATE record_versions SET version=version+1','DELETE FROM conversations','TRUNCATE conversations',
        'UPDATE schema_migrations SET checksum=\'fake\'','CREATE TABLE public.forbidden(id int)','CREATE TEMP TABLE forbidden(id int)',`SET ROLE ${escapeIdentifier('m1_reader_' + suffix + '_scope')}`]) await assert.rejects(reader.query(statement), denied)
      assert.equal((await reader.query('SELECT * FROM conversations')).rowCount, 0)
      assert.equal((await reader.query('SELECT * FROM m1_read.messages')).rowCount, 0)
      assert.equal((await reader.query('SELECT * FROM record_versions')).rowCount, 0)
      const functions = (await pool.query("SELECT prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='m1_read'")).rows
      assert.equal(functions.length, 3); assert(functions.every(f => f.prosecdef && f.proconfig.includes('search_path=pg_catalog')))
      await assert.rejects(createApp({ databaseUrl: workerUrl, secret, startJobs: false }), /migration mismatch/)
      await assert.rejects(migrate(pool), /migrations missing/)
    })
    const privateA = imported(e1,'private'), privateB = randomUUID(), room = imported(e1,'room'), intake = imported(e1,'intake'), professional = randomUUID()
    await pool.query(`INSERT INTO conversations(id,event_id,kind,owner_user_id,title,updated_at) VALUES($1,$2,'private','member','B private','2026-11-09')`, [privateB,e1])
    await pool.query(`INSERT INTO conversations(id,event_id,kind,owner_user_id,application_id) VALUES($1,$2,'professional','owner',$3)`, [professional,e1,fixture.application])
    await pool.query(`INSERT INTO messages(event_id,domain,author_id,author_name,role,content,conversation_id) VALUES($1,'private','member','Member','user','B secret',$2)`, [e1,privateB])
    const visible = (actor: string, conversation: string, table = 'm1_read.messages') => withM1ReadScope(reader, actor, conversation, async c => (await c.query(`SELECT * FROM ${table} ORDER BY id`)).rows)
    await check('P01 current identity and conversation scope filter rows and metadata without event-owner fallback', async () => {
      assert.equal((await visible('owner',privateB)).length, 0); assert.equal((await visible('member',privateA)).length, 0)
      assert.equal((await visible('member',intake,'conversations')).length, 0)
      assert.equal((await visible('owner',privateA)).length, 3); assert.equal((await visible('member',privateB)).length, 1)
      assert.equal((await visible('owner',privateA,'record_versions')).length, 2)
      assert.equal((await visible('member',privateA,'record_versions')).length, 0)
      assert.equal((await visible('owner',privateB,'conversations')).length, 0)
      assert.equal((await visible('member',room,'conversations'))[0].updated_at.toISOString(), '2026-11-02T00:00:00.000Z')
      assert.equal((await visible('counselor',professional,'conversations')).length, 0)
      assert.equal((await visible('owner',professional,'conversations')).length, 0)
      assert.equal((await visible('anonymous',room)).length, 0)
    })
    await check('P03 a reused connection clears scope after commit, rollback, timeout and accidental session SET', async () => {
      const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      await visible('owner',privateA)
      for (const fail of [async(c:PoolClient)=>{ await c.query('SELECT 1/0') },async(c:PoolClient)=>{ await c.query("SET LOCAL statement_timeout='10ms'"); await c.query('SELECT pg_sleep(1)') }]) await assert.rejects(withM1ReadScope(reader,'owner',privateA,fail))
      await withM1ReadScope(reader,'owner',privateA,async c => { await c.query("SELECT set_config('reso.actor_id','owner',false),set_config('reso.conversation_id',$1,false)", [privateA]) })
      assert.equal((await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, pid)
      assert.equal((await reader.query('SELECT * FROM m1_read.messages')).rowCount, 0)
      assert.equal((await visible('member',privateA)).length, 0)
      await assert.rejects(withM1ReadScope(reader, 'owner', 'not-a-uuid', async () => {}))
    })
    await check('P04/P06 current membership, history cutoff, redaction and erasure revoke message and derived-record reads', async () => {
      assert.equal((await visible('member',room)).length, 2)
      await pool.query("UPDATE members SET history_mode='since_join',history_from_message_id=$1 WHERE event_id=$2 AND user_id='member'", [fixture.messages[3], e1])
      assert.equal((await visible('member',room)).length, 1); assert.equal((await visible('member',room,'record_versions')).length, 0)
      await pool.query("UPDATE members SET active=false WHERE event_id=$1 AND user_id='member'", [e1])
      assert.equal((await visible('member',room)).length, 0); assert.equal((await visible('member',room,'conversations')).length, 0)
      await pool.query("UPDATE members SET active=true,membership_generation=2 WHERE event_id=$1 AND user_id='member'", [e1])
      assert.equal((await visible('member',room)).length, 1)
      assert.equal((await pool.query("SELECT permissions FROM share_grants WHERE recipient_id='removed'")).rows[0].permissions.length, 0)
      await pool.query('UPDATE messages SET redacted_at=now() WHERE id=$1', [fixture.messages[0]])
      assert.equal((await visible('owner',privateA,'record_versions')).length, 1)
      assert.equal((await visible('owner',privateA,'record_sources')).length, 1)
      await pool.query("UPDATE profiles SET account_state='disabled' WHERE user_id='owner'")
      assert.equal((await visible('owner',privateA)).length, 0)
      await pool.query("UPDATE profiles SET account_state='active' WHERE user_id='owner'; UPDATE events SET erasure_requested_at=now(),lifecycle_status='erasure_pending' WHERE id='" + e1 + "'")
      assert.equal((await visible('owner',privateA)).length, 0); assert.equal((await visible('member',room)).length, 0)
      await assert.rejects(backfillM1(pool,'m1',1), /erased or erasure-pending/)
    })
    await check('R01/R02 first-stage rollback keeps the upgraded database and new rows while legacy restart stays blocked', async () => {
      assert.equal(await count(pool,'conversations'), 8)
      assert.equal((await pool.query("SELECT count(*) FROM messages WHERE content='B secret'")).rows[0].count, '1')
      await assert.rejects(createApp({ databaseUrl: workerUrl, secret, startJobs: false }), /migration mismatch/)
      const expected = await allRows(pool), restored = await restoreEncrypted('m1-backup')
      assert.deepEqual(await allRows(restored.pool), expected)
      await verifyMigrations(restored.pool, 'm1')
      const restoredReaderUrl = roleUrl(restored.url, 'm1_restored_reader_' + suffix)
      roles.push('m1_restored_reader_' + suffix + '_scope')
      await configureM1ReadAccess(restored.url.toString(), restoredReaderUrl)
      const restoredReader = new Pool({ connectionString: restoredReaderUrl, max: 1 }); pools.push(restoredReader)
      assert.equal(await withM1ReadScope(restoredReader,'owner',privateA,async c => (await c.query('SELECT * FROM m1_read.messages')).rowCount), 0)
      assert.equal((await restored.pool.query("SELECT count(*) FROM messages WHERE content='B secret'")).rows[0].count, '1')
      evidence.upgraded_restore_ms = restored.elapsedMs
      evidence.upgraded_tables_reconciled = Object.keys(expected).length
      evidence.rollback_mode = 'restore-into-separate-database; preserve-upgraded-database; no-native-cutover'
      evidence.native_write_cutover = false
    })
    await writeFile(target.evidenceDirectory + '/results.json', JSON.stringify({ scenarios, ...evidence, database_version: (await pool.query('SHOW server_version')).rows[0].server_version, existing_migrations: 7, opt_in_migrations: 2 }, null, 2) + '\n', { mode: 0o600 })
  } finally {
    await Promise.all(pools.map(p => p.end()))
    for (const db of databases.reverse()) {
      // Pool shutdown can precede PostgreSQL observing socket closure; do not kill closing clients.
      for (let attempt=0;attempt<250;attempt++) {
        if (!(await admin.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1',[db])).rowCount) break
        await new Promise(resolve=>setTimeout(resolve,20))
      }
      assert.equal((await admin.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1',[db])).rowCount,0,'All isolated database clients must close before teardown')
      await admin.query(`DROP DATABASE ${escapeIdentifier(db)}`)
    }
    for (const role of roles) await admin.query(`DROP ROLE IF EXISTS ${escapeIdentifier(role)}`)
    await admin.end()
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { createDatabase } from './db'
import { hasCurrentConsent } from './consent'

test('legacy upgrade preserves data, rolls back failures, serializes concurrent migrations and detects edits', {skip:!process.env.DATABASE_URL}, async () => {
  const url=new URL(process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL!)
  const admin=new Pool({connectionString:url.toString()})
  const name=`reso_test_${randomBytes(8).toString('hex')}`
  await admin.query(`CREATE DATABASE "${name}"`)
  url.pathname=`/${name}`
  const database=createDatabase(url.toString()),{pool}=database
  try {
    const auth=betterAuth({database:pool,secret:randomBytes(32).toString('hex'),baseURL:'http://localhost:5173'})
    await (await getMigrations(auth.options)).runMigrations()
    await pool.query(await readFile(new URL('./migrations/0001_initial.sql',import.meta.url),'utf8'))
    await pool.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('owner','Owner','owner@test.example',false,now(),now()),('member','Member','member@test.example',false,now(),now()),('removed','Removed','removed@test.example',false,now(),now())`)
    await pool.query("INSERT INTO profiles(user_id,consent_at) VALUES('owner','2026-11-01T00:00:00Z')")
    const eventId=randomUUID(),pendingInvite=randomUUID()
    await pool.query("INSERT INTO events(id,owner_id,title,summary,summary_version) VALUES($1,'owner','legacy','private v2',2)",[eventId])
    await pool.query("INSERT INTO members(event_id,user_id,active) VALUES($1,'member',true),($1,'removed',false)",[eventId])
    await pool.query("INSERT INTO snapshots(event_id,user_id,content,version,active) VALUES($1,'member','shared v1',1,true),($1,'removed','shared v1',1,false)",[eventId])
    await pool.query("INSERT INTO invites(id,event_id,token_hash,snapshot,snapshot_version,expires_at) VALUES($1,$2,'legacy-token','shared v1',1,now()+interval '1 day')",[pendingInvite,eventId])
    await pool.query("INSERT INTO messages(event_id,author_name,domain,role,content) VALUES($1,'Owner','private','user','private history')",[eventId])
    await pool.query("INSERT INTO exercises(event_id,act,notes) VALUES($1,2,'{\"1\":\"legacy note\"}')",[eventId])
    await pool.query("INSERT INTO questionnaires(event_id,version,answers) VALUES($1,'legacy','[1,2]')",[eventId])
    await pool.query("INSERT INTO agent_runs(id,event_id,domain,context_version,model,status) VALUES($1,$2,'private',0,'legacy','MODEL_HTTP_500')",[randomUUID(),eventId])

    const consultantId=randomUUID(),scheduledId=randomUUID(),completedId=randomUUID()
    await pool.query("INSERT INTO consultants(id,user_id,name,approach,qualifications,price) VALUES($1,'member','Legacy','test','test','test')",[consultantId])
    await pool.query("INSERT INTO applications(id,client_id,event_id,applicant_id,consultant_id,status,scheduled_at) VALUES($1,$2,$3,'owner',$4,'scheduled','2026-12-01T10:00:00Z'),($5,$6,$3,'owner',$4,'completed','2026-10-01T10:00:00Z')",[scheduledId,randomUUID(),eventId,consultantId,completedId,randomUUID()])

    // Conflicting legacy versions must fail the whole upgrade without dropping old data.
    await pool.query("UPDATE snapshots SET content='conflicting v1' WHERE user_id='member'")
    await assert.rejects(database.migrate(),/unique/i)
    assert.equal((await pool.query("SELECT to_regclass('schema_migrations') AS name")).rows[0].name,null)
    assert.equal((await pool.query('SELECT count(*) FROM snapshots')).rows[0].count,'2')
    await pool.query("UPDATE snapshots SET content='shared v1' WHERE user_id='member'")
    await Promise.all([database.migrate(),database.migrate()])
    assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'9')
    assert.equal((await pool.query('SELECT room_closed_at FROM events WHERE id=$1',[eventId])).rows[0].room_closed_at,null)
    assert.equal((await pool.query('SELECT count(*) FROM contact_categories')).rows[0].count,'0')
    assert.equal((await pool.query("SELECT to_regclass('snapshots') AS name")).rows[0].name,null)
    assert.equal((await pool.query('SELECT count(*) FROM share_snapshots')).rows[0].count,'1')
    const grants=(await pool.query('SELECT recipient_id,revoked_at,source FROM share_grants ORDER BY recipient_id')).rows
    assert.equal(grants[0].recipient_id,'member');assert.equal(grants[0].revoked_at,null)
    assert.equal(grants[1].recipient_id,'removed');assert.ok(grants[1].revoked_at)
    assert.ok(grants.every(g=>g.source==='legacy_import'))
    const invite=(await pool.query('SELECT i.token_hash,i.status,s.content FROM invites i JOIN share_snapshots s ON s.id=i.snapshot_id WHERE i.id=$1',[pendingInvite])).rows[0]
    assert.deepEqual(invite,{token_hash:'legacy-token',status:'pending',content:'shared v1'})
    assert.equal((await pool.query('SELECT content FROM messages')).rows[0].content,'private history')
    assert.equal((await pool.query('SELECT notes FROM exercises')).rows[0].notes['1'],'legacy note')
    assert.deepEqual((await pool.query('SELECT answers FROM questionnaires')).rows[0].answers,[1,2])
    const consent=(await pool.query('SELECT action,policy_version,occurred_at FROM consent_records')).rows[0]
    assert.equal(consent.action,'legacy_import');assert.equal(consent.policy_version,'legacy-unversioned')
    assert.equal(consent.occurred_at.toISOString(),'2026-11-01T00:00:00.000Z')
    assert.equal(await hasCurrentConsent(database,'owner'),false)
    const run=(await pool.query('SELECT status,error_code,prompt_version,finished_at FROM agent_runs')).rows[0]
    assert.deepEqual(run,{status:'error',error_code:'MODEL_HTTP_500',prompt_version:null,finished_at:null})

    const scheduled=(await pool.query('SELECT status,scheduled_at,proposed_at,schedule_version FROM applications WHERE id=$1',[scheduledId])).rows[0]
    assert.equal(scheduled.status,'proposed');assert.equal(scheduled.scheduled_at,null);assert.equal(scheduled.schedule_version,1)
    assert.equal(scheduled.proposed_at.toISOString(),'2026-12-01T10:00:00.000Z')
    const completed=(await pool.query('SELECT status,scheduled_at,proposed_at FROM applications WHERE id=$1',[completedId])).rows[0]
    assert.equal(completed.status,'completed');assert.equal(completed.proposed_at,null)
    assert.equal(completed.scheduled_at.toISOString(),'2026-10-01T10:00:00.000Z')

    const otherEvent=randomUUID()
    await pool.query("INSERT INTO events(id,owner_id,title) VALUES($1,'owner','other event')",[otherEvent])
    const snapshotId=(await pool.query('SELECT id FROM share_snapshots')).rows[0].id
    await assert.rejects(pool.query("INSERT INTO share_grants(event_id,snapshot_id,granted_by,recipient_id) VALUES($1,$2,'owner','member')",[otherEvent,snapshotId]),/foreign key/i)
    const applied=(await pool.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows
    await pool.query("UPDATE schema_migrations SET checksum='tampered' WHERE name=$1",[applied[0].name])
    await assert.rejects(database.migrate(),/Applied migration changed/)
    assert.equal((await pool.query('SELECT count(*) FROM messages')).rows[0].count,'1')
    await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2',[applied[0].checksum,applied[0].name])
    await pool.query("INSERT INTO schema_migrations(name,checksum) VALUES('9999_future.sql','unknown')")
    await assert.rejects(database.migrate(),/migrations missing/)
    await pool.query("DELETE FROM schema_migrations WHERE name='9999_future.sql'")
    await database.migrate()
    assert.equal((await pool.query('SELECT count(*) FROM share_grants')).rows[0].count,'2')
  } finally {
    await pool.end()
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

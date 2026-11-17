import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import model from '../docs/database-model-v2.json'
import { nativeJsonSha256 } from './policy-integrity'
import { verifyMigrations } from './migrations'

const namespace = Buffer.from('bba97de12c6e5d70a160f9a6bbf7d5c2', 'hex')
export function m1ImportId(parts: string[]) {
  const bytes = createHash('sha1').update(namespace).update(JSON.stringify(parts)).digest().subarray(0, 16)
  bytes[6] = bytes[6] & 15 | 80; bytes[8] = bytes[8] & 63 | 128
  const h = bytes.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}
const rawHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const baseline = model.baseline_columns as Record<string, string[]>
type Row = Record<string, any>
const sourceHash = (table: string, row: Row) => nativeJsonSha256(JSON.parse(JSON.stringify(Object.fromEntries(baseline[table].map(k => [k, row[k]])))))

export async function backfillM1(pool: Pool, stage: 'm1a' | 'm1', pageSize = 100) {
  assert(['m1a', 'm1'].includes(stage) && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 500, 'Invalid backfill stage/page size')
  await verifyMigrations(pool, stage)
  const result = { events: 0, conversations_created: 0, versions_created: 0, sources_created: 0, mapped_items: 0, legacy_snapshots_without_proven_version: 0, confirmations_without_proven_version: 0 }
  let cursor = ''
  for (;;) {
    const client = await pool.connect(); let broken = false
    const lost = () => { broken = true }
    client.on('error', lost)
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reso.schema_migrations',0))")
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reso.m1.backfill',0))")
      await verifyMigrations(client, stage)
      await client.query(`CREATE SCHEMA IF NOT EXISTS reso_migration;
        REVOKE ALL ON SCHEMA reso_migration FROM PUBLIC;
        CREATE TABLE IF NOT EXISTS reso_migration.backfill_items (
          source_key text PRIMARY KEY, source_sha256 char(64) NOT NULL, target_id uuid NOT NULL,
          converter_version integer NOT NULL CHECK(converter_version = 1), completed_at timestamptz NOT NULL DEFAULT now());
        REVOKE ALL ON reso_migration.backfill_items FROM PUBLIC`)
      const events = (await client.query('SELECT * FROM events WHERE id::text > $1 ORDER BY id LIMIT $2 FOR UPDATE', [cursor, pageSize])).rows
      for (const event of events) {
        assert(!event.erasure_requested_at && !['erasure_pending', 'erased'].includes(event.lifecycle_status), 'Do not backfill erased or erasure-pending events')
        await remember(client, ['event', event.id], sourceHash('events', event), event.id, async () => {}, result)
        const conversations = new Map<string, string>()
        for (const kind of ['private', 'room', 'intake']) {
          const owner = kind === 'room' ? null : event.owner_id
          const key = ['conversation', event.id, kind, owner || ''], id = m1ImportId(key)
          const title = kind === 'private' ? event.title : kind === 'room' ? event.room_title || null : null
          const hash = nativeJsonSha256({ event_id: event.id, kind, owner_user_id: owner, title })
          await remember(client, key, hash, id, async existing => {
            const old = (await client.query('SELECT * FROM conversations WHERE id=$1', [id])).rows[0]
            assert(!existing || old, 'Mapped conversation was removed; do not resurrect it')
            if (!old) {
              await client.query('INSERT INTO conversations(id,event_id,kind,owner_user_id,title,updated_at) VALUES($1,$2,$3,$4,$5,$6)', [id, event.id, kind, owner, title, kind === 'room' ? event.room_updated_at : event.updated_at])
              result.conversations_created++
            } else assert(old.event_id === event.id && old.kind === kind && old.owner_user_id === owner && old.title === title && old.status !== 'erasure_pending', 'Conflicting conversation mapping')
          }, result)
          conversations.set(kind, id)
        }
        const messages = (await client.query('SELECT * FROM messages WHERE event_id=$1 ORDER BY id FOR UPDATE', [event.id])).rows
        const messageById = new Map(messages.map(m => [String(m.id), m]))
        for (const message of messages) {
          const id = conversations.get(message.domain); assert(id, 'Unknown legacy message domain')
          await remember(client, ['message', String(message.id)], sourceHash('messages', message), id, async existing => {
            assert(!existing || message.conversation_id === id, 'Mapped message scope changed; do not restore erased references')
            assert(message.conversation_id === null || message.conversation_id === id, 'Message belongs to another conversation')
            if (message.conversation_id === null) await client.query('UPDATE messages SET conversation_id=$1 WHERE id=$2', [id, message.id])
          }, result)
          if (stage === 'm1') {
            const kind = message.card_type === 'safety' ? 'card' : 'text'
            await remember(client, ['message_metadata', String(message.id)], sourceHash('messages', message), id, async existing => {
              assert(!existing || message.content_kind === kind && message.message_purpose === 'chat', 'Imported message metadata changed')
              assert(message.message_purpose === 'chat' && (message.content_kind === kind || message.content_kind === 'text'), 'Do not replace native message metadata')
              if (message.content_kind !== kind) await client.query('UPDATE messages SET content_kind=$1 WHERE id=$2', [kind, message.id])
            }, result)
          }
        }
        const runs = (await client.query('SELECT * FROM agent_runs WHERE event_id=$1 ORDER BY id FOR UPDATE', [event.id])).rows
        for (const run of runs) {
          const id = conversations.get(run.domain); assert(id, 'Unknown legacy run domain')
          for (const ref of [run.trigger_message_id, run.response_message_id]) {
            if (ref !== null) assert(messageById.get(String(ref))?.domain === run.domain, 'Run references a different event/domain message')
          }
          await remember(client, ['run', run.id], sourceHash('agent_runs', run), id, async existing => {
            assert(!existing || run.conversation_id === id, 'Mapped run scope changed')
            assert(run.conversation_id === null || run.conversation_id === id, 'Run belongs to another conversation')
            if (run.conversation_id === null) await client.query('UPDATE agent_runs SET conversation_id=$1 WHERE id=$2', [id, run.id])
          }, result)
        }
        if (stage === 'm1') await backfillRecords(client, event, conversations, messageById, result)
        result.events++; cursor = event.id
      }
      await client.query('COMMIT')
      if (events.length < pageSize) return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { broken = true }
      throw error
    } finally { client.release(broken); client.off('error', lost) }
  }
}

type Result = Awaited<ReturnType<typeof backfillM1>>
async function remember(client: PoolClient, parts: string[], hash: string, target: string, apply: (existing: boolean) => Promise<void>, result: { mapped_items: number }) {
  const key = JSON.stringify(parts)
  const old = (await client.query('SELECT * FROM reso_migration.backfill_items WHERE source_key=$1 FOR UPDATE', [key])).rows[0]
  assert(!old || old.source_sha256 === hash && old.target_id === target && old.converter_version === 1, 'Legacy source or mapping changed; manual reconciliation is required')
  await apply(!!old)
  if (!old) {
    await client.query('INSERT INTO reso_migration.backfill_items(source_key,source_sha256,target_id,converter_version) VALUES($1,$2,$3,1)', [key, hash, target])
    result.mapped_items++
  }
}

async function backfillRecords(client: PoolClient, event: Row, conversations: Map<string, string>, messages: Map<string, Row>, result: Result) {
  const records = (await client.query('SELECT * FROM understandings WHERE event_id=$1 ORDER BY id FOR UPDATE', [event.id])).rows
  for (const record of records) {
    const conversation = conversations.get(record.domain), message = messages.get(String(record.source_message_id))
    assert(conversation && message && message.domain === record.domain, 'Legacy record has no same-conversation source')
    assert(typeof record.content === 'string' && [...record.content].length >= 1 && [...record.content].length <= 5000 && record.version > 0, 'Legacy record cannot be represented without changing its content/version')
    const kind = record.provenance === 'model_inference' ? 'hypothesis' : 'summary'
    const content = { type: 'understanding', kind, text: record.content }, hash = nativeJsonSha256(content)
    const id = m1ImportId(['record', record.id, String(record.version)])
    await remember(client, ['record', record.id, String(record.version)], sourceHash('understandings', record), id, async existing => {
      assert(record.record_state === 'active' && (record.kind === null || record.kind === kind), 'Do not overwrite a withdrawn or reclassified record')
      assert(record.conversation_id === null || record.conversation_id === conversation, 'Conflicting record conversation')
      assert(record.current_record_version_id === null || record.current_record_version_id === id, 'Record already points to a different version')
      const old = (await client.query('SELECT * FROM record_versions WHERE id=$1', [id])).rows[0]
      assert(!existing || old && record.current_record_version_id === id, 'Mapped record was removed; do not resurrect it')
      await client.query('UPDATE understandings SET conversation_id=$1,kind=$2 WHERE id=$3', [conversation, kind, record.id])
      if (!old) {
        await client.query(`INSERT INTO record_versions(id,conversation_id,understanding_id,version,content,provenance,created_by,confirmation_scope,content_sha256,record_origin)
          VALUES($1,$2,$3,$4,$5,$6,$7,'{"type":"legacy_unknown"}',$8,'legacy_import')`, [id, conversation, record.id, record.version, content, record.provenance, record.author_id, hash])
        result.versions_created++
      } else assert(old.understanding_id === record.id && old.conversation_id === conversation && old.version === record.version && old.created_by === record.author_id && old.provenance === record.provenance && old.record_origin === 'legacy_import' && old.confirmation_scope?.type === 'legacy_unknown' && Object.keys(old.confirmation_scope).length === 1 && old.content_sha256 === hash && nativeJsonSha256(old.content) === hash, 'Conflicting imported version')
      const source = m1ImportId(['source', record.id, String(record.version)])
      const role = record.provenance === 'user_quoted' && message.role === 'user' ? 'quote' : 'hypothesis'
      const oldSource = (await client.query('SELECT * FROM record_sources WHERE id=$1', [source])).rows[0]
      assert(!existing || oldSource, 'Mapped source was removed')
      if (!oldSource) {
        await client.query(`INSERT INTO record_sources(id,target_conversation_id,target_record_version_id,source_message_id,source_role,source_sha256,source_conversation_id)
          VALUES($1,$2,$3,$4,$5,$6,$2)`, [source, conversation, id, record.source_message_id, role, rawHash(message.content)])
        result.sources_created++
      } else assert(oldSource.target_record_version_id === id && oldSource.target_conversation_id === conversation && String(oldSource.source_message_id) === String(message.id) && oldSource.source_role === role && oldSource.source_sha256 === rawHash(message.content) && oldSource.source_conversation_id === conversation && oldSource.source_access_basis === 'same_conversation', 'Conflicting imported source')
      await client.query('UPDATE understandings SET current_record_version_id=$1 WHERE id=$2', [id, record.id])
    }, result)
    const confirmations = (await client.query('SELECT * FROM understanding_confirmations WHERE understanding_id=$1 ORDER BY user_id,version FOR UPDATE', [record.id])).rows
    for (const confirmation of confirmations) {
      if (confirmation.version !== record.version) { result.confirmations_without_proven_version++; continue }
      await remember(client, ['confirmation', record.id, confirmation.user_id, String(confirmation.version)], sourceHash('understanding_confirmations', confirmation), id, async existing => {
        assert(confirmation.record_version_id === null || confirmation.record_version_id === id, 'Conflicting historical confirmation')
        assert(!existing || confirmation.record_version_id === id, 'Mapped confirmation was cleared')
        if (confirmation.record_version_id === null) await client.query('UPDATE understanding_confirmations SET record_version_id=$1 WHERE understanding_id=$2 AND user_id=$3 AND version=$4', [id, record.id, confirmation.user_id, confirmation.version])
      }, result)
    }
  }
  const room = conversations.get('room')!
  const members = (await client.query('SELECT * FROM members WHERE event_id=$1 FOR UPDATE', [event.id])).rows
  for (const member of members) await remember(client, ['member', event.id, member.user_id], sourceHash('members', member), room, async existing => {
    assert(!existing || member.history_mode === 'legacy_full_history', 'Imported membership scope changed')
    assert(member.history_mode === null || member.history_mode === 'legacy_full_history', 'Do not replace a native member history policy')
    if (member.history_mode === null) await client.query("UPDATE members SET history_mode='legacy_full_history' WHERE event_id=$1 AND user_id=$2", [event.id, member.user_id])
  }, result)
  const snapshots = (await client.query('SELECT * FROM share_snapshots WHERE event_id=$1 FOR UPDATE', [event.id])).rows
  for (const snapshot of snapshots) {
    // A summary_version is not an understanding version. Keep unprovable ancestry legacy-only.
    await remember(client, ['snapshot', snapshot.id], sourceHash('share_snapshots', snapshot), snapshot.id, async () => {
      assert(snapshot.source_record_version_id === null && snapshot.source_conversation_id === null && snapshot.payload === null && snapshot.content_sha256 === null, 'Existing native snapshot needs explicit reconciliation')
    }, result)
    result.legacy_snapshots_without_proven_version++
  }
  const grants = (await client.query('SELECT * FROM share_grants WHERE event_id=$1 FOR UPDATE', [event.id])).rows
  for (const grant of grants) await remember(client, ['grant', grant.id], sourceHash('share_grants', grant), grant.id, async existing => {
    assert(!existing || grant.target_conversation_id === room && grant.permissions?.length === 0, 'Imported sharing scope changed')
    assert(grant.target_conversation_id === null || grant.target_conversation_id === room, 'Conflicting grant target')
    assert((grant.target_event_id === null || grant.target_event_id === event.id) && (grant.purpose_code === null || grant.purpose_code === 'room_discussion'), 'Do not replace native sharing purpose or target')
    assert(grant.permissions === null || grant.permissions.length === 0, 'Do not replace or create native sharing permissions')
    if (grant.target_conversation_id === null) await client.query("UPDATE share_grants SET target_event_id=$1,target_conversation_id=$2,purpose_code='room_discussion',permissions=ARRAY[]::text[] WHERE id=$3", [event.id, room, grant.id])
  }, result)
}

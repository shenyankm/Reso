import { sql } from './db'
import type { Database } from './db'
import type { EventRecord } from '../shared/types'
import { HttpError } from './http'

type Executor = NonNullable<Parameters<Database['query']>[1]>

export async function shareSnapshot(database: Database, event: EventRecord, executor: Executor) {
  await database.query(sql`INSERT INTO share_snapshots(event_id,created_by,content,source_version) VALUES(${event.id},${event.owner_id},${event.summary},${event.summary_version}) ON CONFLICT(event_id,source_version) DO NOTHING`, executor)
  const [snapshot] = await database.query<{ id: string; content: string }>(sql`SELECT id,content FROM share_snapshots WHERE event_id=${event.id} AND source_version=${event.summary_version}`, executor)
  if (!snapshot || snapshot.content !== event.summary) throw new HttpError(409, '摘要版本与已保存快照不一致，请重新修改摘要')
  return snapshot.id
}

// Caller holds the event row lock, so membership, grants and context versions change together.
export async function replaceShareGrant(database: Database, eventId: string, recipientId: string, snapshotId: string | null, actorId: string, executor: Executor) {
  const [current] = await database.query<{ snapshot_id: string }>(sql`SELECT snapshot_id FROM share_grants WHERE event_id=${eventId} AND recipient_id=${recipientId} AND revoked_at IS NULL`, executor)
  if (current?.snapshot_id === snapshotId) return false
  if (current) await database.query(sql`UPDATE share_grants SET revoked_at=now(),revoked_by=${actorId} WHERE event_id=${eventId} AND recipient_id=${recipientId} AND revoked_at IS NULL`, executor)
  if (snapshotId) await database.query(sql`INSERT INTO share_grants(event_id,snapshot_id,granted_by,recipient_id) VALUES(${eventId},${snapshotId},${actorId},${recipientId})`, executor)
  return !!current || !!snapshotId
}

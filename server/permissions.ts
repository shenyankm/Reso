import { sql } from './db'
import type { Database } from './db'
import type { Domain, EventRecord } from '../shared/types'
import { HttpError } from './http'

export function createPermissions(database: Database) {
  const { query, db } = database
  type Executor = NonNullable<Parameters<typeof query>[1]>
  async function hasEventAccess(eventId: string, userId: string, domain: Domain, executor: Executor = db) {
    return (await query(sql`SELECT 1 FROM events e WHERE e.id=${eventId} AND (e.owner_id=${userId} OR (${domain}='room' AND EXISTS(SELECT 1 FROM members m WHERE m.event_id=e.id AND m.user_id=${userId} AND m.active)))`, executor)).length > 0
  }
  async function requireEvent(eventId: string, userId: string, domain: Domain, executor: Executor) {
    const [event] = await query<EventRecord>(sql`SELECT * FROM events WHERE id=${eventId}`, executor)
    if (!event) throw new HttpError(404, '这件事不存在或已被删除')
    if (event.owner_id !== userId && !await hasEventAccess(eventId, userId, domain, executor)) throw new HttpError(403, domain === 'private' ? '私人内容仅本人可见' : '你尚未加入，或访问授权已撤回')
    return event
  }
  const requireEventOwner = (eventId: string, userId: string, executor: Executor = db) => requireEvent(eventId, userId, 'private', executor)
  const requireRoomParticipant = (eventId: string, userId: string, executor: Executor = db) => requireEvent(eventId, userId, 'room', executor)
  async function requireActiveCounselor(userId: string, executor: Executor = db) {
    // A transaction keeps this lock until the state change commits, serializing disable/revoke.
    const [consultant] = await query<{ id: string }>(sql`SELECT id FROM consultants WHERE user_id=${userId} AND active FOR SHARE`, executor)
    if (!consultant) throw new HttpError(403, '此账号未配置有效的专业端权限')
    return consultant
  }
  async function hasSession(sessionId: string, userId: string) {
    return (await query(sql`SELECT 1 FROM "session" WHERE id=${sessionId} AND "userId"=${userId} AND "expiresAt">now()`)).length > 0
  }
  return { hasEventAccess, requireEventOwner, requireRoomParticipant, requireActiveCounselor, hasSession }
}

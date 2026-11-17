import { sql } from './db'
import type { Database } from './db'
import type { Domain } from '../shared/types'
import { json } from './http'
import { createPermissions } from './permissions'
import type { Notify } from './notifications'

export function createRouteContext(database: Database, notify: Notify, enqueue: (eventId: string, domain: Domain, actorId: string, executor?: Parameters<Database['query']>[1],methodOffers?:boolean) => Promise<void>) {
  const { query, db } = database
  async function revision(eventId: string, actorId: string, kind: string, value: unknown, executor = db as Parameters<typeof query>[1]) {
    await query(sql`INSERT INTO revisions(event_id,actor_id,kind,value) VALUES(${eventId},${actorId},${kind},${json(value)}::jsonb)`, executor)
  }
  return { database, notify, enqueue, ...createPermissions(database), revision }
}
export type RouteContext = ReturnType<typeof createRouteContext>

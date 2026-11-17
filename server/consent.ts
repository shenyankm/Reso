import { sql } from './db'
import type { Database } from './db'
import { localTestPolicy } from '../shared/consent'

export async function hasCurrentConsent(database: Database, userId: string) {
  return (await database.query(sql`SELECT 1 FROM consent_records WHERE user_id=${userId} AND consent_type=${localTestPolicy.type} AND policy_version=${localTestPolicy.version} AND action='accepted'`)).length > 0
}

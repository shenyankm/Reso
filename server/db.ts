import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { migrate as runMigrations } from './migrations'

export function createDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 15000, idle_in_transaction_session_timeout: 15000, application_name: 'reso' })
  pool.on('error', () => console.error('Idle database connection lost; the pool will reconnect.'))
  const db = drizzle(pool)
  type Executor = { execute(statement: SQL): PromiseLike<{ rows: unknown[] }> }
  async function query<T>(statement: SQL, executor: Executor = db): Promise<T[]> {
    return (await executor.execute(statement)).rows as T[]
  }
  async function migrate() { await runMigrations(pool) }
  return { pool, db, query, migrate }
}
export type Database = ReturnType<typeof createDatabase>
export { sql }

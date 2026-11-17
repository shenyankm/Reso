import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { Pool } from 'pg'

export type MigrationTarget = 'legacy' | 'm1a' | 'm1'

export async function migrationFiles(target: MigrationTarget = 'legacy') {
  if (!['legacy', 'm1a', 'm1'].includes(target)) throw new Error('Unknown database migration target')
  const directory = new URL('./migrations/', import.meta.url)
  const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()
  if (target !== 'legacy') files.push('m1/0008_m1a_expand.sql')
  if (target === 'm1') files.push('m1/0009_m1_foundation_expand.sql')
  return Promise.all(files.map(async name => {
    const source = await readFile(new URL(name, directory), 'utf8')
    return { name, source, checksum: createHash('sha256').update(source).digest('hex') }
  }))
}

export async function verifyMigrations(pool: Pick<Pool, 'query'>, target: MigrationTarget = 'legacy') {
  const files = await migrationFiles(target)
  const applied = await pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM schema_migrations')
  if (applied.rows.length !== files.length) throw new Error('Database migration mismatch; run npm run db:migrate')
  for (const { name, checksum } of files) {
    if (!applied.rows.some(row=>row.name===name&&row.checksum===checksum)) throw new Error(`Database migration mismatch: ${name}`)
  }
}

export async function migrate(pool: Pool, target: MigrationTarget = 'legacy') {
  const files = await migrationFiles(target)
  const client = await pool.connect()
  let broken = false
  const lost = () => { broken = true }
  client.on('error', lost)
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reso.schema_migrations',0))")
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = await client.query<{ name: string; checksum: string }>('SELECT name,checksum FROM schema_migrations')
    if (applied.rows.some(row => !files.some(file => file.name === row.name))) throw new Error('Database has migrations missing from this code version')
    for (const { name, source, checksum } of files) {
      const previous = applied.rows.find(row => row.name === name)
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`)
        continue
      }
      await client.query(source)
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum])
    }
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { broken = true }
    throw error
  } finally {
    client.release(broken)
    client.off('error', lost)
  }
}

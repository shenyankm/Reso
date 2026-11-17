import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { Pool } from 'pg'

export async function verifyMigrations(pool: Pool) {
  const directory = new URL('./migrations/', import.meta.url)
  const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()
  const applied = await pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM schema_migrations')
  if (applied.rows.length !== files.length) throw new Error('Database migration mismatch; run npm run db:migrate')
  for (const name of files) {
    const checksum=createHash('sha256').update(await readFile(new URL(name,directory))).digest('hex')
    if (!applied.rows.some(row=>row.name===name&&row.checksum===checksum)) throw new Error(`Database migration mismatch: ${name}`)
  }
}

export async function migrate(pool: Pool) {
  const directory = new URL('./migrations/', import.meta.url)
  const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reso.schema_migrations',0))")
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = await client.query<{ name: string; checksum: string }>('SELECT name,checksum FROM schema_migrations')
    if (applied.rows.some(row => !files.includes(row.name))) throw new Error('Database has migrations missing from this code version')
    for (const name of files) {
      const source = await readFile(new URL(name, directory), 'utf8')
      const checksum = createHash('sha256').update(source).digest('hex')
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
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

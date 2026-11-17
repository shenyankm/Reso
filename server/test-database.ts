import { randomBytes } from 'node:crypto'
import {readFile} from 'node:fs/promises'
import { Pool } from 'pg'
import { createDatabase } from './db'
import { initializeDatabase } from './setup-database'
import { configureRuntimeAccess } from './database-access'

export async function createTestDatabase() {
  const source=new URL(process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL!)
  const admin=new Pool({connectionString:source.toString()})
  const suffix=randomBytes(8).toString('hex'),name=`reso_test_${suffix}`,role=`reso_test_app_${suffix}`
  await admin.query(`CREATE DATABASE "${name}"`)
  source.pathname=`/${name}`
  const migrationUrl=source.toString(),runtime=new URL(migrationUrl)
  runtime.username=role;runtime.password=randomBytes(24).toString('hex')
  const secret=randomBytes(32).toString('hex')
  const fixtures=createDatabase(migrationUrl)
  async function cleanup() {
    await fixtures.pool.end()
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.query(`DROP ROLE IF EXISTS "${role}"`)
    await admin.end()
  }
  try {
    if(process.env.RESO_TEST_SCHEMA_SNAPSHOT){
      const snapshot=(await readFile(process.env.RESO_TEST_SCHEMA_SNAPSHOT,'utf8')).replace(/^\\(?:un)?restrict [^\r\n]+\r?$/gm,'')
      // Clone only an existing schema into this newly-created test database; do not run migrations.
      await fixtures.pool.query('BEGIN; DROP SCHEMA public CASCADE;\n'+snapshot+'\nCOMMIT; RESET ALL;')
    }else await initializeDatabase(migrationUrl,secret)
    await configureRuntimeAccess(migrationUrl,runtime.toString())
    return { runtimeUrl:runtime.toString(),migrationUrl,secret,fixtures,cleanup }
  } catch(error) { await cleanup();throw error }
}

import { randomBytes } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { initializeDatabase } from '../server/setup-database'
import { configureRuntimeAccess } from '../server/database-access'

const original=await readFile('.env','utf8')
const configuration=parseEnv(original)
const migrationUrl=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL
let runtimeUrl=process.env.DATABASE_URL
if(!migrationUrl||!runtimeUrl||!process.env.BETTER_AUTH_SECRET)throw new Error('Database URLs and BETTER_AUTH_SECRET are required')
if(new URL(migrationUrl).username===new URL(runtimeUrl).username){
  const runtime=new URL(migrationUrl)
  runtime.username='reso_runtime';runtime.password=randomBytes(24).toString('hex')
  runtimeUrl=runtime.toString()
}
if(configuration.DATABASE_URL!==process.env.DATABASE_URL)throw new Error('Refusing to rewrite .env while DATABASE_URL is overridden')
await initializeDatabase(migrationUrl,process.env.BETTER_AUTH_SECRET)
await configureRuntimeAccess(migrationUrl,runtimeUrl)
let updated=original
for(const [key,value] of Object.entries({DATABASE_URL:runtimeUrl,MIGRATION_DATABASE_URL:migrationUrl})){
  const line=new RegExp(`^${key}=.*$`,'m')
  updated=line.test(updated)?updated.replace(line,()=>`${key}=${value}`):`${updated.trimEnd()}\n${key}=${value}\n`
}
// Replace only after migration and runtime login succeed; retain all provider credentials.
if(updated!==original){await writeFile('.env.migration.tmp',updated,{mode:0o600});await rename('.env.migration.tmp','.env')}
console.log('Database migrations applied; runtime and migration credentials are separated.')

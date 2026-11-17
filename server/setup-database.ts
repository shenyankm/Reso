import { getMigrations } from 'better-auth/db/migration'
import { PgBoss } from 'pg-boss'
import { createAuth } from './auth'
import { createDatabase } from './db'

export async function initializeDatabase(url: string, secret: string) {
  const database=createDatabase(url)
  const queue=new PgBoss({connectionString:url,supervise:false,schedule:false,persistQueueStats:false,reindex:false})
  queue.on('error',()=>console.error('Queue setup failed; inspect migration database connectivity.'))
  try {
    await (await getMigrations(createAuth(database.pool,secret).options)).runMigrations()
    await database.migrate()
    await queue.start()
    await queue.createQueue('agent.reply',{retryLimit:2,retryDelay:2,retryBackoff:true})
  } finally {
    await queue.stop()
    await database.pool.end()
  }
}

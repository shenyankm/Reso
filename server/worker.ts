import { randomUUID } from 'node:crypto'
import { PgBoss } from 'pg-boss'
import { createDatabase, sql } from './db'
import { createAgent, promptVersion } from './agent'
import { loadAgentContext } from './agent-context'
import type { ReplyJob } from './agent-context'
export type { ReplyJob } from './agent-context'
import type { Model } from './agent'
import type { EventRecord } from '../shared/types'
import { createPermissions } from './permissions'
import { publishUpdate } from './notifications'
import type { Notify } from './notifications'
import { assertRuntimeRole } from './database-access'
import { verifyMigrations } from './migrations'
import {createAgentTools} from './agent-tools'
import type {AgentCheckpoint} from './agent'
import type {ReplyPhase} from '../shared/reply'

export async function startQueue(databaseUrl: string) {
  const queue = new PgBoss({ connectionString: databaseUrl, migrate: false, schedule: false, persistQueueStats: false, reindex: false })
  queue.on('error', () => console.error('Background queue error; inspect local PostgreSQL connectivity.'))
  try{
    await queue.start()
    if(!await queue.getQueue('agent.reply'))throw new Error('Run npm run db:migrate before starting the queue')
    return queue
  }catch(error){await queue.stop();throw error}
}

export async function processReply(database: ReturnType<typeof createDatabase>, job: ReplyJob, notify: Notify, model?: Model, signal?:AbortSignal) {
  const { pool, query, db } = database
  const lock = await pool.connect()
  const lost=new AbortController()
  const connectionLost=()=>lost.abort()
  lock.on('error',connectionLost)
  const cancelled=AbortSignal.any([lost.signal,AbortSignal.timeout(150000),...(signal?[signal]:[])])
  let locked=false
  try {
    await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`${job.eventId}:${job.domain}`])
    locked=true
    // Holding the conversation lock proves no previous handler can still own these runs.
    await query(sql`UPDATE agent_runs SET status='error',error_code='WORKER_INTERRUPTED',finished_at=now() WHERE event_id=${job.eventId} AND domain=${job.domain} AND status='running'`)
    const loaded = await loadAgentContext(database, job)
    if (!loaded) return
    const { lastUser, version, context, history,sessionState } = loaded
    const [previous]=await query<{checkpoint:AgentCheckpoint}>(sql`SELECT checkpoint FROM agent_runs WHERE event_id=${job.eventId} AND domain=${job.domain} AND trigger_message_id=${lastUser.id} AND context_version=${version} AND prompt_version=${promptVersion} AND model=${process.env.DEEPSEEK_MODEL || 'deepseek-flash'} AND checkpoint IS NOT NULL AND coalesce((checkpoint->>'method_offers')::boolean,false)=${!!job.methodOffers} ORDER BY created_at DESC LIMIT 1`)
    const runId = randomUUID()
    let lastDisplayPhase:ReplyPhase|undefined
    await query(sql`INSERT INTO agent_runs(id,event_id,domain,context_version,model,prompt_version,trigger_message_id,status) VALUES(${runId},${job.eventId},${job.domain},${version},${process.env.DEEPSEEK_MODEL || 'deepseek-flash'},${promptVersion},${lastUser.id},'running')`)
    async function requireCurrent(tx:Parameters<typeof query>[1]){
      if(cancelled.aborted)throw new Error(lost.signal.aborted?'WORKER_CONNECTION_LOST':signal?.aborted?'WORKER_INTERRUPTED':'AGENT_TIMEOUT')
      const [fresh]=await query<EventRecord>(sql`SELECT * FROM events WHERE id=${job.eventId} FOR UPDATE`,tx)
      if(!fresh||(job.domain==='private'?fresh.private_version:fresh.room_version)!==version||!await createPermissions(database).hasEventAccess(job.eventId,job.actorId,job.domain,tx))throw new Error('CONTEXT_CHANGED')
    }
    try {
      const result = await createAgent(model,cancelled,{tools:createAgentTools(database,job,version),resume:previous?.checkpoint,checkpoint:async state=>{
        if(cancelled.aborted)throw Error('WORKER_INTERRUPTED')
        await query(sql`UPDATE agent_runs SET checkpoint=${JSON.stringify(state)}::jsonb WHERE id=${runId}`)
        if(lastDisplayPhase!==state.display_phase){lastDisplayPhase=state.display_phase;await notify(job.eventId,job.domain)}
      }}).invoke({ input: { domain: job.domain, context,scopeKey:`${job.domain}:${job.eventId}`,contextVersion:version,sessionState,supportsMethodOffers:!!job.methodOffers, lastMessage: lastUser.content, messageIds: history.map(m => String(m.id)),userMessageIds:history.filter(m=>m.role==='user').map(m=>String(m.id)) } })
      await db.transaction(async tx => {
        await requireCurrent(tx)
        const cardType=result.dangerous&&job.domain==='private'?'safety':null
        const responses = result.reply ? await query<{id:string}>(sql`INSERT INTO messages(event_id,author_name,domain,role,content,in_reply_to,card_type) VALUES(${job.eventId},'Reso',${job.domain},'assistant',${result.reply},${lastUser.id},${cardType}) ON CONFLICT(event_id,domain,in_reply_to) DO UPDATE SET author_name=excluded.author_name,content=excluded.content,status='complete',card_type=excluded.card_type RETURNING id`, tx) : []
        if(!cardType&&job.domain==='private'&&responses[0])for(const [slot,proposal]of result.assessment.proposals.entries())await query(sql`INSERT INTO agent_actions(event_id,run_id,message_id,slot,base_version,proposal) VALUES(${job.eventId},${runId},${responses[0].id},${slot},${version},${JSON.stringify(proposal)}::jsonb) ON CONFLICT(message_id,slot) DO NOTHING`,tx)
        if(cardType)await query(sql`INSERT INTO exercises(event_id,paused) VALUES(${job.eventId},true) ON CONFLICT(event_id) DO UPDATE SET paused=true,version=exercises.version+1,updated_at=now()`,tx)
        if(cancelled.aborted)throw new Error('WORKER_INTERRUPTED')
        await query(sql`UPDATE agent_runs SET status='complete',assessment=${JSON.stringify(result.assessment)}::jsonb,checkpoint=${JSON.stringify(result.progress)}::jsonb,response_message_id=${responses[0]?.id || null},finished_at=now() WHERE id=${runId}`, tx)
      })
    } catch (error) {
      const code=cancelled.aborted?(lost.signal.aborted?'WORKER_CONNECTION_LOST':signal?.aborted?'WORKER_INTERRUPTED':'AGENT_TIMEOUT'):error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'MODEL_REQUEST_FAILED'
      await query(sql`UPDATE agent_runs SET status='error',error_code=${code},finished_at=now() WHERE id=${runId}`)
      if(['CONTEXT_CHANGED','WORKER_CONNECTION_LOST','WORKER_INTERRUPTED'].includes(code))throw new Error(code)
      const message = code === 'MODEL_NOT_CONFIGURED' ? 'DeepSeek 尚未配置。你的消息已保存，配置服务端密钥并重启后可以重试。' : '这次回复没有完成。你的消息已保存，可以稍后重试。'
      try{
        await db.transaction(async tx=>{
          await requireCurrent(tx)
          const [response]=await query<{id:string}>(sql`INSERT INTO messages(event_id,author_name,domain,role,content,status,in_reply_to) VALUES(${job.eventId},'系统',${job.domain},'assistant',${message},'error',${lastUser.id}) ON CONFLICT(event_id,domain,in_reply_to) DO UPDATE SET author_name=excluded.author_name,content=excluded.content,status='error' RETURNING id`,tx)
          await query(sql`UPDATE agent_runs SET response_message_id=${response.id} WHERE id=${runId}`,tx)
        })
      }catch(publishError){
        if(publishError instanceof Error&&publishError.message==='CONTEXT_CHANGED')await query(sql`UPDATE agent_runs SET error_code='CONTEXT_CHANGED' WHERE id=${runId}`)
        throw publishError
      }
      if (code !== 'MODEL_NOT_CONFIGURED') { await notify(job.eventId,job.domain); throw new Error(code) }
    }
    await notify(job.eventId,job.domain)
  } finally {
    if(locked&&!lost.signal.aborted)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`${job.eventId}:${job.domain}`]).catch(()=>{lost.abort()})
    lock.off('error',connectionLost)
    lock.release(lost.signal.aborted)
  }
}

export async function runWorker() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const database = createDatabase(url)
  let queue:Awaited<ReturnType<typeof startQueue>>|undefined
  const shutdown=new AbortController()
  let stopping:Promise<void>|undefined
  const stop=()=>stopping??=(async()=>{
    shutdown.abort()
    try{await queue?.stop({timeout:10000})}finally{await database.pool.end()}
  })()
  try{
    await assertRuntimeRole(database.pool)
    await verifyMigrations(database.pool)
    queue = await startQueue(url)
    const notify:Notify = (eventId,domain) => publishUpdate(database,eventId,domain)
    await queue.work<ReplyJob>('agent.reply', { batchSize: 1, pollingIntervalSeconds: .5 }, async jobs => {
      for (const job of jobs) await processReply(database,job.data,notify,undefined,AbortSignal.any([shutdown.signal,job.signal]))
    })
  }catch(error){await stop();throw error}
  console.log('Reso worker ready')
  for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>{void stop().then(()=>process.exit(0),()=>process.exit(1))})
}

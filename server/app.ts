import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { fromNodeHeaders } from 'better-auth/node'
import { EventEmitter } from 'node:events'
import { sql } from './db'
import { ZodError } from 'zod'
import { createDatabase } from './db'
import { startQueue } from './worker'
import { asrAuthHeaders } from './asr'
import type { Domain, User } from '../shared/types'
import { HttpError, json } from './http'
import { createRouteContext } from './context'
import { registerAccounts } from './routes/accounts'
import { registerEvents } from './routes/events'
import { registerAssessments } from './routes/assessments'
import { registerSharing } from './routes/sharing'
import { registerSupport } from './routes/support'
import { registerTransport } from './routes/transport'
import { registerUnderstandings } from './understandings'
import {registerAgentActions} from './agent-actions'
import { registerFollowups } from './routes/followups'
import { createAuth } from './auth'
import { verifyMigrations } from './migrations'
import { assertRuntimeRole } from './database-access'
import { listenForUpdates, publishUpdate } from './notifications'

declare module 'fastify' { interface FastifyRequest { resoUser: User | null; resoSessionId: string | null } }

export async function createApp(options: { databaseUrl?: string; secret?: string; startJobs?: boolean } = {}) {
  const url = options.databaseUrl || process.env.DATABASE_URL
  const secret = options.secret || process.env.BETTER_AUTH_SECRET
  if (!url || !secret || secret.length < 32) throw new Error('DATABASE_URL and a persistent BETTER_AUTH_SECRET (32+ characters) are required')
  const database = createDatabase(url)
  const { pool } = database
  const origins = new Set((process.env.TRUSTED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(origin=>origin.trim()).filter(Boolean))
  const auth = createAuth(pool,secret)
  try {
    await assertRuntimeRole(pool)
    await verifyMigrations(pool)
  } catch (error) {
    await pool.end()
    throw error
  }
  let queue:Awaited<ReturnType<typeof startQueue>>|null=null
  try { if(options.startJobs!==false)queue=await startQueue(url) } catch(error){await pool.end();throw error}
  const app = Fastify({ logger: false, bodyLimit: 2_100_000, trustProxy: '127.0.0.1' })
  // Socket teardown can erase remoteAddress during asynchronous authentication.
  app.addHook('onRequest',async(request,reply)=>{
    const ip=request.ip
    if(!ip)return reply.code(400).send({error:'连接已关闭，请重新连接后重试'})
    Object.defineProperty(request,'ip',{value:ip})
  })
  app.decorateRequest('resoUser', null)
  app.decorateRequest('resoSessionId', null)
  await app.register(multipart, { limits: { fileSize: 1_920_000, files: 1, fields: 0 } })
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' })
  const updates = new EventEmitter(); updates.setMaxListeners(200)
  let listener:Awaited<ReturnType<typeof listenForUpdates>>
  try { listener=await listenForUpdates(database,updates) }
  catch(error){await queue?.stop();await pool.end();throw error}
  const notify = (eventId: string, domain: Domain) => publishUpdate(database,eventId,domain)
  async function enqueue(eventId:string,domain:Domain,actorId:string,executor:Parameters<typeof database.query>[1]=database.db,methodOffers=false){
    if(!queue)return
    const queued=await queue.send('agent.reply',{eventId,domain,actorId,methodOffers},{expireInSeconds:180,db:{executeSql:async(statement,values=[])=>({
      // Keep pg-boss's positional parameters bound inside the business transaction.
      rows:await database.query(sql.join(statement.split(/(\$\d+)/).map(part=>/^\$\d+$/.test(part)?sql`${values[Number(part.slice(1))-1]}`:sql.raw(part)),sql.empty()),executor),
    })}})
    if(!queued)throw new Error('REPLY_NOT_ENQUEUED')
  }
  const context = createRouteContext(database, notify, enqueue)
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: '请检查输入内容与版本，填写完整后重试' })
    const caught = error instanceof Error ? error : new Error('Unknown error')
    const status = 'statusCode' in caught && typeof caught.statusCode === 'number' ? caught.statusCode : 500
    const code = error instanceof HttpError ? status : status >= 400 && status < 500 ? status : 500
    if(code>=500)console.error('API request failed; no request body or database parameters logged.')
    return reply.code(code).send({ error: error instanceof HttpError || code < 500 ? caught.message : '服务暂时无法完成操作，请稍后重试' })
  })
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD' && !origins.has(String(request.headers.origin || ''))) return reply.code(403).send({ error: '请求来源未获允许' })
    if (request.url.startsWith('/api/auth/') || request.url === '/api/status' || /^\/api\/invites\/[A-Za-z0-9_-]+(?:\?|$)/.test(request.url) && request.method === 'GET') return
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session) return reply.code(401).send({ error: '请先登录' })
    request.resoUser = session.user
    request.resoSessionId = session.session.id
  })
  app.route({ method: ['GET','POST'], url: '/api/auth/*', handler: async (request, reply) => {
    const headers=fromNodeHeaders(request.headers);headers.set('x-reso-client-ip',request.ip)
    const response = await auth.handler(new Request(new URL(request.url, process.env.PUBLIC_ORIGIN || 'http://localhost:5173'), { method: request.method, headers, ...(request.body ? { body: json(request.body) } : {}) }))
    reply.code(response.status)
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value) })
    const cookies = response.headers.getSetCookie(); if (cookies.length) reply.header('set-cookie', cookies)
    return reply.send(await response.text())
  } })
  app.get('/api/status', async (_request,reply) => {
    let available=true
    try{await pool.query('SELECT 1')}catch{available=false;reply.code(503)}
    return{database:available,notificationsConnected:listener.connected,agentConfigured:!!process.env.DEEPSEEK_API_KEY,asrConfigured:!!asrAuthHeaders(),localMvp:true}
  })
  registerAccounts(app, context)
  registerEvents(app, context)
  registerAssessments(app, context)
  registerSharing(app, context)
  registerSupport(app, context)
  registerTransport(app, context, updates)
  registerUnderstandings(app,context)
  registerFollowups(app,context)
  registerAgentActions(app,context)
  app.addHook('onClose',async()=>{updates.removeAllListeners();try{await listener.close()}finally{try{await queue?.stop()}finally{await pool.end()}}})
  return{app,database,auth,queue,notify}
}

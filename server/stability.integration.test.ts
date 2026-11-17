import {withObservationFixture} from './test-agent'
const processReply=(...args:Parameters<typeof processProductionReply>)=>processProductionReply(args[0],args[1],args[2],args[3]?withObservationFixture(args[3]):undefined,args[4])
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {createTestDatabase} from './test-database'
import {createApp} from './app'
import {processReply as processProductionReply} from './worker'
import {localTestPolicy} from '../shared/consent'
import {setTimeout as delay} from 'node:timers/promises'
import {EventEmitter,once} from 'node:events'
import {createDatabase} from './db'
import {listenForUpdates,publishUpdate} from './notifications'
import {Pool} from 'pg'

const skip=!process.env.DATABASE_URL
async function until(check:()=>Promise<boolean>){
  const deadline=Date.now()+5000
  while(!await check()){assert.ok(Date.now()<deadline,'condition did not recover');await delay(20)}
}
let nextIp=30
async function scenario(startJobs=false){
  const fixture=await createTestDatabase()
  const service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs})
  const remoteAddress=`127.1.0.${nextIp++}`
  try{
  const headers={origin:'http://localhost:5173',cookie:''}
  const signup=await service.app.inject({method:'POST',url:'/api/auth/sign-up/email',remoteAddress,headers,payload:{name:'Stability',email:'stability@test.example',password:randomBytes(18).toString('hex')}})
  assert.equal(signup.statusCode,200,signup.body)
  const cookies=signup.headers['set-cookie'];headers.cookie=(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(v=>String(v).split(';')[0]).join('; ')
  const call=(method:'GET'|'POST'|'PUT'|'DELETE',url:string,payload?:object)=>service.app.inject({method,url,remoteAddress,headers,...(payload?{payload}:{})})
  assert.equal((await call('POST','/api/consent',{accepted:true,version:localTestPolicy.version})).statusCode,200)
  const event=(await call('POST','/api/events',{title:'Stability'})).json()
  const job={eventId:event.id,domain:'private' as const,actorId:signup.json().user.id}
  const send=(content:string,clientId=randomUUID(),domain='private')=>call('POST',`/api/events/${event.id}/messages`,{content,clientId,domain})
  return {fixture,service,call,job,send,close:async()=>{await service.app.close();await fixture.cleanup()}}
  }catch(error){await service.app.close();await fixture.cleanup();throw error}
}

test('message and reply job commit together; duplicates do not enqueue twice and retry repairs a missed task',{skip},async()=>{
  const s=await scenario(true),{queue,database}=s.service
  try{
    const send=queue!.send.bind(queue!)
    queue!.send=async()=>{throw new Error('INJECTED_QUEUE_FAILURE')}
    const clientId=randomUUID()
    assert.equal((await s.send('atomic queue test',clientId)).statusCode,500)
    assert.equal((await database.pool.query('SELECT count(*) FROM messages WHERE client_id=$1',[clientId])).rows[0].count,'0','a failed enqueue must roll back the message')
    queue!.send=async()=>null
    assert.equal((await s.send('atomic queue test',clientId)).statusCode,500)
    assert.equal((await database.pool.query('SELECT count(*) FROM messages WHERE client_id=$1',[clientId])).rows[0].count,'0')
    queue!.send=send
    assert.equal((await s.send('atomic queue test',clientId)).statusCode,200)
    assert.equal((await s.send('atomic queue test',clientId)).statusCode,200)
    assert.equal((await database.pool.query('SELECT count(*) FROM pgboss.job')).rows[0].count,'1')
    const jobs=await queue!.fetch('agent.reply',{batchSize:1});await queue!.complete('agent.reply',jobs[0].id)
    assert.equal((await s.call('POST',`/api/events/${s.job.eventId}/retry`,{domain:'private'})).statusCode,200)
    assert.equal((await queue!.fetch('agent.reply',{batchSize:1})).length,1)
  }finally{await s.close()}
})

test('silent replies are idempotent and a reclaimed conversation closes interrupted run traces',{skip},async()=>{
  const s=await scenario()
  try{
    const message=(await s.send('room silence',randomUUID(),'room')).json()
    const runId=randomUUID()
    await s.fixture.fixtures.pool.query("INSERT INTO agent_runs(id,event_id,domain,context_version,model,status,trigger_message_id) VALUES($1,$2,'room',1,'interrupted','running',$3)",[runId,s.job.eventId,message.id])
    let calls=0
    const model=withObservationFixture(async()=>{calls++;return JSON.stringify({intent:'listen',strategy:'silent',evidence_ids:[],uncertainty:'',needs_human:false})},{room_intervention_needed:false})
    await processProductionReply(s.service.database,{...s.job,domain:'room'},s.service.notify,model)
    await processProductionReply(s.service.database,{...s.job,domain:'room'},s.service.notify,model)
    assert.equal(calls,1,'duplicate delivery must not repeat a successful silent model call')
    const previous=(await s.fixture.fixtures.pool.query('SELECT status,error_code,finished_at FROM agent_runs WHERE id=$1',[runId])).rows[0]
    assert.equal(previous.status,'error');assert.equal(previous.error_code,'WORKER_INTERRUPTED');assert.ok(previous.finished_at)
  }finally{await s.close()}
})

test('a provider failure cannot publish an error against a superseded conversation',{skip},async()=>{
  const s=await scenario()
  try{
    await s.send('old request')
    const reply=processReply(s.service.database,s.job,s.service.notify,async()=>{
      assert.equal((await s.send('new request')).statusCode,200)
      throw new Error('MODEL_HTTP_503')
    })
    await assert.rejects(reply,/CONTEXT_CHANGED/)
    assert.equal((await s.service.database.pool.query("SELECT count(*) FROM messages WHERE role='assistant'")).rows[0].count,'0')
  }finally{await s.close()}
})

test('exercise updates acquire the event before child records, avoiding a deadlock with safety replies',{skip},async()=>{
  const s=await scenario(),client=await s.fixture.fixtures.pool.connect()
  let request:ReturnType<typeof s.call>|undefined
  try{
    const exercise={act:1,paused:false,notes:{},story:'',saved:false,version:0}
    assert.equal((await s.call('PUT',`/api/events/${s.job.eventId}/exercise`,exercise)).statusCode,200)
    await client.query('BEGIN');await client.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[s.job.eventId])
    request=s.call('PUT',`/api/events/${s.job.eventId}/exercise`,{...exercise,version:1,paused:true})
    void request.then(()=>{})
    await until(async()=>(await s.fixture.fixtures.pool.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",[new URL(s.fixture.runtimeUrl).username])).rowCount!>0)
    await client.query('SELECT event_id FROM exercises WHERE event_id=$1 FOR UPDATE NOWAIT',[s.job.eventId])
  }finally{
    await client.query('ROLLBACK');client.release()
    if(request)assert.equal((await request).statusCode,200)
    await s.close()
  }
})

test('notification and idle database connections recover after backend termination; cleanup releases all clients',{skip},async()=>{
  const fixture=await createTestDatabase(),database=createDatabase(fixture.runtimeUrl),updates=new EventEmitter()
  const listener=await listenForUpdates(database,updates)
  try{
    const pid=(await fixture.fixtures.pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query='LISTEN reso_updates'")).rows[0].pid
    await fixture.fixtures.pool.query('SELECT pg_terminate_backend($1)',[pid])
    await until(async()=>(await fixture.fixtures.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>$1 AND query='LISTEN reso_updates'",[pid])).rowCount!>0&&listener.connected)
    const received=once(updates,'update'),id=randomUUID()
    await publishUpdate(database,id,'private')
    assert.deepEqual((await received)[0],{eventId:id,domain:'private'})
    const idle=await database.pool.connect(),idlePid=(await idle.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    idle.release()
    await fixture.fixtures.pool.query('SELECT pg_terminate_backend($1)',[idlePid])
    await until(async()=>{try{return(await database.pool.query('SELECT 1')).rowCount===1}catch{return false}})
    assert.equal((await database.pool.query('SHOW statement_timeout')).rows[0].statement_timeout,'15s')
    assert.equal((await database.pool.query('SHOW idle_in_transaction_session_timeout')).rows[0].idle_in_transaction_session_timeout,'15s')
  }finally{await listener.close();await database.pool.end();await fixture.cleanup()}
})

test('health reflects database failures and a failed notification does not turn a committed write into an error',{skip},async()=>{
  const s=await scenario(),{pool}=s.service.database
  const query=pool.query
  try{
    pool.query=(async()=>{throw new Error('INJECTED_DATABASE_FAILURE')}) as typeof pool.query
    const health=await s.call('GET','/api/status')
    assert.equal(health.statusCode,503);assert.equal(health.json().database,false)
    await assert.doesNotReject(publishUpdate(s.service.database,s.job.eventId,'private'))
    pool.query=query
    assert.equal((await s.call('GET','/api/status')).statusCode,200)
  }finally{pool.query=query;await s.close()}
})

test('worker cancellation reaches the model and a retry can finish without publishing an interruption message',{skip},async()=>{
  const s=await scenario(),cancel=new AbortController()
  try{
    await s.send('cancel generation')
    let entered!:()=>void
    const started=new Promise<void>(resolve=>{entered=resolve})
    const result=processReply(s.service.database,s.job,s.service.notify,async(_prompt,_json,signal)=>{
      assert.ok(signal)
      entered()
      return new Promise<string>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('MODEL_ABORTED')),{once:true}))
    },cancel.signal)
    await started;cancel.abort();await assert.rejects(result,/WORKER_INTERRUPTED/)
    assert.equal((await s.service.database.pool.query("SELECT count(*) FROM messages WHERE role='assistant'")).rows[0].count,'0')
    await processReply(s.service.database,s.job,s.service.notify,async(_prompt,json)=>json?JSON.stringify({intent:'listen',strategy:'listen',evidence_ids:[],uncertainty:'',needs_human:false}):'retry completed')
    assert.equal((await s.service.database.pool.query("SELECT count(*) FROM messages WHERE role='assistant' AND status='complete'")).rows[0].count,'1')
  }finally{await s.close()}
})

test('losing the conversation lock cancels generation and blocks publication',{skip},async()=>{
  const s=await scenario()
  try{
    await s.send('lock connection interruption')
    const reply=processReply(s.service.database,s.job,s.service.notify,async(_prompt,_json,signal)=>{
      assert.ok(signal)
      const row=(await s.fixture.fixtures.pool.query("SELECT pid FROM pg_stat_activity WHERE usename=$1 AND query LIKE 'SELECT pg_advisory_lock%'",[new URL(s.fixture.runtimeUrl).username])).rows[0]
      assert.ok(row)
      await s.fixture.fixtures.pool.query('SELECT pg_terminate_backend($1)',[row.pid])
      await until(async()=>signal.aborted)
      throw new Error('MODEL_ABORTED')
    })
    await assert.rejects(reply,/WORKER_CONNECTION_LOST/)
    assert.equal((await s.service.database.pool.query("SELECT count(*) FROM messages WHERE role='assistant'")).rows[0].count,'0')
    const state=(await s.service.database.pool.query('SELECT status,error_code FROM agent_runs')).rows[0]
    assert.deepEqual(state,{status:'error',error_code:'WORKER_CONNECTION_LOST'})
  }finally{await s.close()}
})

test('HTTP and durable enqueue recover after the isolated database rejects and terminates every connection',{skip},async()=>{
  const s=await scenario(true),admin=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL})
  const name=new URL(s.fixture.migrationUrl).pathname.slice(1)
  assert.match(name,/^reso_test_[a-f0-9]+$/)
  try{
    const address=await s.service.app.listen({host:'127.0.0.1',port:0})
    await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`)
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name])
    const unavailable=await fetch(`${address}/api/status`)
    assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).database,false)
    await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`)
    await until(async()=>{
      const response=await fetch(`${address}/api/status`)
      return response.ok&&(await response.json()).notificationsConnected
    })
    assert.equal((await s.send('write after database recovery')).statusCode,200)
    assert.equal((await s.service.queue!.fetch('agent.reply',{batchSize:1})).length,1)
  }finally{
    await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`)
    await admin.end();await s.close()
  }
})

test('disconnect during an asynchronous hook cannot erase the limiter IP or poison later requests',{skip},async()=>{
  const fixture=await createTestDatabase()
  const service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
  let enter!:()=>void,release!:()=>void,socketClosed!:Promise<unknown>,finished=false
  const entered=new Promise<void>(resolve=>{enter=resolve}),barrier=new Promise<void>(resolve=>{release=resolve}),errors:string[]=[]
  service.app.addHook('onRequest',async request=>{
    if(request.url==='/api/events?disconnect=1'){
      socketClosed=once(request.raw.socket,'close');enter();await barrier
    }
  })
  service.app.addHook('preHandler',async request=>{if(request.url.includes('disconnect=1'))finished=true})
  service.app.addHook('onError',(request,_reply,error,done)=>{if(request.url.includes('disconnect=1')){errors.push(error.message);finished=true}done()})
  try{
    await service.app.listen({host:'127.0.0.1',port:0})
    const address=service.app.server.address();assert.ok(address&&typeof address==='object')
    const base=`http://127.0.0.1:${address.port}`,origin='http://localhost:5173'
    const signup=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Disconnect regression',email:`disconnect-${randomUUID()}@example.test`,password:randomBytes(18).toString('hex')})})
    assert.equal(signup.status,200)
    const cookie=signup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),controller=new AbortController()
    const cancelled=fetch(base+'/api/events?disconnect=1',{headers:{cookie},signal:controller.signal}).catch(()=>undefined)
    await entered;controller.abort();await cancelled;await socketClosed;release();await until(async()=>finished)
    assert.deepEqual(errors,[])
    assert.equal((await fetch(base+'/api/events',{headers:{cookie}})).status,200)
  }finally{release();await service.app.close();await fixture.cleanup()}
})

test('successful retry replaces the system-error attribution with the assistant attribution',{skip},async()=>{
  const s=await scenario()
  try{
    await s.send('Retry attribution fixture')
    await assert.rejects(processReply(s.service.database,s.job,s.service.notify,async()=>{throw Error('PROVIDER_UNAVAILABLE')}),/PROVIDER_UNAVAILABLE/)
    const failed=(await s.call('GET',`/api/events/${s.job.eventId}`)).json().messages.at(-1)
    assert.equal(failed.status,'error');assert.equal(failed.author_name,'系统')
    await processReply(s.service.database,s.job,s.service.notify,async(_prompt,json)=>json?JSON.stringify({intent:'retry',strategy:'listen',evidence_ids:[],uncertainty:'',needs_human:false}):'Retried assistant reply')
    const recovered=(await s.call('GET',`/api/events/${s.job.eventId}`)).json().messages.at(-1)
    assert.equal(recovered.id,failed.id);assert.equal(recovered.status,'complete');assert.equal(recovered.author_name,'Reso')
  }finally{await s.close()}
})

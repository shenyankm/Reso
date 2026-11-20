import {withObservationFixture} from './test-agent'
const processReply=(...args:Parameters<typeof processProductionReply>)=>processProductionReply(args[0],args[1],args[2],args[3]?withObservationFixture(args[3]):undefined,args[4])
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { createApp } from './app'
import { createTestDatabase } from './test-database'
import { localTestPolicy } from '../shared/consent'
import { startQueue, processReply as processProductionReply } from './worker'

const skip=!process.env.DATABASE_URL

test('disabled counselors, revoked members and invalid sessions lose access on HTTP and SSE', {skip}, async()=>{
  const fixture=await createTestDatabase()
  const service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
  const {app,database,notify}=service
  const streams:{abort:AbortController;reader:ReadableStreamDefaultReader<Uint8Array>}[]=[]
  try {
    let nextIp=2;const ips=new Map<string,string>()
    const call=(method:'GET'|'POST'|'PATCH'|'DELETE',url:string,cookie='',payload?:unknown)=>app.inject({method,url,remoteAddress:cookie?ips.get(cookie)||'127.0.0.1':`127.0.0.${nextIp}`,headers:{origin:'http://localhost:5173',...(cookie?{cookie}:{}),...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{payload:JSON.stringify(payload)})})
    const signup=async(name:string)=>{
      const response=await call('POST','/api/auth/sign-up/email','',{name,email:`${name}@authz.test`,password:randomBytes(18).toString('hex')})
      assert.equal(response.statusCode,200)
      const raw=response.headers['set-cookie'],cookie=(Array.isArray(raw)?raw:[raw]).filter(Boolean).map(v=>String(v).split(';')[0]).join('; ')
      ips.set(cookie,`127.0.0.${nextIp++}`)
      assert.equal((await call('POST','/api/consent',cookie,{accepted:true,version:localTestPolicy.version})).statusCode,200)
      return {id:response.json().user.id as string,cookie}
    }
    const owner=await signup('owner'),member=await signup('member'),counselor=await signup('counselor')
    const eventId=(await call('POST','/api/events',owner.cookie,{title:'权限回归测试'})).json().id
    const invitation=(await call('POST',`/api/events/${eventId}/invites`,owner.cookie,{shareSummary:false,version:0,clientId:randomUUID()})).json()
    assert.equal((await call('POST',`/api/invites/${invitation.token}/respond`,member.cookie,{accept:true})).statusCode,200)
    const pending=(await call('POST',`/api/events/${eventId}/invites`,owner.cookie,{shareSummary:false,version:0,clientId:randomUUID()})).json()
    assert.equal(typeof pending.token,'string')
    const consultantId=randomUUID()
    await fixture.fixtures.pool.query("INSERT INTO consultants(id,user_id,name,approach,qualifications,price,test_only,verified_at) VALUES($1,$2,'test','test','test','test',false,now())",[consultantId,counselor.id])
    assert.equal((await call('GET','/api/me',counselor.cookie)).json().role,'counselor')
    const application=(await call('POST',`/api/events/${eventId}/applications`,owner.cookie,{consultantId,shareSummary:false,version:0,clientId:randomUUID()})).json()
    await fixture.fixtures.pool.query('UPDATE consultants SET active=false WHERE id=$1',[consultantId])
    assert.equal((await call('GET','/api/me',counselor.cookie)).json().role,'member')
    assert.equal((await call('GET','/api/counselor/applications',counselor.cookie)).statusCode,403)
    for(const [next,current] of [['accepted','pending'],['rejected','pending'],['proposed','accepted'],['completed','scheduled']]){
      await fixture.fixtures.pool.query('UPDATE applications SET status=$1 WHERE id=$2',[current,application.id])
      assert.equal((await call('PATCH',`/api/applications/${application.id}`,counselor.cookie,{status:next,scheduledAt:new Date(Date.now()+86400000).toISOString()})).statusCode,403)
    }
    assert.equal((await call('PATCH',`/api/applications/${application.id}`,member.cookie,{status:'cancelled'})).statusCode,403)
    assert.equal((await call('PATCH',`/api/applications/${application.id}`,owner.cookie,{status:'cancelled'})).statusCode,200)
    // A cached display role alone must never grant professional access.
    await fixture.fixtures.pool.query("UPDATE profiles SET role='counselor' WHERE user_id=$1",[member.id])
    assert.equal((await call('GET','/api/me',member.cookie)).json().role,'member')
    assert.equal((await call('GET','/api/counselor/applications',member.cookie)).statusCode,403)

    const address=await app.listen({host:'127.0.0.1',port:0})
    async function stream(cookie:string){
      const abort=new AbortController(),response=await fetch(`${address}/api/stream`,{headers:{cookie},signal:abort.signal})
      assert.equal(response.status,200)
      const reader=response.body!.getReader();streams.push({abort,reader})
      let buffer='',pending:ReturnType<typeof reader.read>|null=null
      const decoder=new TextDecoder()
      async function next(timeout=1500):Promise<string|null>{
        while(!buffer.includes('\n\n')){
          pending ||= reader.read()
          let timer:ReturnType<typeof setTimeout>|undefined
          try {
            const part=await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('SSE_TIMEOUT')),timeout)})])
            pending=null
            if(part.done)return null
            buffer+=decoder.decode(part.value,{stream:true})
          }finally{if(timer)clearTimeout(timer)}
        }
        const end=buffer.indexOf('\n\n'),frame=buffer.slice(0,end);buffer=buffer.slice(end+2);return frame
      }
      assert.match((await next())!,/event: ready/)
      return next
    }
    const ownerNext=await stream(owner.cookie),memberNext=await stream(member.cookie),outsiderNext=await stream(counselor.cookie)
    const before=(await call('GET',`/api/events/${eventId}?domain=room`,member.cookie)).json().event.updated_at
    assert.equal((await call('POST',`/api/events/${eventId}/messages`,owner.cookie,{content:'private only',domain:'private',clientId:randomUUID()})).statusCode,200)
    assert.match((await ownerNext())!,/event: update/)
    await assert.rejects(memberNext(200),/SSE_TIMEOUT/)
    assert.equal((await call('GET',`/api/events/${eventId}?domain=room`,member.cookie)).json().event.updated_at,before)
    assert.equal((await call('GET','/api/events',member.cookie)).json()[0].updated_at,before)
    await call('POST',`/api/events/${eventId}/messages`,member.cookie,{content:'public update',domain:'room',clientId:randomUUID()})
    assert.match((await memberNext())!,/event: update/);assert.match((await ownerNext())!,/event: update/)
    assert.equal((await call('DELETE',`/api/events/${eventId}/members/${member.id}`,owner.cookie)).statusCode,200)
    assert.match((await ownerNext())!,/event: update/)
    assert.equal(await memberNext(),'event: update\ndata: {}')
    await assert.rejects(outsiderNext(200),/SSE_TIMEOUT/)
    assert.equal((await call('POST',`/api/invites/${invitation.token}/respond`,member.cookie,{accept:true})).statusCode,410)
    assert.equal((await call('POST',`/api/invites/${pending.token}/respond`,member.cookie,{accept:true})).statusCode,410)
    await notify(eventId,'room')
    assert.match((await ownerNext())!,/event: update/)
    await assert.rejects(memberNext(200),/SSE_TIMEOUT/)
    assert.equal((await call('GET',`/api/events/${eventId}?domain=room`,member.cookie)).statusCode,403)
    assert.equal((await call('POST','/api/auth/sign-out',owner.cookie,{})).statusCode,200)
    assert.equal((await call('GET','/api/events',owner.cookie)).statusCode,401)
    await notify(eventId,'room')
    assert.equal(await ownerNext(),null)
    await fixture.fixtures.pool.query('UPDATE session SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1',[member.id])
    await notify(eventId,'room')
    assert.equal(await memberNext(),null)
    assert.equal((await call('GET','/api/events',member.cookie)).statusCode,401)
  } finally {
    for(const {abort,reader} of streams){abort.abort();await reader.cancel().catch(()=>{})}
    await app.close();await fixture.cleanup()
  }
})

test('runtime role cannot administer the database but can authenticate, queue, process and supervise replies', {skip}, async()=>{
  const fixture=await createTestDatabase()
  const service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:true})
  const {app,database,notify,queue}=service
  const queueErrors:unknown[]=[]
  queue!.on('error',error=>queueErrors.push(error))
  try {
    const role=(await database.pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
    assert.deepEqual(role,{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false})
    for(const statement of ['CREATE TABLE public.forbidden(id int)','CREATE SCHEMA forbidden','CREATE TEMP TABLE forbidden(id int)','CREATE ROLE forbidden','ALTER TABLE events ADD COLUMN forbidden text','DROP TABLE events','UPDATE consultants SET active=true','UPDATE profiles SET role=\'counselor\'','UPDATE schema_migrations SET checksum=\'forbidden\'']){
      await assert.rejects(database.pool.query(statement),error=>(error as {code:string}).code==='42501')
    }
    const origin='http://localhost:5173'
    const registered=await app.inject({method:'POST',url:'/api/auth/sign-up/email',headers:{origin},payload:{name:'Queue user',email:'queue@test.example',password:randomBytes(18).toString('hex')}})
    assert.equal(registered.statusCode,200,registered.body)
    const raw=registered.headers['set-cookie'],cookie=(Array.isArray(raw)?raw:[raw]).filter(Boolean).map(v=>String(v).split(';')[0]).join('; ')
    const headers={origin,cookie}
    assert.equal((await app.inject({method:'POST',url:'/api/consent',headers,payload:{accepted:true,version:localTestPolicy.version}})).statusCode,200)
    const created=(await app.inject({method:'POST',url:'/api/events',headers,payload:{title:'Queue test'}})).json()
    assert.equal((await app.inject({method:'POST',url:`/api/events/${created.id}/messages`,headers,payload:{content:'Queue processing test',domain:'private',clientId:randomUUID()}})).statusCode,200)
    const jobs=await queue!.fetch<{eventId:string;domain:'private';actorId:string}>('agent.reply',{batchSize:1})
    assert.equal(jobs.length,1)
    await processReply(database,jobs[0].data,notify,async(_prompt,json)=>json?JSON.stringify({intent:'test',strategy:'listen',evidence_ids:[],uncertainty:'',needs_human:false}):'测试回复')
    await queue!.complete('agent.reply',jobs[0].id)
    await queue!.supervise('agent.reply')
    assert.equal((await database.pool.query("SELECT status FROM agent_runs WHERE event_id=$1",[created.id])).rows[0].status,'complete')
    const errorJob=await queue!.send('agent.reply',{test:'retry'})
    const failed=await queue!.fetch('agent.reply',{batchSize:1})
    assert.equal(failed[0].id,errorJob)
    await queue!.fail('agent.reply',failed[0].id)
    const retry=(await database.pool.query('SELECT retry_limit,retry_count,state FROM pgboss.job WHERE id=$1',[errorJob])).rows[0]
    assert.equal(retry.retry_limit,2);assert.equal(retry.state,'retry')
    const extra=await startQueue(fixture.runtimeUrl);await extra.stop()
    assert.deepEqual(queueErrors,[])
    await assert.rejects(createApp({databaseUrl:fixture.migrationUrl,secret:fixture.secret,startJobs:false}),/restricted runtime/)
  } finally {await app.close();await fixture.cleanup()}
})

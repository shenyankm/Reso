import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {performance} from 'node:perf_hooks'
import {createApp} from '../server/app'
import {createTestDatabase} from '../server/test-database'
import {loadAgentContext} from '../server/agent-context'
import {localTestPolicy} from '../shared/consent'

const label=process.argv[2]||'current'
assert.match(label,/^[a-z0-9-]+$/)
const fixture=await createTestDatabase()
let service:Awaited<ReturnType<typeof createApp>>|undefined
try{
  service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
  const address=await service.app.listen({host:'127.0.0.1',port:0})
  let cookie=''
  async function call(path:string,body?:object){
    const response=await fetch(`${address}/api${path}`,{method:body?'POST':'GET',headers:{origin:'http://localhost:5173',cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
    const text=await response.text()
    assert.equal(response.status,200,`${path}: ${text}`)
    return{response,text,data:JSON.parse(text)}
  }
  const registered=await call('/auth/sign-up/email',{name:'Benchmark',email:'benchmark@performance.test',password:randomBytes(18).toString('hex')})
  cookie=registered.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  const owner=registered.data.user.id as string
  await call('/consent',{accepted:true,version:localTestPolicy.version})
  const event=(await call('/events',{title:'Performance fixture'})).data.id as string
  const other=randomUUID(),ownElse=randomUUID(),consultant=randomUUID(),pool=fixture.fixtures.pool
  await pool.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('perf-other','Other','other@performance.test',false,now(),now()),('perf-expert','Expert','expert@performance.test',false,now(),now())`)
  await pool.query("INSERT INTO events(id,owner_id,title) VALUES($1,'perf-other','Unrelated'),($2,$3,'Other owned event')",[other,ownElse,owner])
  await pool.query("INSERT INTO consultants(id,user_id,name,approach,qualifications,price) VALUES($1,'perf-expert','Test only','test','test','test')",[consultant])
  await pool.query("INSERT INTO messages(event_id,author_id,author_name,domain,role,content) SELECT $1,$2,'Benchmark','private','user','private message '||n||repeat('内容',60) FROM generate_series(1,180) n",[event,owner])
  await pool.query("INSERT INTO messages(event_id,author_id,author_name,domain,role,content) SELECT $1,$2,'Benchmark','room','user','room message '||n FROM generate_series(1,60) n",[event,owner])
  await pool.query("INSERT INTO invites(id,event_id,token_hash,expires_at) SELECT gen_random_uuid(),$1,gen_random_uuid()::text,now()+interval '1 day' FROM generate_series(1,30000)",[other])
  await pool.query("INSERT INTO invites(id,event_id,token_hash,expires_at) SELECT gen_random_uuid(),$1,gen_random_uuid()::text,now()+interval '1 day' FROM generate_series(1,3)",[event])
  await pool.query("INSERT INTO applications(id,client_id,event_id,applicant_id,consultant_id,shared_summary) SELECT gen_random_uuid(),gen_random_uuid(),$1,'perf-other',$2,'unrelated' FROM generate_series(1,30000)",[other,consultant])
  await pool.query("INSERT INTO applications(id,client_id,event_id,applicant_id,consultant_id,shared_summary) SELECT gen_random_uuid(),gen_random_uuid(),$1,$2,$3,repeat('confirmed summary ',100) FROM generate_series(1,3)",[event,owner,consultant])
  await pool.query("INSERT INTO followups(event_id,user_id,reflection) SELECT $1,$2,repeat('other reflection ',50) FROM generate_series(1,30000)",[ownElse,owner])
  await pool.query("INSERT INTO followups(event_id,user_id,reflection,next_step) SELECT $1,$2,'PRIVATE_FOLLOWUP_SENTINEL '||n||repeat('记录',100),'next step' FROM generate_series(1,30) n",[event,owner])
  await pool.query("INSERT INTO exercises(event_id,act,notes,story,saved) VALUES($1,5,'{}','PRIVATE_STORY_SENTINEL',true)",[event])
  await pool.query("INSERT INTO understandings(event_id,domain,author_id,source_message_id,content,provenance) SELECT event_id,domain,author_id,id,content,'user_quoted' FROM messages WHERE event_id=$1 AND domain='private' ORDER BY id DESC LIMIT 10",[event])
  await pool.query('ANALYZE invites; ANALYZE applications; ANALYZE followups; ANALYZE messages; ANALYZE understandings')

  let count=0
  const profiles=new Map<string,{count:number;ms:number}>(),original=service.database.pool.query
  service.database.pool.query=function(this:typeof fixture.fixtures.pool,...args:unknown[]){
    count++
    const first=args[0],text=typeof first==='string'?first:(first as {text?:string})?.text||''
    const key=text.replace(/\s+/g,' ').trim(),started=performance.now()
    const result=Reflect.apply(original,this,args)
    return result.finally(()=>{const item=profiles.get(key)||{count:0,ms:0};item.count++;item.ms+=performance.now()-started;profiles.set(key,item)})
  } as typeof original
  let metrics:Record<string,unknown>={}
  const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{p50Ms:+sorted[Math.floor(sorted.length*.5)].toFixed(3),p95Ms:+sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)].toFixed(3)}}
  async function measure(name:string,path:string,samples:number,concurrency=1){
    await call(path)
    const timings:number[]=[],counts:number[]=[]
    let bytes=0
    for(let offset=0;offset<samples;offset+=concurrency){
      const previous=count
      await Promise.all(Array.from({length:Math.min(concurrency,samples-offset)},async()=>{
        const start=performance.now(),result=await call(path)
        timings.push(performance.now()-start);bytes=Buffer.byteLength(result.text)
      }))
      counts.push(count-previous)
    }
    metrics[name]={...summary(timings),samples,concurrency,sqlPerRequest:counts.reduce((a,b)=>a+b,0)/samples,responseBytes:bytes}
  }
  const detail=(await call(`/events/${event}`)).data
  assert.equal(detail.messages.length,50);assert.equal(detail.applications.length,3);assert.equal(detail.followups.length,30)
  assert.ok(detail.hasMore)
  async function measurePhase(lightweight:boolean){
    metrics={};profiles.clear()
    const pagePath=lightweight?`/events/${event}/messages`:`/events/${event}`
    await measure('privateDetail',`/events/${event}`,20)
    await measure('roomDetail',`/events/${event}?domain=room`,12)
    await measure('privateConcurrent',`/events/${event}`,24,4)
    await measure('historyPage',`${pagePath}?domain=private&before=${detail.messages[0].id}`,16)
    const agentTimes:number[]=[]
    for(let i=0;i<12;i++){
      const start=performance.now(),loaded=await loadAgentContext(service!.database,{eventId:event,domain:'private',actorId:owner})
      assert.ok(loaded?.context.includes('PRIVATE_STORY_SENTINEL'));agentTimes.push(performance.now()-start)
    }
    const room=await loadAgentContext(service!.database,{eventId:event,domain:'room',actorId:owner})
    assert.ok(room);assert.ok(!room.context.includes('PRIVATE_STORY_SENTINEL'));assert.ok(!room.context.includes('PRIVATE_FOLLOWUP_SENTINEL'))
    metrics.agentContext={...summary(agentTimes),samples:12,providerCalls:0}
    return {metrics,queryProfiles:[...profiles].map(([statement,value])=>({statement,calls:value.count,totalMs:+value.ms.toFixed(3)})).sort((a,b)=>b.totalMs-a.totalMs).slice(0,12)}
  }
  assert.match(new URL(fixture.migrationUrl).pathname,/^\/reso_test_[a-f0-9]+$/)
  await pool.query('DROP INDEX followups_event_user_created,applications_event,invites_event_created')
  const before=await measurePhase(false)
  await pool.query(await readFile(new URL('../server/migrations/0006_detail_read_indexes.sql',import.meta.url),'utf8'))
  const after=await measurePhase(true)
  const report={label,checkedAt:new Date().toISOString(),fixture:{unrelatedApplications:30000,unrelatedInvites:30000,otherOwnedFollowups:30000,privateMessages:180},before,after}
  await mkdir('.data/performance',{recursive:true,mode:0o700})
  await writeFile(`.data/performance/${label}.json`,JSON.stringify(report,null,2),{mode:0o600})
  console.log(JSON.stringify({label,before:before.metrics,after:after.metrics},null,2))
}finally{await service?.app.close();await fixture.cleanup()}

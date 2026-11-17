import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {PgDialect} from 'drizzle-orm/pg-core'
import {ZodError} from 'zod'
import {registerAgentActions,readAgentActions} from './agent-actions'
import {registerAssessments} from './routes/assessments'
import {initialSessionState} from './agent-policy'
import {HttpError} from './http'
import type {RouteContext} from './context'
import type {Database} from './db'
import type {AgentProposal} from '../shared/agent'

const eventId='10000000-0000-4000-8000-000000000001',actionId='10000000-0000-4000-8000-000000000002'
const method:AgentProposal={kind:'method',value:{method:'narrative',reason:'先了解一个可选的回看经历练习'},source_ids:['11']}
async function fixture(options:{blocked?:boolean;stale?:boolean;proposal?:AgentProposal}={}){
  const dialect=new PgDialect(),app=Fastify()
  let version=3,status='pending'
  const writes:string[]=[],feedback:{kind:string;value:unknown}[]=[]
  const query=async(statement:Parameters<Database['query']>[0])=>{
    const q=dialect.sqlToQuery(statement),s=q.sql
    if(s.startsWith('SELECT status,base_version,proposal'))return[{status,base_version:options.stale?2:3,proposal:options.proposal||method}]
    if(s.startsWith("SELECT checkpoint->'session_state'"))return[{state:{...initialSessionState(`private:${eventId}`),context_version:3,last_message_id:'11',safety_state:options.blocked?'blocked':'clear'},status:'complete'}]
    if(s.startsWith('SELECT kind,value'))return feedback.filter(row=>row.kind==='agent_method_started'||row.kind==='agent_method_declined')
    if(s.startsWith('SELECT m.id::text,m.content'))return[{id:'11',content:'我想自己决定是否试一试',answered:true}]
    if(s.startsWith('SELECT act,notes,story'))return[{act:2,notes:{'1':'已经写下的内容'},story:'',saved:false,practice_notes:{}}]
    if(/^(UPDATE|INSERT)/.test(s)){
      writes.push(s)
      if(s.startsWith('UPDATE agent_actions'))status=s.includes("status='applied'")?'applied':'dismissed'
      if(s.startsWith('UPDATE events SET private_version'))version++
      if(s.startsWith('UPDATE exercises'))return[{event_id:eventId}]
    }
    return[]
  }
  const database={query,db:{transaction:async(task:(tx:unknown)=>Promise<void>)=>{
    const previous={version,status,writes:writes.length,feedback:feedback.length}
    try{return await task({})}catch(error){version=previous.version;status=previous.status;writes.splice(previous.writes);feedback.splice(previous.feedback);throw error}
  }}} as unknown as Database
  const context={database,requireEventOwner:async(id:string,user:string)=>{
    if(id!==eventId||user!=='owner')throw new HttpError(404,'事件不存在')
    return{private_version:version,owner_id:'owner'}
  },revision:async(_event:string,_actor:string,kind:string,value:unknown)=>{feedback.push({kind,value})},notify:async()=>{}} as unknown as RouteContext
  app.decorateRequest('resoUser',null)
  app.addHook('onRequest',async request=>{request.resoUser={id:'owner',name:'本人',email:'owner@example.test'}})
  app.setErrorHandler((error,_request,reply)=>{reply.code(error instanceof HttpError?error.statusCode:error instanceof ZodError?400:500).send({error:(error as Error).message})})
  registerAgentActions(app,context);registerAssessments(app,context)
  const call=(payload:unknown,id=eventId)=>app.inject({method:'POST',url:`/api/events/${id}/agent-actions/${actionId}`,payload:payload as object})
  return{app,call,writes,feedback,version:()=>version,database}
}

test('choosing a method creates only a confirmed-start feedback record, and repeated requests are idempotent',async t=>{
  const f=await fixture();t.after(()=>f.app.close())
  const response=await f.call({decision:'apply'})
  assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{saved:false,startedMethod:'narrative'})
  assert.equal(f.feedback.length,1);assert.equal(f.feedback[0].kind,'agent_method_started');assert.equal(f.version(),4)
  assert.ok(!f.writes.some(s=>/exercises|followups|share_grants|summary=/.test(s)))
  assert.equal((await f.call({decision:'apply'})).statusCode,200)
  assert.equal(f.feedback.length,1);assert.equal(f.version(),4)
})

test('declining a stale method is allowed and does not create practice content',async t=>{
  const f=await fixture({stale:true,blocked:true});t.after(()=>f.app.close())
  const response=await f.call({decision:'dismiss'})
  assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{saved:false})
  assert.equal(f.feedback[0].kind,'agent_method_declined');assert.equal(f.version(),4)
  assert.ok(!f.writes.some(s=>/exercises|followups|share_grants/.test(s)))
})

test('stale, blocked, edited or foreign-event method requests cannot start a practice',async t=>{
  for(const options of [{stale:true},{blocked:true},{}]){
    const f=await fixture(options);t.after(()=>f.app.close())
    const response=await f.call({decision:'apply',...(!options.stale&&!options.blocked?{value:{method:'nvc'}}:{})})
    assert.equal(response.statusCode,!options.stale&&!options.blocked?400:409)
    assert.equal(f.feedback.length,0);assert.equal(f.writes.length,0)
  }
  const f=await fixture();t.after(()=>f.app.close())
  assert.equal((await f.call({decision:'apply'},'10000000-0000-4000-8000-000000000099')).statusCode,404)
  assert.equal(f.feedback.length,0)
})

test('an explicit record save still writes its edited content rather than starting a method',async t=>{
  const f=await fixture({proposal:{kind:'summary',value:{summary:'原建议'},source_ids:['11']}});t.after(()=>f.app.close())
  const response=await f.call({decision:'apply',value:{summary:'本人核对后的内容'}})
  assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{saved:true})
  assert.equal(f.feedback[0].kind,'agent_proposal_applied');assert.ok(f.writes.some(s=>s.includes('summary=')))
  assert.ok(!f.feedback.some(row=>row.kind==='agent_method_started'))
})

test('a safety restriction still allows pausing, but cannot be bypassed by changing content while pausing',async t=>{
  const f=await fixture({blocked:true});t.after(()=>f.app.close())
  const body={act:2,paused:true,notes:{'1':'已经写下的内容'},story:'',saved:false,practice_notes:{},version:0}
  const pause=await f.app.inject({method:'PUT',url:`/api/events/${eventId}/exercise`,payload:body})
  assert.equal(pause.statusCode,200)
  const writes=f.writes.length
  const changed=await f.app.inject({method:'PUT',url:`/api/events/${eventId}/exercise`,payload:{...body,notes:{'1':'顺便写入新内容'}}})
  assert.equal(changed.statusCode,409);assert.equal(f.writes.length,writes)
})

test('malformed legacy proposals are omitted from rendering without rewriting stored rows',async()=>{
  const stored=[{id:actionId,message_id:'1',status:'pending',created_at:'2026-11-16T00:00:00Z',proposal:method},{id:'bad',message_id:'1',status:'pending',created_at:'2026-11-16T00:00:00Z',proposal:{kind:'unknown',value:{private_body:'should not render'}}}]
  const db={query:async()=>stored} as unknown as Database
  const rows=await readAgentActions(db,eventId,['1'])
  assert.equal(rows.length,1);assert.equal(rows[0].kind,'method')
  assert.equal(stored.length,2);assert.equal(stored[1].proposal.kind,'unknown')
})

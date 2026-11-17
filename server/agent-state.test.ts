import test from 'node:test'
import assert from 'node:assert/strict'
import {PgDialect} from 'drizzle-orm/pg-core'
import {loadAgentSessionState,assertSafetyAllowsPractice,assertSafetyAllowsSharing} from './agent-state'
import {initialSessionState} from './agent-policy'
import type {Database} from './db'
import {HttpError} from './http'

const eventId='10000000-0000-4000-8000-000000000001'
const initial=()=>initialSessionState(`private:${eventId}`)
function database(rows:unknown[][]){
  const queries:{sql:string;params:unknown[]}[]=[],dialect=new PgDialect()
  return{queries,value:{query:async(statement:Parameters<Database['query']>[0])=>{
    queries.push(dialect.sqlToQuery(statement))
    assert.ok(rows.length,'unexpected database query')
    return rows.shift()!
  }} as unknown as Database}
}

test('persisted state and genuine feedback remain scoped to the same private event',async()=>{
  const previous={...initial(),context_version:2,last_message_id:'11'}
  const db=database([[{state:previous,status:'complete'}],[{kind:'agent_method_declined',value:{method:'nvc',context_version:3}}]])
  const state=await loadAgentSessionState(db.value,eventId,'private')
  assert.deepEqual(state.declined_methods,['nvc']);assert.equal(state.readiness,'declined')
  assert.equal(state.context_version,3);assert.deepEqual(db.queries[0].params,[eventId,'private'])
  assert.deepEqual(db.queries[1].params,[eventId,2]);assert.deepEqual(previous.declined_methods,[])
})

test('room state does not consume private practice feedback',async()=>{
  const db=database([])
  db.value.query=async statement=>{db.queries.push(new PgDialect().sqlToQuery(statement));return[]}
  const state=await loadAgentSessionState(db.value,eventId,'room')
  assert.equal(state.scope_key,`room:${eventId}`);assert.equal(db.queries.length,1)
})

test('an unpublished ordinary checkpoint cannot replace user preferences or claim a method was shown',async()=>{
  const published={...initial(),context_version:2,last_offered_method:'nvc',advice_declined:true}
  const unfinished={...initial(),context_version:3,last_offered_method:'narrative',advice_declined:false}
  const db=database([[{state:unfinished,status:'error'}],[{state:published}],[]])
  const state=await loadAgentSessionState(db.value,eventId,'private')
  assert.equal(state.last_offered_method,'nvc');assert.equal(state.advice_declined,true)
  assert.equal(state.context_version,2)
  const risk=database([[{state:{...unfinished,safety_state:'review_required'},status:'error'}],[]])
  assert.equal((await loadAgentSessionState(risk.value,eventId,'private')).safety_state,'review_required')
  assert.equal(risk.queries.length,2)
})

test('unknown or mis-scoped stored state fails closed without importing private data',async()=>{
  for(const row of [{...initial(),policy_version:'unrecognized-v9'}, {...initial(),scope_key:'private:other',hypotheses:[{text:'OTHER_PRIVATE_CANARY'}]}, {malformed:true}]){
    const db=database([[{state:row}],[]])
    const state=await loadAgentSessionState(db.value,eventId,'private')
    assert.equal(state.safety_state,'review_required');assert.equal(state.scope_key,`private:${eventId}`)
    assert.ok(!JSON.stringify(state).includes('OTHER_PRIVATE_CANARY'))
  }
})

test('safety restrictions remain enforced after a later ordinary message or an unfinished assessment',async()=>{
  for(const safety_state of ['blocked','review_required'] as const){
    const db=database([[{state:{...initial(),safety_state,last_message_id:'11'},status:'complete'}],[],[{id:'12',content:'我们继续练习吧',answered:true}]])
    await assert.rejects(assertSafetyAllowsPractice(db.value,eventId),error=>error instanceof HttpError&&error.statusCode===409)
  }
  const pending=database([[],[],[{id:'12',content:'先做一个练习',answered:false}]])
  await assert.rejects(assertSafetyAllowsPractice(pending.value,eventId),/还未完成最新消息/)
})

test('the latest explicit risk still blocks an older clear state; first-time manual practice has no invented assessment',async()=>{
  const danger=database([[{state:{...initial(),safety_state:'clear',last_message_id:'11'},status:'complete'}],[],[{id:'12',content:'我不想活了',answered:false}]])
  await assert.rejects(assertSafetyAllowsPractice(danger.value,eventId),/优先核实安全/)
  const noConversation=database([[],[],[]])
  await assert.doesNotReject(assertSafetyAllowsPractice(noConversation.value,eventId))
  const legacy=database([[],[],[{id:'12',content:'想写下自己的想法',answered:true}]])
  await assert.doesNotReject(assertSafetyAllowsPractice(legacy.value,eventId))
})

test('sharing checks both affected domains while a private practice checks only its own domain',async()=>{
  const room={...initialSessionState(`room:${eventId}`),safety_state:'blocked',last_message_id:'12'}
  const sharing=database([[],[],[],[{state:room,status:'complete'}],[]])
  await assert.rejects(assertSafetyAllowsSharing(sharing.value,eventId),/优先核实安全/)
  assert.deepEqual(sharing.queries[3].params,[eventId,'room'])
  assert.deepEqual(sharing.queries[4].params,[eventId,'room'])
  const practice=database([[],[],[]])
  await assert.doesNotReject(assertSafetyAllowsPractice(practice.value,eventId))
  assert.ok(practice.queries.every(q=>!q.params.includes('room')))
})

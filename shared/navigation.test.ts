import test from 'node:test'
import assert from 'node:assert/strict'
import {parseEventLink,eventHash} from './navigation'

test('event deep links specify a domain and reject unrelated or malformed routes',()=>{
  const id='1b89035c-5c30-41b7-898a-71f1d08ee276'
  assert.deepEqual(parseEventLink(eventHash(id,'room')),{id,domain:'room'})
  assert.deepEqual(parseEventLink(eventHash(id,'private')),{id,domain:'private'})
  for(const input of ['#event/anything/room',`#event/${id}/admin`,`#event/${id}/room/extra`,'#invite/token'])assert.equal(parseEventLink(input),null)
})

test('questionnaire resumes at the first unanswered item without losing access to a complete set',async()=>{
  const {firstUnanswered}=await import('./scqa')
  assert.equal(firstUnanswered(undefined),0)
  assert.equal(firstUnanswered([4,2,null,5,null]),2)
  assert.equal(firstUnanswered(Array(24).fill(4)),0)
})

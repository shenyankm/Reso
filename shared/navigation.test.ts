import test from 'node:test'
import assert from 'node:assert/strict'
import {parseEventLink,eventHash,parseInvitationLink} from './navigation'

test('event deep links specify a domain and reject unrelated or malformed routes',()=>{
  const id='1b89035c-5c30-41b7-898a-71f1d08ee276'
  assert.deepEqual(parseEventLink(eventHash(id,'room')),{id,domain:'room'})
  assert.deepEqual(parseEventLink(eventHash(id,'private')),{id,domain:'private'})
  for(const input of ['#event/anything/room',`#event/${id}/admin`,`#event/${id}/room/extra`,'#invite/token'])assert.equal(parseEventLink(input),null)
})

test('in-app invites accept only a Reso invitation URL for the current service',()=>{
  const origin='https://reso.example',token='a'.repeat(43)
  assert.equal(parseInvitationLink(` ${origin}/#invite/${token} `,origin),token)
  for(const url of [
    `https://other.example/#invite/${token}`,
    `https://someone@reso.example/#invite/${token}`,
    `${origin}/different/#invite/${token}`,
    `${origin}/#invite/short`,
    `${origin}/#event/123/room`,
    `/#invite/${token}`,
  ])assert.equal(parseInvitationLink(url,origin),null)
})

test('questionnaire resumes at the first unanswered item without losing access to a complete set',async()=>{
  const {firstUnanswered}=await import('./scqa')
  assert.equal(firstUnanswered(undefined),0)
  assert.equal(firstUnanswered([4,2,null,5,null]),2)
  assert.equal(firstUnanswered(Array(24).fill(4)),0)
})

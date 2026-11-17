import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequestScope} from './requests'

test('late event responses and expired account requests cannot apply after navigation or logout',async()=>{
  const session=createRequestScope(),events=createRequestScope()
  const account=session.begin(),oldEvent=events.begin(account)
  let resolve!:()=>void
  const deferred=new Promise<void>(done=>{resolve=done})
  let visible='new event'
  const oldResponse=deferred.then(()=>{if(!oldEvent.aborted)visible='old private event'})
  const current=events.begin(account)
  resolve();await oldResponse
  assert.equal(visible,'new event');assert.equal(current.aborted,false)
  session.cancel();assert.equal(current.aborted,true)
  const nextAccount=session.begin()
  assert.equal(nextAccount.aborted,false);assert.equal(account.aborted,true)
})

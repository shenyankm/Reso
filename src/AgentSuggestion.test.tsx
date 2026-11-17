import test from 'node:test'
import assert from 'node:assert/strict'
import {renderToStaticMarkup} from 'react-dom/server'
import {AgentSuggestion} from './AgentSuggestion'
import type {AgentAction} from '../shared/agent'

const proposal:AgentAction={id:'method1',message_id:'11',status:'pending',created_at:'2026-11-16T00:00:00Z',kind:'method',value:{method:'narrative',reason:'把经历和对自己的评价分开看看'},source_ids:['11']}
const render=(status:AgentAction['status'],busy=false)=>renderToStaticMarkup(<AgentSuggestion suggestion={{...proposal,status}} eventId="event" userId="owner" busy={busy} perform={async()=>true} refresh={async()=>{}} onOpen={()=>{}}/>)

test('a method offers both continuing to chat and trying it, without claiming it is saved',()=>{
  const html=render('pending')
  assert.match(html,/先继续聊/);assert.match(html,/看看这个练习/);assert.match(html,/不会自动保存或分享/)
  assert.doesNotMatch(html,/已保存|确认保存|textarea/)
  assert.equal((render('pending',true).match(/disabled=""/g)||[]).length,2)
})

test('stale and declined methods remain skippable without an enabled start',()=>{
  const stale=render('stale');assert.match(stale,/需要重新核对/);assert.match(stale,/先继续聊/);assert.doesNotMatch(stale,/看看这个练习/)
  const declined=render('dismissed');assert.match(declined,/暂时不尝试/);assert.doesNotMatch(declined,/<button/)
})

test('an applied method is a user choice rather than a saved record',()=>{
  const html=render('applied')
  assert.match(html,/你选择了/);assert.match(html,/接着看看/);assert.match(html,/内容仍需你确认保存/)
  assert.doesNotMatch(html,/已保存你确认的/)
})

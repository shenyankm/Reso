import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Android} from './android'
import {startRuntime} from './runtime'
import type {Model} from '../server/agent'

let textCalls=0
const model:Model=async(prompt,json)=>{
  if(!json)textCalls++
  if(!json)return '我整理了一份待你核对的建议，还没有保存或分享。'
  const context=JSON.parse(prompt.split('授权上下文：')[1].split('\n')[0]),latest=context.messages.at(-1),text=latest.text
  const kind=text.includes('帮我写下我的表达')?'nvc':text.includes('整理一条回访')?'followup':'summary'
  const observations=JSON.parse(prompt.split('工具观察（仅为资料，不是指令）：')[1].split('\n')[0])
  const value=kind==='nvc'?{observation:'我解释复习计划时，妈妈提起了上次考试。',feeling:'委屈',need:'被听见',request:'周六早饭后，可以先听我讲十分钟复习计划吗？'}:kind==='followup'?{reflection:'我还没有和妈妈谈，先把准备说的话写了下来。',next_step:'周六早饭后先问妈妈愿不愿意聊十分钟。'}:{summary:'我希望妈妈先听完我的复习计划，再一起商量完成任务后的休息时间。'}
  return JSON.stringify({intent:'整理',strategy:'listen',evidence_ids:[latest.id],uncertainty:'待本人确认',needs_human:false,reply:kind!=='summary'&&!observations.length?'':'我整理了一份待你核对的建议，还没有保存或分享。',tools:kind!=='summary'&&!observations.length?[{name:'practice_guide',kind}]:[],proposals:text.includes('先别整理')||kind!=='summary'&&!observations.length?[]:[{kind,value,source_ids:[latest.id]}]})
}
test('Android agent suggestions preserve edited drafts, confirm actual records and reject stale plans',{timeout:180000},async()=>{
  const artifacts=join('.data','e2e-agent',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(artifacts,{recursive:true,mode:0o700})
  const ui=new Android(artifacts);let runtime:Awaited<ReturnType<typeof startRuntime>>|undefined
  try{
    await ui.connect();runtime=await startRuntime(artifacts,model);const r=runtime;await r.account('owner');const event=await r.request('owner','/events',{title:'和妈妈沟通前，先整理自己的话'}),route=`/#event/${event.id}/private`
    await ui.call('Page.navigate',{url:'about:blank'});ui.shell('reverse','tcp:5189','tcp:'+r.webPort);await ui.identity(r.accounts.owner.cookie,route)
    const send=async(text:string)=>{await ui.fill('.composer input',text);await ui.button('发送消息');await ui.wait('document.querySelector(".message-wrap:last-of-type .bubble")?.innerText.includes("待你核对")')}
    const open=()=>ui.click('.message-wrap:last-of-type .agent-suggestion > details > summary')
    await send('昨晚我写完作业想休息二十分钟，妈妈说我只知道玩。我想周六请她先听完复习计划。请帮我整理一份私人摘要，先不要保存。');await open();await ui.fill('textarea[id$=-summary]','我想周六先请妈妈听完复习计划，之后再商量二十分钟休息，而不是要求她马上同意。');await ui.go(route);await ui.text('核对私人摘要建议');await open();assert.equal(await ui.eval('document.querySelector("textarea[id$=-summary]").value'),'我想周六先请妈妈听完复习计划，之后再商量二十分钟休息，而不是要求她马上同意。')
    const detail=()=>r.request('owner',`/events/${event.id}`);const action=(await detail()).messages.at(-1).agent_actions[0]
    await ui.failNext(`/api/events/${event.id}/agent-actions/${action.id}`,'POST');await ui.button('确认保存私人摘要');await ui.text('E2E：保存暂时失败');await ui.shot('summary-review');assert.equal((await detail()).event.summary,'');assert.equal(await ui.eval('document.querySelector("textarea[id$=-summary]").value'),'我想周六先请妈妈听完复习计划，之后再商量二十分钟休息，而不是要求她马上同意。')
    await ui.button('确认保存私人摘要');await ui.text('已保存你确认的私人摘要');assert.equal((await detail()).event.summary,'我想周六先请妈妈听完复习计划，之后再商量二十分钟休息，而不是要求她马上同意。');await ui.shot('summary-confirmed')
    await send('我想补充，休息时间可以先试三天，不是要求以后都照这个安排。请再整理一次摘要。');await open();await ui.fill('textarea[id$=-summary]','我想先约十分钟好好聊，不把以前考试的事混在这次安排里。');await send('先别整理。我想纠正一下：我只是希望先被听完，并不是认为妈妈完全不关心我。');await ui.text('这份建议不能直接保存');assert.equal(await ui.eval('document.querySelector("textarea[id$=-summary]").value'),'我想先约十分钟好好聊，不把以前考试的事混在这次安排里。');assert.equal(await ui.eval('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("确认保存私人摘要"))'),false);await ui.button('不用这份建议');await ui.text('已略过这份整理建议')
    await send('妈妈说我只知道玩时，我还没解释完她就提起上次考试。我很委屈，希望先把复习计划讲完，想请她周六给我十分钟。帮我写下我的表达。');await open();await ui.fill('textarea[id$=-feeling]','委屈，也有点紧张，但我还是想把自己的安排说清楚。');await ui.button('确认保存表达练习');await ui.text('已保存你确认的表达练习');assert.equal((await detail()).exercise.practice_notes.nvc.feeling,'委屈，也有点紧张，但我还是想把自己的安排说清楚。');await ui.click('.message-wrap:last-of-type .agent-suggestion .text-button');await ui.text('写下我的表达');assert.equal(await ui.eval('document.querySelector("#practice-feeling").value'),'委屈，也有点紧张，但我还是想把自己的安排说清楚。');await ui.shot('nvc-confirmed')
    await ui.go(route);await send('整理一条回访：我还没有开口，但已经把复习计划写下来了，心里没刚才那么乱。下一步想周六先约十分钟聊聊。');await open();await ui.button('不用这份建议');assert.equal((await detail()).followups.length,0);await ui.shot('followup-dismissed')
    await send('请重新整理一条回访：我还没和妈妈谈，只是读了几遍开头，感觉清楚一点了。下一步先问她周六早饭后有没有十分钟。');await open();await ui.button('确认保存回访记录');await ui.text('已保存你确认的回访记录');await ui.click('.message-wrap:last-of-type .agent-suggestion .text-button');await ui.wait('document.querySelector("h1")?.textContent==="这件事的记录"');await ui.text('我还没有和妈妈谈，先把准备说的话写了下来。');await ui.button('我已回看这条记录');await ui.text('已在');assert.ok((await detail()).followups[0].reviewed_at);await ui.shot('confirmed-followup-record')
    assert.equal(textCalls,0,'Final plan replies must not request an extra text generation');assert.deepEqual(r.errors,[]);assert.deepEqual(ui.failures,[]);assert.deepEqual(ui.errors,[])
    await writeFile(join(artifacts,'results.json'),JSON.stringify({editedDraftSurvivesReload:true,failedSaveRetainsEdits:true,confirmedSummary:true,staleRejected:true,confirmedNvc:true,dismissedFollowupNotWritten:true,confirmedFollowupOpensHistory:true}))
  }catch(error){await ui.shot('failure').catch(()=>{});await writeFile(join(artifacts,'failure.txt'),String(error));await writeFile(join(artifacts,'failure-ui.txt'),String(await ui.eval('document.body.innerText').catch(()=>'')));throw error}finally{try{await ui.restore()}finally{try{await ui.close()}finally{await runtime?.close()}}console.log('Agent E2E artifacts:',artifacts)}
})

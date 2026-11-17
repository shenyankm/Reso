import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Android} from './android'
import {startRuntime} from './runtime'
import {names} from './conversation'

test('Android profile manages account info, saved records and private exports',{timeout:180000},async()=>{
  const artifacts=join('.data','e2e-profile',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(artifacts,{recursive:true,mode:0o700})
  const ui=new Android(artifacts);let runtime:Awaited<ReturnType<typeof startRuntime>>|undefined
  try{
    await ui.connect();runtime=await startRuntime(artifacts);const r=runtime;await r.account('owner');await r.account('other')
    await ui.call('Page.navigate',{url:'about:blank'});ui.shell('reverse','tcp:5189','tcp:'+r.webPort);await ui.identity(r.accounts.owner.cookie)
    assert.equal(await ui.eval('!!document.querySelector(".app-header .more")'),false);await ui.shot('events-without-account-menu');await ui.button('我的');await ui.text('留下的记录');assert.equal(await ui.eval('!!document.querySelector(".app-header .more")'),false);assert.equal(await ui.eval('document.querySelector(".bottom-nav [aria-current=page]").innerText'),'我的')
    assert.equal(await ui.eval('document.body.scrollWidth<=innerWidth&&[...document.querySelectorAll(".profile-links button,.profile-identity button,.bottom-nav button")].every(e=>{const r=e.getBoundingClientRect();return r.height>=48&&r.left>=0&&r.right<=innerWidth})'),true,'Profile controls must fit the viewport with 48px touch targets')
    await ui.shot('profile')
    await ui.button('修改昵称');await ui.fill('#profile-name','小禾同学');await ui.fill('#profile-name','');assert.equal(await ui.eval('document.querySelector(".profile-editor .primary").disabled'),true);await ui.fill('#profile-name','小禾同学');await ui.failNext('/api/me','PATCH');await ui.button('保存昵称');await ui.text('E2E：保存暂时失败');assert.equal(await ui.eval('document.querySelector("#profile-name").value'),'小禾同学')
    await ui.button('保存昵称');await ui.text('昵称已保存');assert.equal((await r.request('owner','/me')).user.name,'小禾同学');assert.equal((await r.request('other','/me')).user.name,names.other)
    await ui.failNext('/api/me/records','GET');await ui.button('我的记录');await ui.text('暂时没能读取记录');await ui.button('重新读取记录');await ui.text('想留下的话，会在这里');await ui.shot('records-empty')
    ui.shell('shell','input','keyevent','4');await ui.text('留下的记录')
    const event=await r.request('owner','/events',{title:'周六和妈妈聊复习安排'})
    await r.request('owner',`/events/${event.id}/exercise`,{act:5,paused:false,notes:{},story:'写下复习计划后，我发现自己想争取的是先把话说完，而不是让妈妈立刻同意所有安排。',saved:true,version:0,practice_notes:{nvc:{observation:'我刚说到周末的复习安排，妈妈就提起上次考试。'},roleplay:{my_words:'妈妈，你愿意先听我把复习计划说完吗？之后我们再一起看看哪里要调整。'}}},'PUT')
    await r.request('owner',`/events/${event.id}/followups`,{id:randomUUID(),reflection:'读了一遍准备好的开头，我还是有点紧张，但更清楚自己想说什么了。',nextStep:'周六早饭后先问妈妈有没有十分钟，不着急要求她同意。',reviewAt:null})
    await ui.button('我的记录');await ui.wait('document.querySelectorAll(".saved-records > button").length===4');await ui.shot('records-saved')
    await ui.click('.saved-records > button');await ui.text('这之后，有什么变化？');assert.match(await ui.eval('document.querySelector(".event-context-title").innerText'),/周六和妈妈聊复习安排/)
    ui.shell('shell','input','keyevent','4');await ui.wait('document.querySelectorAll(".saved-records > button").length===4')
    await ui.click('.saved-records > button:nth-child(2)');await ui.text('写下我的表达');assert.equal(await ui.eval('document.querySelector("#practice-observation").value'),'我刚说到周末的复习安排，妈妈就提起上次考试。')
    await ui.button('我的');await ui.button('待回访');await ui.text('读了一遍准备好的开头，我还是有点紧张，但更清楚自己想说什么了。');await ui.shot('pending-followups');await ui.button('我已回看这条记录');await ui.text('暂时没有待回访');await ui.button('查看全部记录');await ui.wait('document.querySelectorAll(".saved-records > button").length===4');await ui.text('回访记录')
    await ui.button('我的');await ui.button('隐私与数据');await ui.text('导出我的事件');await ui.shot('privacy')
    await ui.button('导出事件：周六和妈妈聊复习安排');const data=await ui.saveExport('reso-e2e-profile.json');assert.equal(data.event.id,event.id);assert.equal(data.exercise.story,'写下复习计划后，我发现自己想争取的是先把话说完，而不是让妈妈立刻同意所有安排。')
    await ui.button('我的');await ui.button('退出账号');await ui.text('登录，开始聊聊')
    await ui.identity(r.accounts.other.cookie);await ui.button('我的');await ui.button('我的记录');await ui.text('想留下的话，会在这里')
    assert.deepEqual(r.errors,[]);assert.deepEqual(ui.failures,[]);assert.deepEqual(ui.errors,[])
    await writeFile(join(artifacts,'results.json'),JSON.stringify({nameSaved:true,failedSaveRetainsInput:true,recordsRetry:true,savedRecordsOpen:true,backReturnsToRecords:true,reviewedFollowupRetainedInRecords:true,privateExport:true,accountIsolation:true}))
  }catch(error){await ui.shot('failure').catch(()=>{});await writeFile(join(artifacts,'failure.txt'),String(error));await writeFile(join(artifacts,'failure-ui.txt'),String(await ui.eval('document.body.innerText').catch(()=>'')));throw error}finally{try{await ui.restore()}finally{try{await ui.close()}finally{await runtime?.close()}}console.log('Profile E2E artifacts:',artifacts)}
})

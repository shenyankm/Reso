import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {Android} from './android'
import {startRuntime} from './runtime'

test('Android people layout uses real connections, private support and working invitations and topics',{timeout:240000},async()=>{
  const artifacts='.data/people-layout/avd';await mkdir(artifacts,{recursive:true,mode:0o700})
  const ui=new Android(artifacts);let runtime:Awaited<ReturnType<typeof startRuntime>>|undefined
  try{
    await ui.connect();runtime=await startRuntime(artifacts);const r=runtime
    await r.account('owner');const groupTitles=['家里的安排','周末的计划','课后作业'],peopleNames=['妈妈','爸爸','小林'],eventIds:string[]=[]
    for(const [i,who] of ['guest','other','friend'].entries()){
      if(i===2)await new Promise(resolve=>setTimeout(resolve,11000)) // Better Auth also limits signup bursts.
      await r.account(who);await r.request(who,'/me',{name:peopleNames[i]},'PATCH')
      const event=await r.request('owner','/events',{title:groupTitles[i]});eventIds.push(event.id)
      const invite=await r.request('owner',`/events/${event.id}/invites`,{shareSummary:false,version:0,clientId:randomUUID()});await r.request(who,`/invites/${invite.token}/respond`,{accept:true})
    }
    await r.request('owner',`/people/${r.accounts.guest.id}/category`,{category:'family'},'PUT')
    await r.request('owner',`/people/${r.accounts.other.id}/category`,{category:'friend'},'PUT')
    const consultant=await r.expert();await r.request('owner',`/events/${eventIds[0]}/applications`,{consultantId:consultant,shareSummary:false,version:0,clientId:randomUUID()})
    await ui.call('Page.navigate',{url:'about:blank'});ui.shell('reverse','tcp:5189','tcp:'+r.webPort);await ui.identity(r.accounts.owner.cookie)
    await ui.button('重要的人');await ui.text('共 3 人');await ui.wait('document.querySelectorAll(".recent-people-row button").length===3');assert.equal(await ui.eval('document.querySelectorAll(".people-group").length'),3);assert.equal(await ui.eval('document.querySelector(".people-overview").innerText.includes("测试")'),false);await ui.shot('overview-top')
    await ui.button('小林','.recent-people-row');await ui.value('#contact-category','classmate')
    await ui.text('已更新联系人分类')
    await ui.go('/');await ui.button('重要的人');await ui.text('同学')
    assert.ok((await r.request('owner','/people')).some((p:{user_id:string;category:string})=>p.user_id===r.accounts.friend.id&&p.category==='classmate'))
    await ui.eval('document.querySelector(".people-support").scrollIntoView({behavior:"instant",block:"center"})');await ui.shot('groups-and-support')
    await ui.click('.people-group summary');await ui.wait('document.querySelector(".people-group").open');await ui.shot('group-expanded')
    await ui.button('搜索重要的人');await ui.wait('document.activeElement.id==="relations-search"');await ui.fill('#relations-search','课后作业');assert.equal(await ui.eval('document.querySelectorAll(".recent-people-row button").length'),1);await ui.text('小林');await ui.button('清除搜索');await ui.fill('#relations-search','不存在的人');await ui.text('没有找到相关的人');await ui.button('清除搜索')
    await ui.eval('document.activeElement?.blur()');await ui.button('看看玩法');await ui.text('轻松聊一聊')
    await ui.value('#topic-room',eventIds[0])
    await ui.button('抽一张话题卡')
    const topic=await ui.eval('document.querySelector(".topic-question")?.textContent')
    await ui.button('复制话题');await ui.text('已复制话题。')
    await ui.fill('#topic-answer','我想把今天的天空拍给你看。');await ui.eval('document.activeElement?.blur()');await ui.button('发送我的回答');await ui.text('我想把今天的天空拍给你看。')
    await ui.button('换个话题');await ui.wait(`document.querySelector(".topic-question")?.textContent!==${JSON.stringify(topic)}`);await ui.shot('topic-cards');await ui.button('关闭','dialog')
    await ui.button('邀请重要的人');await ui.text('不会自动分享私人聊天');await ui.button(groupTitles[0],'dialog');await ui.text('邀请一个重要的人');assert.equal(await ui.eval('document.querySelector(".check-row input").checked'),false)
    await ui.go('/');await ui.button('重要的人');await ui.button(peopleNames[2],'.recent-people-row');await ui.text('一起聊过的事');await ui.button(groupTitles[2]);await ui.wait('document.querySelector("h1").textContent==="房间聊天"')
    await ui.go('/');await ui.button('重要的人');await ui.wait('!!document.querySelector(".people-support-list button")');await ui.click('.people-support-list button');await ui.text('我的申请');await ui.text('待处理')
    await ui.go('/');await ui.button('重要的人');await ui.wait('!!document.querySelector(".people-support-list button")')
    const viewport=await ui.eval('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')
    await ui.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:viewport.dpr,mobile:true})
    await ui.wait('innerWidth===320');assert.equal(await ui.eval('document.querySelector(".people-relations").scrollWidth<=document.querySelector(".people-relations").clientWidth+1'),true);await ui.shot('narrow-320')
    await ui.eval('(()=>{const items=[...document.querySelectorAll(".people-header *,.people-relations *")].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>({e,size:parseFloat(getComputedStyle(e).fontSize)}));items.forEach(({e,size})=>{e.style.fontSize=size*2+"px";e.style.lineHeight="1.6"})})()');assert.equal(await ui.eval('document.querySelector(".people-relations").scrollWidth<=document.querySelector(".people-relations").clientWidth+1'),true);await ui.shot('narrow-large-text')
    await ui.eval('document.querySelectorAll(".people-header *,.people-relations *").forEach(e=>{e.style.removeProperty("font-size");e.style.removeProperty("line-height")})');await ui.call('Emulation.clearDeviceMetricsOverride')
    await ui.identity(r.accounts.guest.cookie);await ui.button('重要的人');await ui.text('了解适合自己的支持');assert.equal(await ui.eval('!!document.querySelector(".people-support-list")'),false);await ui.click('.people-support-empty');await ui.text('了解专业支持');await ui.text('不会自动提交或分享');await ui.button('关闭','dialog')
    await ui.text('未分类')
    assert.deepEqual(r.errors,[]);assert.deepEqual(ui.errors,[]);assert.deepEqual(ui.failures,[])
    await writeFile(artifacts+'/results.json',JSON.stringify({threeRealConnections:true,groupSearch:true,groupExpansion:true,sharedTopicAndAnswer:true,inviteRequiresConfirmation:true,personOpensRoom:true,privateSupportOpensOriginalApplication:true,otherAccountCannotSeeSupport:true,narrowNoOverflow:true},null,2))
  }catch(error){await ui.shot('failure').catch(()=>{});await writeFile(artifacts+'/failure.txt',String(error));throw error}finally{try{await ui.eval('document.querySelectorAll(".people-header *,.people-relations *").forEach(e=>{e.style.removeProperty("font-size");e.style.removeProperty("line-height")})').catch(()=>{});await ui.call('Emulation.clearDeviceMetricsOverride').catch(()=>{});await ui.restore()}finally{try{await ui.close()}finally{await runtime?.close()}}}
})

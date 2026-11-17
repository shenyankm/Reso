import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Android} from './android'
import {startRuntime} from './runtime'
import {names,reply,retryReply,roomReply,history} from './conversation'

// Every business action uses the built React app and real HTTP/PostgreSQL/queue.
// Model and ASR transport boundaries use doubles; paid-provider acceptance is separate.
test('Android functional chains', {timeout:900000},async t=>{
  const artifacts=join('.data','e2e',new Date().toISOString().replace(/[:.]/g,'-'))
  await mkdir(artifacts,{recursive:true,mode:0o700})
  const ui=new Android(artifacts),report:{name:string;passed:boolean}[]=[]
  let runtime:Awaited<ReturnType<typeof startRuntime>>|undefined,eventId='',invite='',applicationId='',consultantId=''
  const route=()=>`/#event/${eventId}/private`
  async function step(name:string,fn:()=>Promise<void>){
    let success=false
    await t.test(name,async()=>{try{await fn();success=true;await ui.shot(String(report.length+1).padStart(2,'0'))}catch(error){await ui.shot('failure').catch(()=>{});await writeFile(join(artifacts,'failure-ui.txt'),String(await ui.eval('document.body.innerText').catch(()=>'')),{mode:0o600});throw error}finally{report.push({name,passed:success});await writeFile(join(artifacts,'results.json'),JSON.stringify(report,null,2))}})
    assert.ok(success,`Stop after failing E2E step: ${name}; see ${artifacts}`)
  }
  try{
    await ui.connect()
    runtime=await startRuntime(artifacts)
    const r=runtime
    await ui.call('Page.navigate',{url:'about:blank'})
    ui.shell('reverse','tcp:5189','tcp:'+r.webPort)
    await ui.identity()
    await step('signup, automatic private event, durable queue reply and history pagination',async()=>{
      await ui.button('登录，开始聊聊');await ui.button('创建账号','form.auth-form')
      const password=randomBytes(20).toString('hex'),email=`owner-${randomBytes(5).toString('hex')}@example.test`
      await ui.fill('input[autocomplete=name]',names.owner);await ui.fill('input[type=email]',email);await ui.fill('input[type=password]',password);await ui.click('form.auth-form > button[type=submit]')
      await ui.wait('!!document.querySelector(".composer input:not(:disabled)")')
      r.accounts.owner={id:'',email,password,cookie:await ui.cookie()};r.accounts.owner.id=(await r.request('owner','/auth/get-session')).user.id
      eventId=await ui.eval("location.hash.split('/')[1]");assert.match(eventId,/^[a-f0-9-]{36}$/)
      assert.ok(history.length>50,'The fictional dialogue must exercise message pagination')
      await r.fixture.fixtures.pool.query("INSERT INTO messages(event_id,author_id,author_name,domain,role,content) SELECT $1,CASE WHEN ordinality%2=0 THEN $2::text ELSE NULL END,CASE WHEN ordinality%2=0 THEN $3 ELSE 'Reso' END,'private',CASE WHEN ordinality%2=0 THEN 'user' ELSE 'assistant' END,content FROM unnest($4::text[]) WITH ORDINALITY AS dialogue(content,ordinality) ORDER BY ordinality",[eventId,r.accounts.owner.id,names.owner,history])
      await ui.go(route())
      await ui.fill('.composer input','我想先和妈妈商量周六能不能听完我的复习计划，不急着让她同意。');await ui.button('发送消息');await ui.text(reply)
      assert.equal(await ui.eval('document.querySelectorAll(".understanding-prompt").length'),0)
      assert.equal(await ui.eval('document.querySelectorAll(".own-message .message-reasoning").length'),0);await ui.click('.message-wrap:last-of-type .message-reasoning > summary');await ui.wait('!!document.querySelector(".message-wrap:last-of-type .message-reasoning[open]")');await ui.text('先区分原话、感受和未确定之处');assert.equal(await ui.eval('document.querySelector(".message-wrap:last-of-type .bubble").innerText'),reply);await ui.shot('reasoning-expanded');await ui.go(route());assert.equal(await ui.eval('!!document.querySelector(".message-wrap:last-of-type .message-reasoning")'),true)

      await ui.button('加载更早的消息');await ui.text(history[0]);assert.ok(await ui.eval('document.querySelectorAll(".message-wrap.own-message").length')>1);assert.equal(await ui.eval('document.querySelectorAll(".message-wrap").length'),history.length+2)
      const d=await r.request('owner',`/events/${eventId}`);assert.ok(d.messages.some((m:any)=>m.content==='我想先和妈妈商量周六能不能听完我的复习计划，不急着让她同意。'))
      const jobs=await r.fixture.fixtures.pool.query("SELECT state FROM pgboss.job WHERE data->>'eventId'=$1",[eventId]);assert.ok(jobs.rows.some(row=>row.state==='completed'))
      assert.equal(await ui.eval('!!document.querySelector(".bottom-nav")'),false)
    })
    await step('draft survives reload and stays separate between accounts; failed reply can retry',async()=>{
      await r.account('guest');consultantId=await r.expert()
      await ui.fill('.composer input','我还没想好周六该怎么开口，怕话没说完又被打断。');await ui.go(route());assert.equal(await ui.eval('document.querySelector(".composer input").value'),'我还没想好周六该怎么开口，怕话没说完又被打断。')
      await ui.button('打开账户快捷入口');await ui.wait('document.querySelector("#account-shortcuts")?.matches(":popover-open")');assert.equal(await ui.eval('!!document.querySelector("dialog")'),false);assert.equal(await ui.eval('document.querySelectorAll("#account-shortcuts button").length'),2)
      assert.equal(await ui.eval('(()=>{const m=document.querySelector("#account-shortcuts").getBoundingClientRect(),b=document.querySelector("[popovertarget=account-shortcuts]").getBoundingClientRect();return m.top>=b.bottom&&m.top-b.bottom<=10&&Math.abs(m.right-b.right)<=1&&m.left>=0&&m.bottom<=innerHeight})()'),true);await ui.shot('chat-account-shortcuts')
      ui.shell('shell','input','keyevent','111');await ui.wait('!document.querySelector("#account-shortcuts").matches(":popover-open")');await ui.button('打开账户快捷入口');ui.shell('shell','input','keyevent','4');await ui.wait('!document.querySelector("#account-shortcuts").matches(":popover-open")');assert.equal(await ui.eval('document.querySelector(".composer input").value'),'我还没想好周六该怎么开口，怕话没说完又被打断。')
      await ui.button('打开账户快捷入口');await ui.nativeTap(n=>n.class==='android.widget.TextView'&&n.text==='Reso');await ui.wait('!document.querySelector("#account-shortcuts").matches(":popover-open")')
      await ui.button('打开账户快捷入口');await ui.button('我的','#account-shortcuts');assert.equal(await ui.eval('!!document.querySelector(".app-header .more")'),false);await ui.button('Reso');assert.equal(await ui.eval('document.querySelector(".composer input").value'),'我还没想好周六该怎么开口，怕话没说完又被打断。')

      await ui.button('打开聊天工具');await ui.button('整理表达','dialog');assert.deepEqual(await ui.eval('[...document.querySelectorAll(".tool-list button span")].map(e=>e.textContent.trim())'),['整理这件事','写下我的表达','练习怎么开口']);ui.shell('shell','input','keyevent','4');await ui.wait('!document.querySelector("dialog")')
      await ui.tool('整理表达','写下我的表达');await ui.text('写下我的表达');ui.shell('shell','input','keyevent','4');await ui.wait('!!document.querySelector(".composer input")');assert.equal(await ui.eval('document.querySelector(".composer input").value'),'我还没想好周六该怎么开口，怕话没说完又被打断。');await ui.shot('draft-and-tools')
      await ui.identity(r.accounts.guest.cookie);assert.equal(await ui.eval('document.body.innerText.includes("我想先和妈妈商量周六能不能听完我的复习计划，不急着让她同意。")'),false)
      await ui.identity(r.accounts.owner.cookie,route());assert.equal(await ui.eval('document.querySelector(".composer input").value'),'我还没想好周六该怎么开口，怕话没说完又被打断。')
      r.control.model='error';await ui.button('发送消息');await ui.text('重试回复')
      r.control.model='reply';await ui.button('重试回复');await ui.wait('![...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="重试回复")')
      const d=await r.request('owner',`/events/${eventId}`);assert.equal(d.messages.at(-1).status,'complete');assert.equal(d.messages.at(-1).author_name,'Reso');assert.equal(d.messages.at(-1).content,retryReply)
    })
    await step('questionnaire saves each answer, resumes and persists a corrected discovery',async()=>{
      await ui.tool('了解自己','初步了解')
      async function answer(index:number){await ui.click('.answer-grid label:nth-of-type(4) input');await ui.idle();await ui.button(index===23?'看看结果':'下一题')}
      for(let i=0;i<3;i++)await answer(i)
      await ui.button('先不回答，继续聊聊');await ui.tool('了解自己','继续初步了解');await ui.text('4/24')
      for(let i=3;i<24;i++)await answer(i)
      await ui.fill('#finding-summary','谈到学习安排时，我希望先说完自己的计划，再听妈妈的建议。');await ui.button('确认这份理解');await ui.text('已保存你确认的理解')
      const d=await r.request('owner',`/events/${eventId}`);assert.equal(d.questionnaire.answers.length,24);assert.equal(Object.keys(d.questionnaire.scores).length,8);assert.equal(d.event.initial_summary,'谈到学习安排时，我希望先说完自己的计划，再听妈妈的建议。')
    })
    await step('five-act correction, pause/resume, story, NVC, roleplay, followup and review',async()=>{
      await ui.tool('整理表达','整理这件事');await ui.button('开始第一幕');await ui.button('我想修改');await ui.fill('#act-correction','昨晚我写完作业想休息二十分钟，妈妈一进门就说我只知道玩。');await ui.button('保存这一幕')
      await ui.button('暂停');await ui.text('已暂停');await ui.button('接着看看');await ui.button('第五幕 · 终章：我的故事');await ui.fill('#my-story','昨晚我和妈妈因为休息时间争了起来。我其实在认真补数学，也想让她听见我的安排。周六我准备先邀请她聊十分钟，先说计划，再商量完成任务后的二十分钟休息。');await ui.button('保存我的故事')
      await ui.fill('#reflection','把复习计划写下来以后，我没刚才那么乱了，但想到可能被打断还是会紧张。');await ui.fill('#next-step','周六早饭后先问妈妈愿不愿意聊十分钟，不顺利时先说明需要暂停。');await ui.button('保存回访记录');await ui.button('我已回看这条记录');await ui.text('已在')
      await ui.go(route());await ui.tool('整理表达','写下我的表达');await ui.fill('#practice-observation','我刚开始解释复习计划，妈妈就提起上次考试。');await ui.fill('#practice-need','我希望自己的安排能先被听完。');await ui.button('保存私人练习');await ui.wait('!!document.querySelector(".draft-status.is-saved")')
      await ui.go(route());await ui.tool('整理表达','练习怎么开口');await ui.fill('#practice-my_words','妈妈，周六早饭后能聊十分钟吗？我想先把这周的复习计划说完，再听你的意见。');await ui.fill('#practice-possible_reply','她可能会问计划能不能做到，这只是排练时假设的回应。');await ui.button('保存私人练习');await ui.wait('!!document.querySelector(".draft-status.is-saved")')
      const d=await r.request('owner',`/events/${eventId}`);assert.equal(d.exercise.story,'昨晚我和妈妈因为休息时间争了起来。我其实在认真补数学，也想让她听见我的安排。周六我准备先邀请她聊十分钟，先说计划，再商量完成任务后的二十分钟休息。');assert.equal(d.exercise.practice_notes.nvc.need,'我希望自己的安排能先被听完。');assert.equal(d.exercise.practice_notes.roleplay.possible_reply,'她可能会问计划能不能做到，这只是排练时假设的回应。');assert.ok(d.followups[0].reviewed_at)
    })
    await step('message-source understanding, disagreement, correction and versioned confirmation',async()=>{
      await ui.go(route());assert.equal(await ui.eval('document.querySelectorAll(".own-message .understanding-prompt").length'),0);assert.equal(await ui.eval('document.querySelectorAll(".understanding-prompt").length'),1);await ui.button('这符合你的意思吗？','.message-wrap:last-of-type');await ui.text('一起核对理解');await ui.button('我有不同理解');await ui.text('存在不同意见');await ui.button('修改这份理解');await ui.fill('textarea[id^=understanding-]','我不是不在乎成绩，而是想在说完自己的安排以后再商量怎么调整。');await ui.button('保存修正');await ui.button('认可当前理解');await ui.text('你已确认当前版本')
      const d=await r.request('owner',`/events/${eventId}`);assert.equal(d.understandings[0].provenance,'user_corrected');assert.ok(d.understandings[0].confirmations.some((c:any)=>c.user_id===r.accounts.owner.id&&c.agreed))
    })
    await step('summary error retains edits; invitation and a fixed share reach only the invited room',async()=>{
      await ui.go(route());await ui.tool('一起沟通与支持','邀请一起聊');await ui.text('未填写摘要，仍可邀请');await ui.button('整理要分享的摘要');assert.equal(await ui.eval('document.querySelector("#edit-summary").value'),'');await ui.fill('#edit-event-title','和妈妈商量学习与休息');await ui.fill('#edit-summary','我想和妈妈商量周六的复习安排，希望先轮流把话说完，再讨论休息时间。');await ui.failNext(`/api/events/${eventId}`,'PATCH');await ui.button('确认保存');await ui.text('E2E：保存暂时失败');assert.equal(await ui.eval('document.querySelectorAll("[role=alert]").length'),1);assert.equal(await ui.eval('document.querySelector("#edit-summary").value'),'我想和妈妈商量周六的复习安排，希望先轮流把话说完，再讨论休息时间。');await ui.button('确认保存');await ui.wait('!document.querySelector("dialog")')
      await ui.text('编辑要分享的摘要');assert.equal(await ui.eval('document.querySelector(".check-row input").checked'),false);await ui.shot('inline-summary');await ui.check('分享当前摘要');await ui.button('生成邀请链接');await ui.wait('!!document.querySelector("#invitation-link")');invite=new URL(await ui.eval('document.querySelector("#invitation-link").value')).hash
      await ui.failNext(`/api/invites/${invite.split('/')[1]}/details`,'GET');await ui.identity(r.accounts.guest.cookie,'/'+invite);await ui.text('有人邀请你聊一件事');await ui.text('E2E：保存暂时失败');assert.equal(await ui.eval('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("接受并加入")).disabled'),true);await ui.button('重新读取邀请信息');await ui.text(`邀请人：${names.owner}`);await ui.text(`当前成员（含发起人）：${names.owner}`);await ui.shot('invitation-identity');assert.equal(await ui.eval('document.body.innerText.includes("昨晚我和妈妈因为休息时间争了起来。我其实在认真补数学，也想让她听见我的安排。周六我准备先邀请她聊十分钟，先说计划，再商量完成任务后的二十分钟休息。")'),false);await ui.button('接受并加入');await ui.wait('document.querySelector("h1")?.textContent==="房间聊天"');await ui.wait('!!document.querySelector(".composer input:not(:disabled)")');await ui.text('我想和妈妈商量周六的复习安排，希望先轮流把话说完，再讨论休息时间。');assert.equal(await ui.eval('document.body.innerText.includes("我不是不在乎成绩，我已经在补数学了。")'),false)
      await ui.fill('.composer input','小禾，我是小雨。我可以先听你试着说一遍，但我不能替妈妈确定她会怎么回应。');await ui.button('发送消息');await ui.text(roomReply)
      const room=await r.request('guest',`/events/${eventId}?domain=room`);assert.equal(room.exercise,null);assert.equal(room.questionnaire,null);assert.equal(room.snapshots[0].content,'我想和妈妈商量周六的复习安排，希望先轮流把话说完，再讨论休息时间。')
    })
    await step('relationship search, important people, shared events, growth list and native Back',async()=>{
      await ui.identity(r.accounts.owner.cookie);await ui.fill('input[aria-label="搜索聊过的事"]','图书馆座位怎么预约');await ui.text('没有找到相关的小事');await ui.button('清除搜索');await ui.button('重要的人');await ui.click('.recent-people-row button');await ui.text('一起聊过的事');await ui.button('和妈妈商量学习与休息');assert.equal(await ui.eval('document.querySelector(".composer input").getAttribute("aria-label")'),'发送给房间成员的消息')
      await ui.fill('.composer input','小雨，等我把准备说的话讲完，你再告诉我听起来哪里不清楚。');await ui.button('打开账户快捷入口');await ui.button('我的','#account-shortcuts');await ui.button('Reso');await ui.wait('document.querySelector(".composer input")?.getAttribute("aria-label")==="发送给 Reso 的消息"');assert.equal(await ui.eval('location.hash'),route().slice(1));assert.notEqual(await ui.eval('document.querySelector(".composer input").value'),'小雨，等我把准备说的话讲完，你再告诉我听起来哪里不清楚。')
      await ui.go('/');await ui.button('我的');await ui.button('待回访');await ui.text('暂时没有待回访');await ui.button('查看全部记录');await ui.wait('!!document.querySelector(".saved-records")');await ui.text('回访记录');ui.shell('shell','input','keyevent','4');await ui.wait('document.querySelector("h1")?.textContent==="待回访"');ui.shell('shell','input','keyevent','4');await ui.wait('document.querySelector("h1")?.textContent==="我的"');await ui.button('Reso');await ui.wait('!!document.querySelector(".composer input:not(:disabled)")');await ui.shot('reso-private-from-owned-room')
    })
    await step('room perspective confirmation, stale snapshot, withdrawal and explicit re-share',async()=>{
      await ui.identity(r.accounts.guest.cookie,`/#event/${eventId}/room`);await ui.tool('房间里的沟通','双视角核对');await ui.button('写下我的感受');await ui.fill('#perspective-text','我愿意先听小禾把复习计划说完，再说我的理解；我不替她妈妈作判断。');await ui.button('保存为待核对表达');await ui.button('确认这是我的感受');await ui.text('本人已确认')
      await ui.button('Reso');await ui.wait('document.querySelector(".composer input")?.getAttribute("aria-label")==="发送给 Reso 的消息"');const guestPrivate=await ui.eval('location.hash');assert.notEqual(guestPrivate,`#event/${eventId}/room`);assert.notEqual(guestPrivate,`#event/${eventId}/private`);await ui.fill('.composer input','我想陪朋友练习，也担心自己一着急就替她下结论。')
      await ui.go(`/#event/${eventId}/room`);await ui.fill('.composer input','我先听你说完。你希望我帮你留意语气，还是只核对有没有讲清楚？');await ui.button('打开账户快捷入口');await ui.button('我的','#account-shortcuts');await ui.button('Reso');assert.equal(await ui.eval('location.hash'),guestPrivate);assert.equal(await ui.eval('document.querySelector(".composer input").getAttribute("aria-label")'),'发送给 Reso 的消息');assert.equal(await ui.eval('document.querySelector(".composer input").value'),'我想陪朋友练习，也担心自己一着急就替她下结论。');await ui.shot('reso-private-from-invited-room');await ui.go(`/#event/${eventId}/room`);assert.equal(await ui.eval('document.querySelector(".composer input").value'),'我先听你说完。你希望我帮你留意语气，还是只核对有没有讲清楚？')
      await ui.identity(r.accounts.owner.cookie,route());await ui.click('.event-context-toggle');await ui.button('修改事件名称与摘要');await ui.fill('#edit-summary','我准备先邀请妈妈周六聊十分钟，先说明复习计划，再商量完成任务后的二十分钟休息。');await ui.button('确认保存');await ui.wait('!document.querySelector("dialog")')
      assert.equal((await r.request('guest',`/events/${eventId}?domain=room`)).snapshots[0].content,'我想和妈妈商量周六的复习安排，希望先轮流把话说完，再讨论休息时间。')
      await ui.click('.event-context-toggle');await ui.button('邀请与分享管理');await ui.button('撤回摘要');await ui.idle();assert.equal((await r.request('guest',`/events/${eventId}?domain=room`)).snapshots.length,0)
      await ui.button('分享当前摘要');await ui.text('确认摘要分享');await ui.button('确认分享');await ui.wait('!document.querySelector("dialog")');assert.equal((await r.request('guest',`/events/${eventId}?domain=room`)).snapshots[0].content,'我准备先邀请妈妈周六聊十分钟，先说明复习计划，再商量完成任务后的二十分钟休息。')
    })
    await step('support application, expert proposal, client response, notes and recipient withdrawal',async()=>{
      await ui.go(route());await ui.tool('一起沟通与支持','真人支持');await ui.button('了解并申请');await ui.check('分享当前摘要');await ui.button('确认提交申请');await ui.text('待处理')
      applicationId=(await r.request('owner',`/events/${eventId}`)).applications[0].id
      await ui.identity(r.accounts.expert.cookie);await ui.button('我的');await ui.button('专业支持工作台');await ui.button('接单')
      const future=new Date(Date.now()+86400000),local=new Date(future.getTime()-future.getTimezoneOffset()*60000).toISOString().slice(0,16)
      await ui.value('input[type=datetime-local]',local);await ui.button('发出时间提议');await ui.text('待申请人确认')
      await ui.identity(r.accounts.owner.cookie,route());await ui.click('.event-context-toggle');await ui.button('咨询申请状态');await ui.button('需要换个时间');await ui.text('已接单')
      await ui.identity(r.accounts.expert.cookie);await ui.button('我的');await ui.button('专业支持工作台');await ui.value('input[type=datetime-local]',local);await ui.button('发出时间提议')
      await ui.identity(r.accounts.owner.cookie,route());await ui.click('.event-context-toggle');await ui.button('咨询申请状态');await ui.button('确认这个时间');await ui.text('双方已确认时间')
      await ui.identity(r.accounts.expert.cookie);await ui.button('我的');await ui.button('专业支持工作台');await ui.button('填写纪要');await ui.fill('textarea[id^=note-]','这次练习先区分了原话、自己的理解和担心的回应。下次由小禾决定是否邀请妈妈沟通，不预设对方一定会同意。');await ui.check('向申请人开放这份纪要');await ui.button('保存纪要')
      await ui.identity(r.accounts.owner.cookie,route());await ui.click('.event-context-toggle');await ui.button('咨询申请状态');await ui.text('这次练习先区分了原话、自己的理解和担心的回应。下次由小禾决定是否邀请妈妈沟通，不预设对方一定会同意。');await ui.value('select[id^=note-recipient-]',r.accounts.guest.id);await ui.check('我同意向所选成员分享上方这份纪要');await ui.button('确认分享纪要');await ui.idle()
      await ui.identity(r.accounts.guest.cookie,`/#event/${eventId}/room`);await ui.text('这次练习先区分了原话、自己的理解和担心的回应。下次由小禾决定是否邀请妈妈沟通，不预设对方一定会同意。');assert.equal(await ui.eval('document.body.innerText.includes("昨晚我和妈妈因为休息时间争了起来。我其实在认真补数学，也想让她听见我的安排。周六我准备先邀请她聊十分钟，先说计划，再商量完成任务后的二十分钟休息。")'),false)
      await ui.identity(r.accounts.owner.cookie,route());await ui.click('.event-context-toggle');await ui.button('咨询申请状态');await ui.button('撤回纪要');await ui.idle();assert.equal((await r.request('guest',`/events/${eventId}?domain=room`)).shared_notes.length,0)
      // Advance only this fixture's appointment clock; production still rejects early completion.
      await r.fixture.fixtures.pool.query("UPDATE applications SET scheduled_at=now()-interval '1 minute' WHERE id=$1",[applicationId])
      await ui.identity(r.accounts.expert.cookie);await ui.button('我的');await ui.button('专业支持工作台');await ui.button('标记完成');await ui.text('已完成')
      assert.equal((await r.request('owner',`/events/${eventId}`)).applications[0].status,'completed')
    })
    await step('native recorder and PCM upload retain failed audio, retry into draft and never auto-send',async()=>{
      process.env.DOUBAO_ASR_API_KEY='e2e-transport-double'
      try{
        await ui.identity(r.accounts.owner.cookie,route());await ui.fill('.composer input','我还想补一句：如果当时太着急，我想先暂停一下。');const before=(await r.request('owner',`/events/${eventId}`)).messages.length
        await ui.eval(`navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext(),destination=context.createMediaStreamDestination(),oscillator=context.createOscillator();await context.resume();oscillator.connect(destination);oscillator.start();window.__e2eAudio=context;return destination.stream}`)
        await ui.button('语音输入');await ui.button('开始录音');await ui.text('结束录音');await new Promise(resolve=>setTimeout(resolve,650));await ui.button('结束录音（最长60秒）');await ui.text('录音已就绪');await ui.eval('window.__e2eAudio.close()')
        ui.expectedFailures.set('/api/asr',1);await ui.button('转成可编辑文字');await ui.text('E2E：语音授权未通过');await ui.text('录音已就绪');assert.ok(r.control.asrBytes>=320)
        r.control.asr='text';await ui.button('转成可编辑文字');await ui.wait('!document.querySelector("dialog")');const draft=await ui.eval('document.querySelector(".composer input").value');assert.ok(draft.includes('我还想补一句：如果当时太着急，我想先暂停一下。')&&draft.includes('等我把这周的复习计划说完，再一起商量休息时间。'));assert.equal((await r.request('owner',`/events/${eventId}`)).messages.length,before)
      }finally{delete process.env.DOUBAO_ASR_API_KEY}
    })
    await step('safety bypasses model and pauses exercise; member revocation removes access',async()=>{
      await ui.identity(r.accounts.owner.cookie,route());const calls=r.control.calls;await ui.fill('.composer input','我不想活了');await ui.button('发送消息');await ui.text('Reso 无法提供实时紧急救助');assert.equal(r.control.calls,calls);assert.equal((await r.request('owner',`/events/${eventId}`)).exercise.paused,true)
      await ui.click('.event-context-toggle');await ui.button('邀请与分享管理');await ui.button('移出房间');await ui.idle();await assert.rejects(r.request('guest',`/events/${eventId}?domain=room`),/403/)
    })
    await step('private export reaches an Android save surface',async()=>{
      await ui.go(route());await ui.fill('.composer input','这段话我还没想好要不要保存或分享。');await ui.click('.event-context-toggle');await ui.button('这件事的记录');await ui.button('导出记录')
      const saved=await ui.saveExport('reso-e2e-'+randomBytes(8).toString('hex')+'.json')
      assert.equal(saved.event.id,eventId);assert.equal(saved.exercise.story,'昨晚我和妈妈因为休息时间争了起来。我其实在认真补数学，也想让她听见我的安排。周六我准备先邀请她聊十分钟，先说计划，再商量完成任务后的二十分钟休息。');assert.ok(saved.private_messages.some((m:any)=>m.content==='我想先和妈妈商量周六能不能听完我的复习计划，不急着让她同意。'));assert.ok(saved.room_messages.length);assert.ok(saved.followups[0].reviewed_at);assert.ok(saved.consultation_notes.length);assert.ok(!JSON.stringify(saved).includes('这段话我还没想好要不要保存或分享。'))

    })
    await step('event deletion cascades; explicit logout clears only this fixture user drafts',async()=>{
      await ui.go(route());await ui.click('.event-context-toggle');await ui.button('删除“和妈妈商量学习与休息”');await ui.button('确认删除这件事');await ui.text('聊过的事');assert.equal((await r.fixture.fixtures.pool.query('SELECT count(*) FROM events WHERE id=$1',[eventId])).rows[0].count,'0')
      await ui.button('Reso');await ui.wait('!!document.querySelector(".composer input:not(:disabled)")');await ui.fill('.composer input','先把我的计划写完，晚一点再决定要不要发出去。');await ui.button('打开账户快捷入口');await ui.button('我的','#account-shortcuts');await ui.button('退出账号');await ui.text('退出并清理草稿');await ui.button('返回当前页面');await ui.button('Reso');assert.equal(await ui.eval('document.querySelector(".composer input").value'),'先把我的计划写完，晚一点再决定要不要发出去。');await ui.button('打开账户快捷入口');await ui.button('我的','#account-shortcuts');await ui.button('退出账号');await ui.button('退出并清理草稿');await ui.text('登录，开始聊聊')
      assert.equal(await ui.eval(`Object.keys(localStorage).some(k=>k.startsWith('reso:draft:'+${JSON.stringify(r.accounts.owner.id)}+':'))`),false)
    })
    await step('login error retry and expired-session return clear only the fixture account drafts',async()=>{
      await ui.button('登录，开始聊聊');await ui.fill('input[type=email]',r.accounts.owner.email);await ui.fill('input[type=password]','wrong-but-long-enough');await ui.click('form.auth-form > button[type=submit]');await ui.text('邮箱或密码不正确');await ui.fill('input[type=password]',r.accounts.owner.password);await ui.click('form.auth-form > button[type=submit]');await ui.wait('!!document.querySelector(".mvp-relations")');await ui.click('.saved-event');await ui.fill('.composer input','这句话还没发出，我想先确认妈妈有没有空听我讲。')
      await r.fixture.fixtures.pool.query('UPDATE session SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1',[r.accounts.owner.id]);ui.shell('shell','input','keyevent','3');await ui.wait('document.hidden');ui.shell('shell','am','start','-n','app.reso.local/.MainActivity');await ui.wait("document.body.innerText.includes('登录，开始聊聊')",20000);assert.equal(await ui.eval(`Object.keys(localStorage).some(k=>k.startsWith('reso:draft:'+${JSON.stringify(r.accounts.owner.id)}+':'))`),false)
    })
    assert.deepEqual(r.errors,[],'Unexpected server errors')
    assert.deepEqual(ui.failures,[],'Unexpected HTTP server failures')
    assert.deepEqual(ui.errors,[],'Unexpected WebView runtime errors')
  }finally{
    if(runtime)await writeFile(join(artifacts,'server-errors.json'),JSON.stringify(runtime.errors,null,2));await writeFile(join(artifacts,'http-failures.json'),JSON.stringify(ui.failures,null,2))
    try{await ui.restore()}finally{try{await ui.close()}finally{await runtime?.close()}}
    console.log('E2E artifacts:',artifacts)
  }
})

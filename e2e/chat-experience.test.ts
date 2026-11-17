import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Android} from './android'
import {startRuntime} from './runtime'
import {deepseekModel} from '../server/agent'
import type {Model} from '../server/agent'
import {isolatedM1Target} from '../scripts/verify-m1'

const key=process.env.DEEPSEEK_API_KEY,modelName=process.env.DEEPSEEK_MODEL
const finalReply='忙了两晚还没收到回应，确实容易越看越没底。先把这点不踏实说出来就好，不急着给自己下结论，也不用现在决定要不要改。'
const summary='先接住你等反馈时的不踏实，群里还没回复不等于否定你的图。'
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

async function fixture(live:boolean,enlarged=false){
  await isolatedM1Target()
  const artifacts=join('.data','chat-experience',(live?'live-':'app-')+new Date().toISOString().replace(/[:.]/g,'-'))
  await mkdir(artifacts,{recursive:true,mode:0o700})
  const ui=new Android(artifacts),control={fail:false}
  const original={font:ui.shell('shell','settings','get','system','font_scale'),night:ui.shell('shell','cmd','uimode','night'),reverse:ui.shell('reverse','--list').split('\n').find(line=>line.includes('tcp:5173 '))?.trim().split(/\s+/).at(-1)}
  let runtime:Awaited<ReturnType<typeof startRuntime>>|undefined
  const model:Model=live?async(prompt,json,signal)=>{
    assert(key,'Live model credentials required');process.env.DEEPSEEK_API_KEY=key
    if(modelName)process.env.DEEPSEEK_MODEL=modelName
    return deepseekModel(prompt,json,signal)
  }:async(_prompt,json)=>{
    if(control.fail)throw Error('SYNTHETIC_PROVIDER_UNAVAILABLE')
    await wait(2500)
    return json?JSON.stringify({intent:'回应等待反馈的心情',strategy:'listen',evidence_ids:[],uncertainty:'对方还没回复，不推测其动机',needs_human:false,reply:finalReply,reply_summary:summary}):finalReply
  }
  try{
    runtime=await startRuntime(artifacts,model,live)
    ui.shell('reverse','tcp:5173','tcp:'+runtime.webPort)
    if(enlarged){ui.shell('shell','settings','put','system','font_scale','1.3');ui.shell('shell','cmd','uimode','night','yes');await wait(800)}
    ui.shell('shell','am','force-stop','app.reso.local');ui.shell('shell','am','start','-n','app.reso.local/.MainActivity')
    await wait(1500);await ui.connect()
    ui.shell('reverse','tcp:5189','tcp:'+runtime.webPort)
    await runtime.account('owner')
    const event=await runtime.request('owner','/events',{title:live?'等小组的反馈，先聊一会儿':'等反馈时，我想先说说'})
    const route=`/#event/${event.id}/private`
    await ui.identity(runtime.accounts.owner.cookie,route)
    return{ui,artifacts,control,runtime,event,route,original}
  }catch(error){
    try{await ui.restore()}finally{await ui.close();await runtime?.close()}
    if(original.reverse)ui.shell('reverse','tcp:5173',original.reverse);else ui.shell('reverse','--remove','tcp:5173')
    throw error
  }
}

type Fixture=Awaited<ReturnType<typeof fixture>>
async function close(f:Fixture){
  try{
    await f.ui.call('Emulation.setEmulatedMedia',{features:[]})
    await f.ui.call('Network.setBlockedURLs',{urls:[]})
    await f.ui.restore()
  }finally{
    try{await f.ui.close()}finally{
      await f.runtime.close()
      if(f.original.reverse)f.ui.shell('reverse','tcp:5173',f.original.reverse);else f.ui.shell('reverse','--remove','tcp:5173')
      f.ui.shell('shell','settings','put','system','font_scale',f.original.font)
      f.ui.shell('shell','cmd','uimode','night',f.original.night.includes('yes')?'yes':f.original.night.includes('auto')?'auto':'no')
    }
  }
}

async function observe(ui:Android){
  await ui.eval(`(()=>{
    window.__chatObserver?.disconnect();window.__chatSamples=[];const start=performance.now();let previous='';
    const sample=()=>{const p=document.querySelector('.reply-progress'),r=document.querySelector('.message-wrap:last-of-type .progressive-reply'),text=r?.querySelector('.reply-visible')?.textContent||'';const item={ms:Math.round(performance.now()-start),phase:p?.dataset.phase||null,text,revealing:r?.dataset.revealing==='true'};const signature=JSON.stringify([item.phase,item.text,item.revealing]);if(signature!==previous&&window.__chatSamples.length<500){window.__chatSamples.push(item);previous=signature}};
    window.__chatObserver=new MutationObserver(sample);window.__chatObserver.observe(document.querySelector('.conversation'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-phase','data-revealing']});sample();
  })()`)
}

async function send(f:Fixture,text:string){
  await observe(f.ui)
  await f.ui.fill('.composer input',text);await f.ui.button('发送消息')
  const shot=Date.now().toString(36)
  if(await f.ui.eval('!!document.querySelector(".reply-progress")'))await f.ui.shot('pending-'+shot)
  await f.ui.wait(`(()=>{if(document.querySelector('.message-wrap:last-of-type button')?.textContent.includes('重试回复'))throw Error('Provider reply failed');return !!document.querySelector('.message-wrap:last-of-type .progressive-reply')})()`,150000)
  if(await f.ui.eval('document.querySelector(".message-wrap:last-of-type .progressive-reply").dataset.revealing==="true"'))await f.ui.shot('partial-'+shot)
  await f.ui.wait(`(()=>{if(document.querySelector('.message-wrap:last-of-type button')?.textContent.includes('重试回复'))throw Error('Provider reply failed');return document.querySelector('.message-wrap:last-of-type .progressive-reply')?.dataset.revealing==='false'})()`,150000)
  const samples=await f.ui.eval('window.__chatSamples') as {ms:number;phase:string|null;text:string;revealing:boolean}[]
  const detail=await f.runtime.request('owner',`/events/${f.event.id}`),message=detail.messages.at(-1)
  assert.equal(await f.ui.eval('document.querySelector(".message-wrap:last-of-type .reply-visible").textContent'),message.content)
  assert(message.content.length>0&&message.content.length<=180)
  assert(message.reply_summary.length>0&&message.reply_summary.length<=120)
  assert.equal('reasoning_content' in message,false)
  return{samples,reply:message.content as string,summary:message.reply_summary as string}
}

test('Android shows real work phases, gradual safe replies and per-turn summaries with recovery',{skip:!process.env.RESO_CHAT_APP,timeout:180000},async t=>{
  const f=await fixture(false),evidence:Record<string,unknown>={}
  const check=async(name:string,run:()=>Promise<void>)=>{let failure:unknown;await t.test(name,async()=>{try{await run()}catch(error){failure=error;throw error}});if(failure)throw failure}
  try{
    await check('native App displays multiple prefixes, a collapsed summary and complete history after reload',async()=>{
      const result=await send(f,'小组作业的图我画了两晚，发群里还没有人回。我有点没底，先别给建议，我想说说。')
      assert(result.samples.some(s=>s.phase==='composing'))
      const prefixes=result.samples.filter(s=>s.revealing&&s.text)
      assert(prefixes.length>=3);assert(prefixes.every(s=>finalReply.startsWith(s.text)))
      assert(prefixes.at(-1)!.ms-prefixes[0].ms>=300)
      assert.equal(await f.ui.eval('document.querySelector(".message-wrap:last-of-type .message-reasoning").open'),false)
      await f.ui.click('.message-wrap:last-of-type .message-reasoning > summary');await f.ui.text(summary)
      await f.ui.shot('summary-expanded')
      evidence.normal=result
      await f.ui.go(f.route)
      assert.equal(await f.ui.eval('document.querySelector(".message-wrap:last-of-type .progressive-reply").dataset.revealing'),'false')
      assert.equal(await f.ui.eval('document.querySelector(".message-wrap:last-of-type .message-reasoning").open'),false)
    })
    await check('reduced motion displays the complete reply without typing',async()=>{
      await f.ui.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
      const result=await send(f,'他们可能只是还没看群，我不是说他们故意不理我。让我先缓一会儿。')
      assert(!result.samples.some(s=>s.revealing))
      await f.ui.click('.message-wrap:last-of-type .message-reasoning > summary')
      assert.equal(await f.ui.eval('document.documentElement.scrollWidth>innerWidth'),false)
      await f.ui.shot('reduced-motion')
      evidence.reduced_motion=result
      await f.ui.call('Emulation.setEmulatedMedia',{features:[]})
    })
    await check('an interrupted event stream falls back to scoped polling without a stuck thinking state',async()=>{
      await f.ui.call('Network.setBlockedURLs',{urls:['*/api/stream']});await f.ui.go(f.route)
      const [result]=await Promise.all([send(f,'我主要怕自己忙了两晚上，结果图还是不能用。先别让我做练习。'),(async()=>{
        await f.ui.wait('!!document.querySelector(".reply-progress")')
        await f.ui.failNext('/api/events','GET')
        await f.ui.wait('document.querySelector(".reply-progress")?.dataset.phase==="reconnecting"')
      })()])
      assert(result.samples.some(s=>s.phase==='pending'||s.phase==='composing'))
      assert.equal(await f.ui.eval('!!document.querySelector(".reply-progress")'),false)
      await f.ui.shot('polling-recovered');evidence.polling=result
      await f.ui.call('Network.setBlockedURLs',{urls:[]});await f.ui.go(f.route)
    })
    await check('failed generation stops its status, retains the user message and retries one visible reply',async()=>{
      f.control.fail=true
      await f.ui.fill('.composer input','这句话我想换个说法，先不急着给建议。');await f.ui.button('发送消息')
      await f.ui.wait('!![...document.querySelectorAll(".message-wrap:last-of-type button")].find(b=>b.textContent.includes("重试回复"))')
      assert.equal(await f.ui.eval('!!document.querySelector(".reply-progress")'),false)
      const before=await f.runtime.request('owner',`/events/${f.event.id}`),source=before.messages.at(-1).in_reply_to
      f.control.fail=false
      await f.ui.button('重试回复')
      await f.ui.wait('document.querySelector(".message-wrap:last-of-type .progressive-reply")?.dataset.revealing==="false"',15000)
      const after=await f.runtime.request('owner',`/events/${f.event.id}`)
      assert.equal(after.messages.filter((m:{in_reply_to:string})=>m.in_reply_to===source).length,1)
      assert.ok(after.messages.at(-1).reply_summary)
      await f.ui.shot('retry-complete');evidence.retry=true
    })
    await check('fixed safety guidance appears immediately with an honest summary',async()=>{
      const result=await send(f,'我不想活了')
      assert(!result.samples.some(s=>s.revealing))
      assert.ok(result.summary.includes('优先关注安全'))
      assert.equal((await f.runtime.request('owner',`/events/${f.event.id}`)).messages.at(-1).card_type,'safety')
      evidence.safety=result
    })
    assert.deepEqual(f.runtime.errors,[]);assert.deepEqual(f.ui.errors,[]);assert.deepEqual(f.ui.failures,[])
    await writeFile(join(f.artifacts,'results.json'),JSON.stringify(evidence,null,2),{mode:0o600})
  }catch(error){await f.ui.shot('failure').catch(()=>{});await writeFile(join(f.artifacts,'failure-tree.json'),JSON.stringify(await f.ui.nativeTree().catch(()=>[])));await writeFile(join(f.artifacts,'failure.txt'),String(error));throw error}
  finally{await close(f);console.log('App evidence:',f.artifacts)}
})

test('Android enlarged text and night mode keep the actual visible WebView readable',{skip:!process.env.RESO_CHAT_APP,timeout:90000},async()=>{
  // System configuration can recreate Activity; attach only after the new visible WebView starts.
  const f=await fixture(false,true)
  try{
    const result=await send(f,'我只是想先把这件事说清楚，不用急着帮我想办法。')
    await f.ui.click('.message-wrap:last-of-type .message-reasoning > summary')
    assert.equal(await f.ui.eval('document.documentElement.scrollWidth>innerWidth'),false)
    await f.ui.shot('large-text-night')
    const tree=await f.ui.nativeTree();assert.ok(tree.some(n=>n.text?.includes('思考摘要')),'The screenshot and DOM must refer to the same visible native surface')
    await writeFile(join(f.artifacts,'results.json'),JSON.stringify({font_scale:1.3,night_mode:true,...result},null,2),{mode:0o600})
  }finally{await close(f);console.log('Large-text App evidence:',f.artifacts)}
})

test('Android real DeepSeek conversations stay short and carry public summaries',{skip:!process.env.RESO_CHAT_LIVE,timeout:300000},async()=>{
  const f=await fixture(true),results=[]
  try{
    for(const [i,text] of [
      '小组作业的图我画了两晚，发群里好久没人回。我有点没底，今天只想吐槽一下，先别给建议。',
      '我不是觉得他们故意不理我，只是怕白忙了。现在帮我想一句明天发群里的话，提醒大家把要改的位置圈出来，短一点，随意一点。',
      '先这样，我要去睡觉了，今天不改图，也不用再给我安排下一步。',
    ].entries()){
      const result=await send(f,text);results.push({message:text,...result})
      if(i===0){assert(result.samples.some(s=>s.phase==='understanding'));assert(result.samples.filter(s=>s.revealing&&s.text).length>=3)}
      if(i===2){assert(result.reply.length<=80);assert.doesNotMatch(result.reply,/[?？]/)}
      await f.ui.click('.message-wrap:last-of-type .message-reasoning > summary');await f.ui.shot('live-turn-'+(i+1))
    }
    assert.deepEqual(f.runtime.errors,[]);assert.deepEqual(f.ui.errors,[]);assert.deepEqual(f.ui.failures,[])
    await writeFile(join(f.artifacts,'results.json'),JSON.stringify({provider:'DeepSeek',synthetic_dialogue:true,turns:results},null,2),{mode:0o600})
  }catch(error){await f.ui.shot('failure').catch(()=>{});await writeFile(join(f.artifacts,'failure-tree.json'),JSON.stringify(await f.ui.nativeTree().catch(()=>[])));await writeFile(join(f.artifacts,'failure.txt'),String(error));throw error}
  finally{await close(f);delete process.env.DEEPSEEK_API_KEY;console.log('Live App evidence:',f.artifacts)}
})

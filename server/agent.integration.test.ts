import {withObservationFixture} from './test-agent'
const processReply=(...args:Parameters<typeof processProductionReply>)=>processProductionReply(args[0],args[1],args[2],args[3]?withObservationFixture(args[3]):undefined,args[4])
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {createTestDatabase} from './test-database'
import {createApp} from './app'
import {processReply as processProductionReply} from './worker'
import {createAgentTools} from './agent-tools'
import {loadAgentContext} from './agent-context'
import type {AgentCheckpoint,Model} from './agent'
import {turnAssessmentPromptTag} from './agent'
import {turnAssessmentSchema} from './agent-policy'
import {loadAgentSessionState} from './agent-state'
import {methodOfferFeature} from '../shared/capabilities'

const skip=!process.env.DATABASE_URL
let nextIp=1
async function scenario(){
  const fixture=await createTestDatabase(),service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
  const call=(cookie:string,method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:string,payload?:unknown)=>service.app.inject({remoteAddress:`127.9.0.${nextIp++}`,method,url,headers:{origin:'http://localhost:5173',cookie,'x-reso-features':methodOfferFeature,...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{payload:JSON.stringify(payload)})})
  async function account(name:string){const r=await call('','POST','/api/auth/sign-up/email',{name,email:name+'@agent.test',password:randomBytes(20).toString('hex')});assert.equal(r.statusCode,200);const raw=r.headers['set-cookie'];return{id:r.json().user.id,cookie:(Array.isArray(raw)?raw:[raw]).map(c=>String(c).split(';')[0]).join('; ')}}
  try{
    const owner=await account('owner'),guest=await account('guest'),event=(await call(owner.cookie,'POST','/api/events',{title:'Agent integration'})).json()
    const job={eventId:event.id,actorId:owner.id,domain:'private' as const,methodOffers:true}
    async function send(content:string){const r=await call(owner.cookie,'POST',`/api/events/${event.id}/messages`,{content,domain:'private',clientId:randomUUID()});assert.equal(r.statusCode,200);return r.json()}
    async function detail(){const r=await call(owner.cookie,'GET',`/api/events/${event.id}`);assert.equal(r.statusCode,200,r.body);return r.json()}
    return{fixture,service,owner,guest,event,job,call,send,detail,close:async()=>{await service.app.close();await fixture.cleanup()}}
  }catch(e){await service.app.close();await fixture.cleanup();throw e}
}
const plan=(ids:string[],extra:Record<string,unknown>={})=>JSON.stringify({intent:'整理私人记录',strategy:'listen',evidence_ids:ids,uncertainty:'由本人核对',needs_human:false,...extra})

test('reply progress is current and scoped, summaries persist, and unvalidated text is never published',{skip},async()=>{
  const s=await scenario(),phases:string[]=[]
  try{
    const source=await s.send('我今天有点委屈，想先说说，不用给建议。')
    const notify=async(eventId:string,domain:'private'|'room')=>{
      const d=await s.detail()
      if(d.reply_progress){
        assert.equal(d.reply_progress.message_id,String(source.id))
        if(phases.at(-1)!==d.reply_progress.phase)phases.push(d.reply_progress.phase)
        assert.equal(d.messages.at(-1).role,'user')
      }
      assert.ok(!JSON.stringify(d).includes('RAW_PRIVATE_REASONING'))
      assert.equal((await s.call(s.guest.cookie,'GET',`/api/events/${s.event.id}`)).statusCode,403)
      await s.service.notify(eventId,domain)
    }
    let rewrites=0
    await processReply(s.service.database,s.job,notify,async(_prompt,json)=>json?plan([String(source.id)],{reply:'重复解释。'.repeat(60),reply_summary:'先回应你说出的委屈，暂不推动建议。',reasoning_content:'RAW_PRIVATE_REASONING'}):(rewrites++,'可以，先把让你委屈的那一刻说给我听，不急着想办法。'))
    assert.equal(rewrites,1)
    assert.deepEqual(phases,['understanding','composing','reviewing'])
    const complete=await s.detail(),message=complete.messages.at(-1)
    assert.equal(complete.reply_state,'complete');assert.equal(complete.reply_progress,null)
    assert.ok(message.content.length<=180);assert.equal(message.reply_summary,'先回应你说出的委屈，暂不推动建议。')
    assert.equal('reasoning_content' in message,false)
    const page=(await s.call(s.owner.cookie,'GET',`/api/events/${s.event.id}/messages`)).json()
    assert.equal(page.messages.at(-1).reply_summary,message.reply_summary)
    const checkpoint=(await s.fixture.fixtures.pool.query('SELECT checkpoint FROM agent_runs WHERE response_message_id=$1',[message.id])).rows[0].checkpoint
    assert.equal('reasoning_content' in checkpoint,false)
    await s.fixture.fixtures.pool.query('UPDATE agent_runs SET checkpoint=$1 WHERE response_message_id=$2',[{phase:'complete',reasoning_content:'RAW_PRIVATE_REASONING'},message.id])
    const historical=(await s.detail()).messages.at(-1)
    assert.ok(historical.reply_summary.includes('历史回复'));assert.ok(!JSON.stringify(historical).includes('RAW_PRIVATE_REASONING'))
    const next=await s.send('我想补充一点新的情况。')
    await s.fixture.fixtures.pool.query("INSERT INTO agent_runs(id,event_id,domain,trigger_message_id,context_version,model,status,checkpoint) VALUES($1,$2,'private',$3,0,'synthetic','running','{\"display_phase\":\"checking\"}')",[randomUUID(),s.event.id,next.id])
    assert.equal((await s.detail()).reply_progress,null,'A run with an old input version cannot masquerade as current work')
  }finally{await s.close()}
})

test('scoped tools retrieve old evidence, enforce domain and actor access, and reject stale snapshots',{skip},async()=>{
  const s=await scenario()
  try{
    const old=await s.send('PRIVATE_OLD_SOURCE 原话：我想先说完')
    await s.fixture.fixtures.pool.query("INSERT INTO messages(event_id,author_name,domain,role,content) SELECT $1,'Reso','private','assistant','later '||g FROM generate_series(1,65) g",[s.event.id])
    await s.send('请找我以前关于说完的那句话')
    const loaded=await loadAgentContext(s.service.database,s.job);assert.ok(loaded);assert.equal(loaded.context.includes('PRIVATE_OLD_SOURCE'),false)
    const tools=createAgentTools(s.service.database,s.job,loaded.version),found=await tools({name:'search_history',query:'PRIVATE_OLD_SOURCE'})
    assert.ok(found.user_source_ids.includes(String(old.id)))
    await s.fixture.fixtures.pool.query("INSERT INTO members(event_id,user_id,active) VALUES($1,$2,true)",[s.event.id,s.guest.id])
    const room=createAgentTools(s.service.database,{...s.job,actorId:s.guest.id,domain:'room'},0)
    assert.deepEqual((await room({name:'search_history',query:'PRIVATE_OLD_SOURCE'})).result,[])
    assert.deepEqual((await room({name:'read_practice',kind:'story'})).result,{error:'TOOL_NOT_ALLOWED'})
    await assert.rejects(createAgentTools(s.service.database,{...s.job,actorId:s.guest.id},loaded.version)({name:'search_history',query:'PRIVATE'}),/私人/)
    await s.fixture.fixtures.pool.query('UPDATE events SET private_version=private_version+1 WHERE id=$1',[s.event.id]);await assert.rejects(tools({name:'practice_guide',kind:'nvc'}),/CONTEXT_CHANGED/)
    await s.fixture.fixtures.pool.query('UPDATE members SET active=false WHERE event_id=$1',[s.event.id]);await assert.rejects(room({name:'search_history',query:'a'}),/撤回/)
  }finally{await s.close()}
})

test('agent drafts require owner confirmation, preserve sharing, apply exactly once, and expire after corrections',{skip},async()=>{
  const s=await scenario()
  try{
    const source=await s.send('请帮我整理一份私人摘要'),proposal={kind:'summary',value:{summary:'待核对的摘要'},source_ids:[String(source.id)]}
    const model:Model=async(_p,json)=>json?plan([String(source.id)],{proposals:[proposal]}):'我整理了一份待核对的摘要，还没有保存或分享。'
    await processReply(s.service.database,s.job,s.service.notify,model)
    let d=await s.detail();assert.equal(d.event.summary,'');const action=d.messages.at(-1).agent_actions[0];assert.equal(action.status,'pending');assert.equal(action.sources[0].content,source.content)
    assert.equal((await s.call(s.guest.cookie,'POST',`/api/events/${s.event.id}/agent-actions/${action.id}`,{decision:'apply'})).statusCode,403)
    const apply=()=>s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/agent-actions/${action.id}`,{decision:'apply',value:{summary:'本人修改后的摘要'}})
    assert.equal((await apply()).statusCode,200);d=await s.detail();assert.equal(d.event.summary,'本人修改后的摘要');const version=d.event.summary_version
    assert.equal((await apply()).statusCode,200);assert.equal((await s.detail()).event.summary_version,version)
    assert.equal((await s.fixture.fixtures.pool.query('SELECT count(*) FROM share_grants WHERE event_id=$1',[s.event.id])).rows[0].count,'0')
    const exported=(await s.call(s.owner.cookie,'GET',`/api/events/${s.event.id}/export`)).json();assert.equal(exported.agent_actions.length,1);assert.equal(exported.agent_actions[0].proposal.value.summary,'本人修改后的摘要')
    const next=await s.send('请再整理一次摘要')
    await processReply(s.service.database,s.job,s.service.notify,async(_p,json)=>json?plan([String(next.id)],{proposals:[{...proposal,source_ids:[String(next.id)]}]}):'新的建议待你确认。')
    const stale=(await s.detail()).messages.at(-1).agent_actions[0];await s.send('纠正一下，不要按之前的理解保存')
    assert.equal((await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/agent-actions/${stale.id}`,{decision:'apply'})).statusCode,409)
    assert.equal((await s.detail()).messages.find((m:any)=>m.agent_actions?.some((a:any)=>a.id===stale.id)).agent_actions[0].status,'stale')
    assert.equal((await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/agent-actions/${stale.id}`,{decision:'dismiss'})).statusCode,200)
    assert.equal((await s.detail()).event.summary,'本人修改后的摘要')
  }finally{await s.close()}
})

test('worker checkpoints resume tools after provider failure; changed context replans and stale publication is blocked',{skip},async()=>{
  const s=await scenario()
  try{
    const source=await s.send('请帮我按表达步骤练习'),id=String(source.id);let jsonCalls=0
    await assert.rejects(processReply(s.service.database,s.job,s.service.notify,async(_p,json)=>{if(!json)throw Error('MODEL_HTTP_503');return plan([id],{tools:jsonCalls++?[]:[{name:'practice_guide',kind:'nvc'}]})}),/MODEL_HTTP_503/)
    const first=(await s.fixture.fixtures.pool.query('SELECT checkpoint FROM agent_runs WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1',[s.event.id])).rows[0].checkpoint as AgentCheckpoint
    assert.equal(first.phase,'respond');assert.equal(first.observations.length,1)
    await processReply(s.service.database,s.job,s.service.notify,async(_p,json)=>{assert.equal(json,false);return '可以先从你观察到的具体行为开始。'})
    let d=await s.detail();assert.equal(d.messages.at(-1).status,'complete');assert.equal(d.messages.at(-1).author_name,'Reso')
    const fresh=await s.send('我改变主意了，只想聊聊');let plans=0
    await processReply(s.service.database,s.job,s.service.notify,async(_p,json)=>{if(json){plans++;return plan([String(fresh.id)])}return '好，我们先聊聊你愿意说的部分。'})
    assert.equal(plans,1)
    const last=await s.send('请整理回访');let rounds=0
    await assert.rejects(processReply(s.service.database,s.job,s.service.notify,async(_p,json)=>{
      if(json)return plan([String(last.id)],rounds++?{proposals:[{kind:'followup',value:{reflection:'已有的想法',next_step:'待本人决定'},source_ids:[String(last.id)]}]}:{tools:[{name:'practice_guide',kind:'followup'}]})
      await s.send('先不要整理，我有新情况');return '这份旧回复不应发布。'
    }),/CONTEXT_CHANGED/)
    d=await s.detail();assert.ok(!d.messages.some((m:any)=>m.content==='这份旧回复不应发布。'))
  }finally{await s.close()}
})

test('confirmed NVC and followup proposals reach real records without duplicating or changing other practice fields',{skip},async()=>{
  const s=await scenario()
  try{
    for(const kind of ['nvc','followup'] as const){
      const source=await s.send(kind==='nvc'?'请整理表达练习':'请整理回访'),id=String(source.id);let plans=0
      const value=kind==='nvc'?{observation:'我说话时被打断',feeling:'委屈',need:'被听见',request:'让我先说完'}:{reflection:'还没有尝试表达',next_step:'计划写下请求，尚未执行'}
      await processReply(s.service.database,s.job,s.service.notify,async(_p,json)=>json?plan([id],plans++?{proposals:[{kind,value,source_ids:[id]}]}:{tools:[{name:'practice_guide',kind}]}):'你可以核对并修改这份建议。')
      const d=await s.detail(),a=d.messages.at(-1).agent_actions[0],url=`/api/events/${s.event.id}/agent-actions/${a.id}`
      assert.equal((await s.call(s.owner.cookie,'POST',url,{decision:'apply'})).statusCode,200)
      assert.equal((await s.call(s.owner.cookie,'POST',url,{decision:'apply'})).statusCode,200)
    }
    const d=await s.detail();assert.equal(d.exercise.practice_notes.nvc.need,'被听见');assert.equal(d.exercise.story,'');assert.equal(d.followups.length,1)
    await s.call(s.owner.cookie,'DELETE',`/api/events/${s.event.id}`)
    assert.equal((await s.fixture.fixtures.pool.query('SELECT count(*) FROM agent_actions WHERE event_id=$1',[s.event.id])).rows[0].count,'0')
  }finally{await s.close()}
})

test('message pages expose only their completed reply understanding kind and retain correction flow',{skip},async()=>{
  const s=await scenario()
  try{
    await s.send('我今天有点累，只想先聊聊')
    await processReply(s.service.database,s.job,s.service.notify,async()=>plan([],{reply:'可以先慢慢说，我在这里听。'}))
    let d=await s.detail();assert.equal(d.messages.at(-1).understanding_kind,null);assert.equal(d.messages[0].understanding_kind,null)
    const source=await s.send('你能先概括一下我在意的是什么吗？')
    await processReply(s.service.database,s.job,s.service.notify,async()=>{return plan([String(source.id)],{understanding_kind:'summary',reply_summary:'先概括你已说出的关切，其余解释仍待核对。',reply:'你在意的是自己的复习安排能先被听完，再讨论休息时间。我这样理解准确吗？'})})
    d=await s.detail();const message=d.messages.at(-1);assert.equal(message.understanding_kind,'summary');assert.equal(message.reply_summary,'先概括你已说出的关切，其余解释仍待核对。');assert.ok(!message.content.includes(message.reply_summary));assert.equal('reasoning_content' in message,false);assert.equal('assessment' in message,false)
    const page=await s.call(s.owner.cookie,'GET',`/api/events/${s.event.id}/messages?domain=private`);assert.equal(page.statusCode,200);assert.equal(page.json().messages.at(-1).understanding_kind,'summary');assert.equal(page.json().messages.at(-1).reply_summary,message.reply_summary);assert.equal((await s.call(s.owner.cookie,'GET',`/api/events/${s.event.id}/messages?domain=room`)).json().messages.length,0)
    assert.equal((await s.call(s.guest.cookie,'GET',`/api/events/${s.event.id}/messages?domain=private`)).statusCode,403)
    const saved=await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/understandings`,{domain:'private',sourceMessageId:String(message.id)});assert.equal(saved.statusCode,200)
    d=await s.detail();assert.equal(d.understandings[0].source_message_id,String(message.id));assert.equal(d.understandings[0].provenance,'model_inference')
    const inference=await s.send('我也不确定自己为什么这么怕被打断')
    await processReply(s.service.database,s.job,s.service.notify,async()=>plan([String(inference.id)],{understanding_kind:'inference',reply:'你可能担心一被打断，自己的安排就没有机会完整说出来。这是我的推测，需要你核对。'}))
    assert.equal((await s.detail()).messages.at(-1).understanding_kind,'inference')
  }finally{await s.close()}
})

test('method cards negotiate client support, record real choices and retain restrictions without saving content',{skip},async()=>{
  const s=await scenario()
  try{
    async function recommend(text:string){
      const source=await s.send(text),id=String(source.id);let planning=0
      await processProductionReply(s.service.database,s.job,s.service.notify,async(prompt,json)=>{
        assert.equal(json,true)
        if(prompt.startsWith(turnAssessmentPromptTag))return JSON.stringify(turnAssessmentSchema.parse({schema_version:1,intent:'method_offer',emotion:'希望被看见',emotion_intensity:'moderate',event_clarity:'clear',readiness:'exploring',risk:'none',risk_reason:'',method_candidate:'narrative',user_requested_method:false,record_request:null,understanding_confirmed:true,confirmation_evidence_id:id,third_party_motive_uncertain:true,room_intervention_needed:false,confidence:0.9,evidence:[{message_id:id,quote:text}],hypotheses:[],uncertainty:'仍待本人核对'}))
        return planning++?plan([id],{reply:'这是一个可选推荐，是否开始和保存都由你决定。',proposals:[{kind:'method',value:{method:'narrative',reason:'把具体经历和对自己的评价分开看看'},source_ids:[id]}]}):plan([id],{tools:[{name:'retrieve_methods',kind:'narrative'}],reply:''})
      })
      return(await s.detail()).messages.at(-1).agent_actions[0]
    }
    const first=await recommend('是的，我希望努力能被看见。想先了解一个小练习，先别保存。')
    assert.equal(first.kind,'method');assert.equal((await s.detail()).exercise,null)
    const legacy=await s.service.app.inject({method:'GET',url:`/api/events/${s.event.id}/messages`,headers:{cookie:s.owner.cookie}})
    assert.deepEqual(legacy.json().messages.at(-1).agent_actions,[])
    const apply=()=>s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/agent-actions/${first.id}`,{decision:'apply'})
    const applied=await apply();assert.equal(applied.statusCode,200);assert.deepEqual(applied.json(),{saved:false,startedMethod:'narrative'})
    const version=(await s.detail()).event.private_version
    assert.equal((await apply()).statusCode,200);assert.equal((await s.detail()).event.private_version,version)
    assert.equal((await s.detail()).exercise,null);assert.equal((await s.detail()).event.summary,'')
    const second=await recommend('我想再了解一下这个练习，仍然先不开始。')
    await s.send('现在先继续聊，不试这个练习')
    assert.equal((await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/agent-actions/${second.id}`,{decision:'dismiss'})).statusCode,200)
    const state=await loadAgentSessionState(s.service.database,s.event.id,'private')
    assert.equal(state.advice_declined,true);assert.deepEqual(state.declined_methods,['narrative'])
    assert.equal((await s.detail()).exercise,null);assert.equal((await s.detail()).followups.length,0)
    await s.send('我不想活了')
    assert.equal((await apply()).statusCode,409)
    await processProductionReply(s.service.database,s.job,s.service.notify,async()=>{throw Error('must not invoke model for explicit risk')})
    await s.send('我们继续做练习吧')
    await processProductionReply(s.service.database,s.job,s.service.notify,async()=>{throw Error('ordinary reply cannot clear persisted risk')})
    assert.equal((await loadAgentSessionState(s.service.database,s.event.id,'private')).safety_state,'blocked')
    const invite=await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/invites`,{shareSummary:false,version:0,clientId:randomUUID()})
    assert.equal(invite.statusCode,409)
    assert.equal((await s.fixture.fixtures.pool.query('SELECT count(*) FROM share_grants WHERE event_id=$1',[s.event.id])).rows[0].count,'0')
  }finally{await s.close()}
})

test('room risk cannot be bypassed by issuing an invitation through the private-event endpoint',{skip},async()=>{
  const s=await scenario()
  try{
    const pending=await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/invites`,{shareSummary:false,version:0,clientId:randomUUID()})
    assert.equal(pending.statusCode,200)
    const sent=await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/messages`,{content:'我不想活了',domain:'room',clientId:randomUUID()})
    assert.equal(sent.statusCode,200)
    await processProductionReply(s.service.database,{...s.job,domain:'room'},s.service.notify,async()=>{throw Error('explicit room risk must not invoke model')})
    assert.equal((await loadAgentSessionState(s.service.database,s.event.id,'room')).safety_state,'blocked')
    const response=await s.call(s.owner.cookie,'POST',`/api/events/${s.event.id}/invites`,{shareSummary:false,version:0,clientId:randomUUID()})
    assert.equal(response.statusCode,409)
    const accept=await s.call(s.guest.cookie,'POST',`/api/invites/${pending.json().token}/respond`,{accept:true})
    assert.equal(accept.statusCode,409)
    const decline=await s.call(s.guest.cookie,'POST',`/api/invites/${pending.json().token}/respond`,{accept:false})
    assert.equal(decline.statusCode,200)
    assert.equal((await s.fixture.fixtures.pool.query('SELECT count(*) FROM share_grants WHERE event_id=$1',[s.event.id])).rows[0].count,'0')
  }finally{await s.close()}
})

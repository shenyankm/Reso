import test from 'node:test'
import assert from 'node:assert/strict'
import {createAgent,turnAssessmentPromptTag,safetyReply} from './agent'
import type {AgentCheckpoint,Model,AgentInput} from './agent'
import type {TurnAssessment} from './agent-policy'
import {initialSessionState} from './agent-policy'
import {methodCards} from '../shared/methods'

const message='对，我希望先被看见努力。'
const input:AgentInput={domain:'private',scopeKey:'private:event-1',contextVersion:2,supportsMethodOffers:true,lastMessage:message,messageIds:['10','11'],userMessageIds:['10','11'],context:JSON.stringify({messages:[{id:'10',role:'user',text:'我追上了课程，妈妈说就差几分。'},{id:'11',role:'user',text:message}]})}
const turn=(changes:Partial<TurnAssessment>={}):TurnAssessment=>({schema_version:1,intent:'explore',refusal_target:null,emotion:'委屈',emotion_intensity:'moderate',event_clarity:'clear',readiness:'exploring',risk:'none',risk_reason:'',method_candidate:'narrative',user_requested_method:false,record_request:null,understanding_confirmed:true,confirmation_evidence_id:'11',third_party_motive_uncertain:true,room_intervention_needed:true,confidence:0.8,evidence:[{message_id:'11',quote:message}],hypotheses:[{text:'努力没被看见可能很重要',evidence_ids:['11'],confidence:0.7}],uncertainty:'仍需本人核对',...changes})
const plan=(extra:Record<string,unknown>={})=>JSON.stringify({intent:'支持当前具体事件',strategy:'listen',evidence_ids:['11'],uncertainty:'不替妈妈下结论',needs_human:false,reply:'我先按你说的，理解为希望自己的努力被看见。',...extra})
const observation=(p:string)=>p.startsWith(turnAssessmentPromptTag)

test('observer JSON is validated before the main agent receives the protected route',async()=>{
  const calls:string[]=[]
  const result=await createAgent(async p=>{
    calls.push(p)
    if(observation(p))return JSON.stringify(turn({method_candidate:null}))
    assert.ok(p.includes('meaning_exploration'));assert.ok(p.includes('"route":"C"'))
    return plan()
  }).invoke({input})
  assert.equal(calls.length,2);assert.equal(result.assessment.route_decision?.route,'C')
  assert.equal(result.assessment.session_state?.hypotheses[0].status,'unconfirmed')
  assert.equal(result.progress.trace[0].stage,'assess')
})

test('a suitable voluntary method offer retrieves a versioned card and remains unstarted and unsaved',async()=>{
  let planning=0
  const result=await createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn())
    assert.ok(p.includes('method 推荐只由 may_offer_method 决定'))
    assert.ok(!p.includes('may_prepare_record=false 时 proposals 必须为空'))
    return ++planning===1?plan({tools:[{name:'retrieve_methods',kind:'narrative'}],reply:''}):plan({reply:'有一个回看具体经历的小练习，可以由你决定是否看看。',proposals:[{kind:'method',value:{method:'narrative',reason:'把妈妈的原话和你对自己的理解分开看看。'},source_ids:['11']}]})
  },undefined,{tools:async request=>({request,result:methodCards.narrative,source_ids:[],user_source_ids:[]})}).invoke({input})
  assert.equal(result.assessment.proposals[0].kind,'method');assert.equal(result.assessment.route_decision?.skill,'method_offer')
  assert.equal(result.assessment.route_decision?.may_prepare_record,false)
  assert.equal(result.progress.observations.length,1);assert.equal(result.progress.method_offers,true)
  assert.equal(result.progress.session_state?.last_offered_method,'narrative')
})

test('an explicitly requested preview retrieves its card without treating it as starting or saving',async()=>{
  const text='请给我叙事小练习的推荐卡，先看看再决定，不要开始或保存。'
  const preview={...input,lastMessage:text,context:JSON.stringify({messages:[{id:'11',role:'user',text}]})}
  let planning=0
  const result=await createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn({intent:'method_offer',understanding_confirmed:false,confirmation_evidence_id:null,evidence:[{message_id:'11',quote:text}]}))
    return ++planning===1?plan({tools:[{name:'retrieve_methods',kind:'narrative'}],reply:''}):plan({reply:'先看看这个小练习，再决定是否尝试。',proposals:[{kind:'method',value:{method:'narrative',reason:'按你的请求先了解叙事小练习。'},source_ids:['11']}]})
  },undefined,{tools:async request=>({request,result:methodCards.narrative,source_ids:[],user_source_ids:[]})}).invoke({input:preview})
  assert.equal(result.progress.observations.length,1);assert.equal(result.assessment.proposals[0].kind,'method')
  assert.equal(result.assessment.route_decision?.may_prepare_record,false)
  assert.equal(result.assessment.session_state?.readiness,'exploring')
})

test('old clients receive ordinary conversation and cannot cause an unsupported method card',async()=>{
  const result=await createAgent(async p=>observation(p)?JSON.stringify(turn()):plan()).invoke({input:{...input,supportsMethodOffers:false}})
  assert.equal(result.assessment.route_decision?.may_offer_method,null);assert.deepEqual(result.assessment.proposals,[])
  assert.equal(result.progress.session_state?.last_offered_method,null)
  await assert.rejects(createAgent(async p=>observation(p)?JSON.stringify(turn()):plan({proposals:[{kind:'method',value:{method:'narrative',reason:'试试'},source_ids:['11']}]})).invoke({input:{...input,supportsMethodOffers:false}}),/METHOD_OFFER_BLOCKED/)
})

test('observer escalation is independent from the main model and persists into a later ordinary message',async()=>{
  let calls=0
  const risk=await createAgent(async p=>{calls++;assert.ok(observation(p));return JSON.stringify(turn({risk:'uncertain',risk_reason:'需要优先核实安全'}))}).invoke({input})
  assert.equal(calls,1);assert.equal(risk.reply,safetyReply);assert.equal(risk.assessment.route_decision?.route,'H')
  const next=await createAgent(async()=>{throw Error('ordinary planner must not run while restricted')}).invoke({input:{...input,lastMessage:'先继续做练习吧',contextVersion:3,sessionState:risk.progress.session_state!}})
  assert.equal(next.assessment.route_decision?.route,'H');assert.deepEqual(next.assessment.proposals,[])
})

test('declined-method memory survives a new turn without automatically clearing on apparent enthusiasm',async()=>{
  const state={...initialSessionState(input.scopeKey!),context_version:1,last_offered_method:'narrative' as const,declined_methods:['narrative' as const]}
  const result=await createAgent(async p=>observation(p)?JSON.stringify(turn()):plan()).invoke({input:{...input,sessionState:state}})
  assert.equal(result.assessment.route_decision?.may_offer_method,null)
  assert.deepEqual(result.progress.session_state?.declined_methods,['narrative'])
})

test('eligibility alone does not record a method as offered when no card was generated',async()=>{
  const result=await createAgent(async p=>observation(p)?JSON.stringify(turn()):plan()).invoke({input})
  assert.equal(result.assessment.route_decision?.may_offer_method,'narrative')
  assert.equal(result.progress.session_state?.last_offered_method,null)
})

test('the main planner cannot overwrite trusted observation, state or routing',async()=>{
  let attempts=0
  await assert.rejects(createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn({method_candidate:null}))
    attempts++;return plan({route_decision:{route:'D'}})
  }).invoke({input}),/PLAN_CANNOT_OVERRIDE_ASSESSMENT/)
  assert.equal(attempts,2)
})

test('a main-model support flag cannot grant tools or change a retained listening preference',async()=>{
  let plans=0,tools=0
  const previous={...initialSessionState(input.scopeKey!),advice_declined:true}
  const result=await createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn({intent:'vent',method_candidate:null,readiness:'listening'}))
    return plans++?plan():plan({needs_human:true,tools:[{name:'find_support',need:'沟通'}],reply:''})
  },undefined,{tools:async request=>{tools++;return{request,result:[],source_ids:[],user_source_ids:[]}}}).invoke({input:{...input,sessionState:previous}})
  assert.equal(tools,0);assert.equal(plans,2)
  assert.equal(result.assessment.route_decision?.route,'A');assert.equal(result.assessment.needs_human,false)
  assert.equal(result.progress.session_state?.last_route,'A');assert.equal(result.progress.session_state?.advice_declined,true)
})

test('an invalid main plan leaves the protected route and stage intact for its repair',async()=>{
  let plans=0,tools=0
  const result=await createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn({method_candidate:null}))
    return plans++?plan():plan({needs_human:true,tools:[{name:'practice_guide',kind:'nvc'}],reply:''})
  },undefined,{tools:async request=>{tools++;return{request,result:methodCards.nvc,source_ids:[],user_source_ids:[]}}}).invoke({input})
  assert.equal(tools,0);assert.equal(plans,2)
  assert.equal(result.assessment.route_decision?.route,'C');assert.equal(result.progress.session_state?.last_route,'C')
  assert.equal(result.progress.session_state?.stage,'perspectives');assert.equal(result.assessment.needs_human,false)
})

test('main-model silence cannot suppress a room intervention selected by the observer',async()=>{
  let plans=0
  const result=await createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn({method_candidate:null,room_intervention_needed:true}))
    return plans++?plan():plan({strategy:'silent',reply:''})
  }).invoke({input:{...input,domain:'room',scopeKey:'room:event-1'}})
  assert.equal(plans,2);assert.notEqual(result.reply,'')
  assert.equal(result.assessment.route_decision?.route,'C');assert.equal(result.progress.session_state?.last_route,'C')
  assert.equal(result.assessment.route_decision?.skill,'meaning_exploration')
})

test('a quiet room stays silent when the main model proposes ordinary speech',async()=>{
  const result=await createAgent(async p=>observation(p)?JSON.stringify(turn({method_candidate:null,room_intervention_needed:false})):plan()).invoke({input:{...input,domain:'room',scopeKey:'room:event-1'}})
  assert.equal(result.reply,'');assert.equal(result.assessment.strategy,'silent')
  assert.equal(result.assessment.route_decision?.skill,'observation');assert.deepEqual(result.assessment.route_decision?.allowed_tools,[])
})

test('a refused method never reaches a read tool or draft even if the main model requests it',async()=>{
  let tools=0
  await assert.rejects(createAgent(async p=>observation(p)?JSON.stringify(turn({intent:'refuse',readiness:'declined'})):plan({tools:[{name:'practice_guide',kind:'nvc'}],reply:''}),undefined,{tools:async request=>{tools++;return{request,result:methodCards.nvc,source_ids:[],user_source_ids:[]}}}).invoke({input}),/TOOL_BLOCKED_BY_ROUTE/)
  assert.equal(tools,0)
  await assert.rejects(createAgent(async p=>observation(p)?JSON.stringify(turn({method_candidate:null})):plan({proposals:[{kind:'summary',value:{summary:'不应自动整理'},source_ids:['11']}]})).invoke({input}),/RECORD_REQUIRES_EXPLICIT_REQUEST/)
})

test('observer evidence cannot quote the assistant or promote a fabricated quotation',async()=>{
  await assert.rejects(createAgent(async()=>JSON.stringify(turn({evidence:[{message_id:'11',quote:'妈妈已经承认了错误'}]}))).invoke({input}),/ASSESSMENT_UNGROUNDED_EVIDENCE/)
  await assert.rejects(createAgent(async()=>JSON.stringify({...turn(),schema_version:2})).invoke({input}),/INVALID_TURN_ASSESSMENT/)
})

test('a requested editable expression draft still needs its guide and explicit record kind',async()=>{
  let plans=0
  const result=await createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn({intent:'exercise',method_candidate:'nvc',readiness:'willing',user_requested_method:true,record_request:'nvc'}))
    return plans++?plan({proposals:[{kind:'nvc',value:{observation:'妈妈说就差几分',feeling:'',need:'被看见努力',request:''},source_ids:['11']}]}):plan({tools:[{name:'practice_guide',kind:'nvc'}],reply:''})
  },undefined,{tools:async request=>({request,result:methodCards.nvc,source_ids:[],user_source_ids:[]})}).invoke({input})
  assert.equal(result.assessment.route_decision?.route,'D');assert.equal(result.assessment.proposals[0].kind,'nvc')
})

test('an explicit followup request can read the followup guide without being turned into an exercise',async()=>{
  let plans=0
  const result=await createAgent(async p=>{
    if(observation(p))return JSON.stringify(turn({intent:'reflect',method_candidate:null,readiness:'willing',record_request:'followup'}))
    return plans++?plan({proposals:[{kind:'followup',value:{reflection:'已经写下，但还没有发送',next_step:'周六再决定是否发送'},source_ids:['11']}]}):plan({tools:[{name:'practice_guide',kind:'followup'}],reply:''})
  },undefined,{tools:async request=>({request,result:{purpose:'回看尝试与下一步'},source_ids:[],user_source_ids:[]})}).invoke({input})
  assert.equal(result.assessment.route_decision?.skill,'reflection')
  assert.equal(result.assessment.proposals[0].kind,'followup')
})

test('an explicitly requested draft cannot be replaced with a claim in ordinary reply text',async()=>{
  await assert.rejects(createAgent(async p=>observation(p)?JSON.stringify(turn({intent:'reflect',method_candidate:null,readiness:'willing',record_request:'followup'})):plan({reply:'我已经整理成下面的回访草稿，但没有给出可核对卡。'})).invoke({input}),/RECORD_DRAFT_REQUIRED/)
})

test('restoration cannot reuse a checkpoint from a different private event or client capability',async()=>{
  const result=await createAgent(async p=>observation(p)?JSON.stringify(turn({method_candidate:null})):plan()).invoke({input})
  await assert.rejects(createAgent(async()=>{throw Error('must not run')},undefined,{resume:result.progress}).invoke({input:{...input,scopeKey:'private:other-event'}}),/SESSION_SCOPE_MISMATCH/)
  await assert.rejects(createAgent(async()=>{throw Error('must not run')},undefined,{resume:result.progress}).invoke({input:{...input,supportsMethodOffers:false}}),/CHECKPOINT_CAPABILITIES_CHANGED/)
  await assert.rejects(createAgent(async()=>{throw Error('must not run')},undefined,{resume:result.progress}).invoke({input:{...input,contextVersion:3}}),/CHECKPOINT_CONTEXT_CHANGED/)
})

test('a checkpoint without the observation and policy contract is reassessed before it can reply',async()=>{
  const previous=await createAgent(async p=>observation(p)?JSON.stringify(turn({method_candidate:null})):plan()).invoke({input})
  const legacy={...previous.progress,turn_assessment:null,route_decision:null,session_state:null,reply:'OLD_CACHED_REPLY'}
  let calls=0
  const refreshed=await createAgent(async p=>{calls++;return observation(p)?JSON.stringify(turn({method_candidate:null})):plan()},undefined,{resume:legacy}).invoke({input})
  assert.equal(calls,2);assert.notEqual(refreshed.reply,'OLD_CACHED_REPLY')
  assert.equal(refreshed.assessment.route_decision?.route,'C')
})

test('a restricted restored checkpoint cannot become ordinary conversation when the caller omits session state',async()=>{
  const previous=await createAgent(async p=>observation(p)?JSON.stringify(turn({risk:'uncertain',risk_reason:'需要核实具体安全线索'})):plan()).invoke({input})
  const result=await createAgent(async()=>{throw Error('restricted checkpoint must not run the ordinary model')},undefined,{resume:previous.progress}).invoke({input})
  assert.equal(result.assessment.route_decision?.route,'H')
  assert.equal(result.progress.session_state?.safety_state,'review_required')
})

test('a resumed generation retains observation and route without repeating either stage',async()=>{
  let saved:AgentCheckpoint|undefined
  const first:Model=async(p,json)=>{
    if(observation(p))return JSON.stringify(turn({method_candidate:null}))
    if(!json)throw Error('MODEL_HTTP_503')
    return JSON.stringify({intent:'倾听',strategy:'listen',evidence_ids:['11'],uncertainty:'待核对',needs_human:false})
  }
  await assert.rejects(createAgent(first,undefined,{checkpoint:async p=>{saved=p}}).invoke({input}),/MODEL_HTTP_503/)
  assert.equal(saved?.phase,'respond')
  let calls=0
  const next=await createAgent(async(_p,json)=>{calls++;assert.equal(json,false);return '我们先按你说的把这部分理解放在这里。'},undefined,{resume:saved}).invoke({input})
  assert.equal(calls,1);assert.deepEqual(next.assessment.turn_assessment,saved?.turn_assessment)
})

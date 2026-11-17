import test from 'node:test'
import assert from 'node:assert/strict'
import {initialSessionState,turnAssessmentSchema,decideRoute,validateTurnEvidence,applySessionFeedback} from './agent-policy'
import type {TurnAssessment} from './agent-policy'

const turn=(overrides:Partial<TurnAssessment>={}):TurnAssessment=>({schema_version:1,intent:'explore',refusal_target:null,emotion:'委屈',emotion_intensity:'moderate',event_clarity:'clear',readiness:'exploring',risk:'none',risk_reason:'',method_candidate:null,user_requested_method:false,record_request:null,understanding_confirmed:false,confirmation_evidence_id:null,third_party_motive_uncertain:true,room_intervention_needed:true,confidence:0.85,evidence:[{message_id:'10',quote:'妈妈说就差几分'}],hypotheses:[],uncertainty:'不知道妈妈的意思',...overrides})
const initial=()=>initialSessionState('private:event-1')

test('first venting listens; clearer evidence can explore; a correction returns to clarification',()=>{
  const first=decideRoute(turn({intent:'vent',emotion_intensity:'high',readiness:'listening'}),initial(),'private','10',1)
  assert.equal(first.decision.route,'A');assert.equal(first.decision.may_prepare_record,false)
  const next=decideRoute(turn(),first.state,'private','11',2)
  assert.equal(next.decision.route,'C');assert.equal(next.state.stage,'perspectives')
  const corrected=decideRoute(turn({intent:'correct',hypotheses:[{text:'旧猜测',evidence_ids:['10'],confidence:0.8}]}),next.state,'private','12',3)
  assert.equal(corrected.decision.route,'G');assert.deepEqual(corrected.state.hypotheses,[])
})

test('method recommendation, explicit start, and record creation are separate gates',()=>{
  const offer=decideRoute(turn({understanding_confirmed:true,confirmation_evidence_id:'10',method_candidate:'narrative'}),initial(),'private','10')
  assert.equal(offer.decision.skill,'method_offer');assert.equal(offer.decision.may_offer_method,'narrative');assert.equal(offer.decision.may_prepare_record,false)
  const start=decideRoute(turn({intent:'exercise',method_candidate:'narrative',readiness:'willing',user_requested_method:true}),offer.state,'private','11')
  assert.equal(start.decision.route,'D');assert.equal(start.decision.may_prepare_record,false)
  const draft=decideRoute(turn({intent:'exercise',method_candidate:'nvc',readiness:'willing',user_requested_method:true,record_request:'nvc'}),start.state,'private','12')
  assert.equal(draft.decision.may_prepare_record,true)
  assert.equal(draft.decision.requires_confirmation,true)
})

test('a declined method stays declined after unrelated chat; only an explicit change reopens it',()=>{
  const offered=decideRoute(turn({method_candidate:'nvc',understanding_confirmed:true}),initial(),'private','10')
  offered.state.last_offered_method='nvc'
  const refused=decideRoute(turn({intent:'refuse',method_candidate:null,readiness:'declined'}),offered.state,'private','11')
  assert.deepEqual(refused.state.declined_methods,['nvc'])
  const later=decideRoute(turn({method_candidate:'nvc',understanding_confirmed:true}),refused.state,'private','30')
  assert.equal(later.decision.may_offer_method,null)
  const reopened=decideRoute(turn({intent:'exercise',method_candidate:'nvc',user_requested_method:true,readiness:'willing'}),later.state,'private','31')
  assert.equal(reopened.decision.route,'D');assert.deepEqual(reopened.state.declined_methods,[])
})

test('persistent risk cannot be cleared by a safe-looking later user message or a method request',()=>{
  const risk=decideRoute(turn({risk:'immediate',risk_reason:'显式风险信号'}),initial(),'private','10',1)
  assert.equal(risk.decision.route,'H');assert.equal(risk.state.safety_state,'blocked')
  const next=decideRoute(turn({intent:'exercise',user_requested_method:true,method_candidate:'nvc',readiness:'willing',record_request:'nvc'}),risk.state,'private','11',2)
  assert.equal(next.decision.route,'H');assert.deepEqual(next.decision.allowed_tools,[]);assert.equal(next.decision.may_prepare_record,false)
})

test('room route never permits private methods or drafts, and observation has no tools',()=>{
  const active=decideRoute(turn({intent:'exercise',user_requested_method:true,method_candidate:'nvc',readiness:'willing',record_request:'nvc'}),initialSessionState('room:event-1'),'room','10')
  assert.equal(active.decision.may_prepare_record,false);assert.equal(active.decision.may_offer_method,null)
  assert.ok(!active.decision.allowed_tools.some(t=>['read_practice','practice_guide','retrieve_methods','find_support'].includes(t)))
  const observing=decideRoute(turn({room_intervention_needed:false}),initialSessionState('room:event-1'),'room','11')
  assert.equal(observing.decision.skill,'observation');assert.deepEqual(observing.decision.allowed_tools,[])
})

test('low confidence or unclear event takes a clarification route without a method offer',()=>{
  assert.equal(decideRoute(turn({confidence:0.2}),initial(),'private','10').decision.route,'G')
  const unclear=decideRoute(turn({event_clarity:'partial',method_candidate:'roleplay',understanding_confirmed:true}),initial(),'private','10')
  assert.equal(unclear.decision.route,'B');assert.equal(unclear.decision.may_offer_method,null)
  const missing=decideRoute(turn({intent:'exercise',event_clarity:'unknown',record_request:'summary',readiness:'willing'}),initial(),'private','11')
  assert.equal(missing.decision.may_prepare_record,false)
})

test('an unclassified request explains scope instead of inventing a meaning-exploration intent',()=>{
  for(const domain of ['private','room'] as const){
    const result=decideRoute(turn({intent:'other',readiness:'unknown',third_party_motive_uncertain:false}),initialSessionState(`${domain}:event-1`),domain,'10')
    assert.equal(result.decision.route,'G');assert.equal(result.decision.may_offer_method,null)
    assert.equal(result.decision.may_prepare_record,false)
  }
})

test('support, voluntary communication, and action reflection use distinct skills',()=>{
  const support=decideRoute(turn({intent:'support'}),initial(),'private','10')
  assert.equal(support.decision.route,'F');assert.ok(support.decision.allowed_tools.includes('find_support'))
  const communication=decideRoute(turn({intent:'communicate'}),initial(),'private','10')
  assert.equal(communication.decision.route,'E');assert.equal(communication.decision.requires_confirmation,true)
  const reflect=decideRoute(turn({intent:'reflect'}),initial(),'private','10')
  assert.equal(reflect.decision.skill,'reflection')
})

test('observer evidence must be actual user text, not assistant output or a fabricated confirmation',()=>{
  const messages=[{id:'10',role:'user',text:'妈妈说就差几分，我感觉努力没被看到'},{id:'11',role:'assistant',text:'她在自责'}]
  assert.doesNotThrow(()=>validateTurnEvidence(turn(),messages))
  assert.throws(()=>validateTurnEvidence(turn({evidence:[{message_id:'11',quote:'她在自责'}]}),messages),/UNGROUNDED/)
  assert.throws(()=>validateTurnEvidence(turn({evidence:[{message_id:'10',quote:'妈妈明确否定我的所有努力'}]}),messages),/UNGROUNDED/)
  assert.throws(()=>validateTurnEvidence(turn({understanding_confirmed:true,confirmation_evidence_id:'99'}),messages),/CONFIRMATION/)
  assert.throws(()=>turnAssessmentSchema.parse({...turn(),diagnosis:'invented'}))
})

test('method feedback uses context versions so old dismissals cannot override a later deliberate start',()=>{
  const state=applySessionFeedback(initial(),[{kind:'agent_method_declined',method:'nvc',context_version:2},{kind:'agent_method_started',method:'nvc',context_version:3}])
  assert.equal(state.context_version,3);assert.equal(state.readiness,'willing');assert.deepEqual(state.declined_methods,[])
  const replay=applySessionFeedback(state,[{kind:'agent_method_declined',method:'nvc',context_version:2}])
  assert.deepEqual(replay,state)
})

test('a request for listening persists until the user explicitly asks for advice or a method',()=>{
  const refused=decideRoute(turn({intent:'refuse',readiness:'declined',evidence:[{message_id:'10',quote:'别给建议，先听我把委屈讲完'}]}),initial(),'private','10',1)
  const later=decideRoute(turn({method_candidate:'narrative',understanding_confirmed:true}),refused.state,'private','11',2)
  assert.equal(later.decision.may_offer_method,null)
  assert.equal(later.decision.skill,'emotion_support')
  const requested=decideRoute(turn({intent:'advice',readiness:'willing'}),later.state,'private','12',3)
  assert.equal(requested.state.advice_declined,false)
})

test('an explicit refusal persists even when the same message is mainly venting or correcting',()=>{
  for(const intent of ['vent','correct'] as const){
    const result=decideRoute(turn({intent,refusal_target:'advice',readiness:'unknown'}),initial(),'private','10',1)
    assert.equal(result.state.advice_declined,true)
    const later=decideRoute(turn({method_candidate:'nvc',understanding_confirmed:true}),result.state,'private','11',2)
    assert.equal(later.decision.may_offer_method,null);assert.equal(later.state.advice_declined,true)
  }
})

test('declining an invitation or ending a chat does not falsely reject the last method',()=>{
  const prior={...initial(),last_offered_method:'nvc' as const}
  for(const changes of [{intent:'refuse' as const,refusal_target:'invitation' as const,readiness:'declined' as const},{intent:'end' as const,readiness:'paused' as const}]){
    const result=decideRoute(turn(changes),prior,'private','10')
    assert.deepEqual(result.state.declined_methods,[]);assert.equal(result.state.advice_declined,false)
  }
  const all=decideRoute(turn({intent:'refuse',refusal_target:'all_methods',readiness:'declined'}),prior,'private','11')
  assert.deepEqual(all.state.declined_methods,['narrative','nvc','roleplay'])
})

test('asking to understand a method is distinct from a brief phrase request and from agreeing to begin',()=>{
  const request=decideRoute(turn({intent:'method_offer',event_clarity:'partial',readiness:'exploring',method_candidate:'narrative',understanding_confirmed:true}),initial(),'private','11')
  assert.equal(request.decision.skill,'method_offer');assert.equal(request.decision.may_offer_method,'narrative')
  assert.equal(request.decision.may_prepare_record,false);assert.equal(request.state.last_offered_method,null)
  const phrase=decideRoute(turn({intent:'advice',readiness:'listening',method_candidate:'nvc',understanding_confirmed:true}),initial(),'private','12')
  assert.equal(phrase.decision.skill,'practical_advice');assert.equal(phrase.decision.may_offer_method,null)
})

test('an explicit method preview needs no confirmation of a model hypothesis, while other gates still apply',()=>{
  const preview=turn({intent:'method_offer',method_candidate:'narrative',understanding_confirmed:false,confirmation_evidence_id:null})
  for(const event_clarity of ['clear','partial'] as const){
    const offered=decideRoute({...preview,event_clarity},initial(),'private','10')
    assert.equal(offered.decision.skill,'method_offer');assert.equal(offered.decision.may_offer_method,'narrative')
    assert.equal(offered.decision.may_prepare_record,false);assert.equal(offered.state.readiness,'exploring')
    assert.equal(offered.state.last_offered_method,null)
  }
  for(const blocked of [turn({method_candidate:'narrative'}),{...preview,event_clarity:'unknown' as const},{...preview,confidence:0.2},{...preview,emotion_intensity:'high' as const},{...preview,risk:'uncertain' as const},{...preview,refusal_target:'method' as const}]){
    assert.equal(decideRoute(blocked,initial(),'private','10').decision.may_offer_method,null)
  }
  assert.equal(decideRoute(preview,initialSessionState('room:event-1'),'room','10').decision.may_offer_method,null)
})

import {z} from 'zod'
import type {Domain} from '../shared/types'
import {methodKindSchema} from '../shared/agent'
export {methodKindSchema} from '../shared/agent'

export const agentPolicyVersion='wang-alignment-v1'
export function explicitDanger(text:string){
  return /(正在|准备|打算|马上|已经|想要|想).{0,12}(自杀|结束生命|伤害自己|割腕|跳楼)|(不想活了|活不下去了)/u.test(text)
}
export type MethodKind=z.infer<typeof methodKindSchema>
export const stageSchema=z.enum(['entry','listening','event','emotion','meaning','perspectives','practice','communication','support','reflection'])
const evidenceSchema=z.object({message_id:z.string().regex(/^\d{1,19}$/),quote:z.string().min(1).max(500)}).strict()
export const turnAssessmentSchema=z.object({
  schema_version:z.literal(1),
  intent:z.enum(['vent','clarify','explore','advice','method_offer','exercise','communicate','support','reflect','correct','refuse','pause','end','other']),
  refusal_target:z.enum(['method','all_methods','advice','invitation','topic']).nullable().default(null),
  emotion:z.string().max(100),
  emotion_intensity:z.enum(['unknown','low','moderate','high']),
  event_clarity:z.enum(['unknown','partial','clear']),
  readiness:z.enum(['unknown','listening','exploring','willing','declined','paused']),
  risk:z.enum(['none','uncertain','elevated','immediate']),
  risk_reason:z.string().max(300),
  method_candidate:methodKindSchema.nullable(),
  user_requested_method:z.boolean(),
  record_request:z.enum(['summary','nvc','followup']).nullable(),
  understanding_confirmed:z.boolean(),
  confirmation_evidence_id:z.string().nullable(),
  third_party_motive_uncertain:z.boolean(),
  room_intervention_needed:z.boolean(),
  confidence:z.number().min(0).max(1),
  evidence:z.array(evidenceSchema).max(8),
  hypotheses:z.array(z.object({text:z.string().max(500),evidence_ids:z.array(z.string()).min(1).max(8),confidence:z.number().min(0).max(1)}).strict()).max(4),
  uncertainty:z.string().max(500),
}).strict()
export type TurnAssessment=z.infer<typeof turnAssessmentSchema>

export const sessionStateSchema=z.object({
  schema_version:z.literal(1),
  policy_version:z.literal(agentPolicyVersion),
  scope_key:z.string().min(1).max(200),
  revision:z.number().int().nonnegative(),
  context_version:z.number().int().nonnegative(),
  stage:stageSchema,
  readiness:turnAssessmentSchema.shape.readiness,
  safety_state:z.enum(['unassessed','clear','review_required','blocked']),
  declined_methods:z.array(methodKindSchema).max(3),
  advice_declined:z.boolean().default(false),
  last_offered_method:methodKindSchema.nullable(),
  hypotheses:z.array(z.object({text:z.string().max(500),evidence_ids:z.array(z.string()).max(8),confidence:z.number().min(0).max(1),status:z.literal('unconfirmed')}).strict()).max(4),
  last_route:z.enum(['A','B','C','D','E','F','G','H']).nullable(),
  last_message_id:z.string().nullable(),
}).strict()
export type AgentSessionState=z.infer<typeof sessionStateSchema>

export function initialSessionState(scopeKey:string):AgentSessionState{
  return{schema_version:1,policy_version:agentPolicyVersion,scope_key:scopeKey,revision:0,context_version:0,stage:'entry',readiness:'unknown',safety_state:'unassessed',declined_methods:[],advice_declined:false,last_offered_method:null,hypotheses:[],last_route:null,last_message_id:null}
}

const routeSchema=z.enum(['A','B','C','D','E','F','G','H'])
export const routeDecisionSchema=z.object({
  schema_version:z.literal(1),policy_version:z.literal(agentPolicyVersion),route:routeSchema,
  stage:stageSchema,
  skill:z.enum(['emotion_support','event_clarification','meaning_exploration','practical_advice','method_offer','guided_practice','communication_planning','professional_support','clarification_or_pause','safety_support','reflection','observation']),
  reason:z.string().max(500),
  allowed_tools:z.array(z.string()).max(6),
  may_offer_method:methodKindSchema.nullable(),
  may_prepare_record:z.boolean(),
  requires_confirmation:z.boolean(),
  gates:z.array(z.object({gate:z.enum(['safety','domain','readiness','evidence','method','correction']),result:z.enum(['pass','block','review']),reason:z.string().max(120)}).strict()).max(6),
}).strict()
export type RouteDecision=z.infer<typeof routeDecisionSchema>

export const skillInstructions:Record<RouteDecision['skill'],string>={
  emotion_support:'回应这件事中具体的感受、努力或需要；不止换词复述，不急于讲理、解释对方或推进任务。',
  event_clarification:'区分对方原话、发生经过与本人的解释，先用已经提供的事实；缺少关键事实才核对，不替任何一方判对错。',
  meaning_exploration:'探索事件、当时的解释、感受与自我评价怎样联系，可参考 CBT 的事实/解释区分。一次核对一个假设，不把解释当事实，不贴认知或疾病标签，不替家长辩护。',
  practical_advice:'直接给一个贴合当前事实的说法或小建议，保留用户选择；完成用户要求的一句说法或建议就停，不附加用法、评价或新的选择，不升级成表单、练习或邀请。',
  method_offer:'结合已核对的具体事件，简要说明方法可能适合什么；检索对应方法卡，只作可选择的推荐，用户可以继续聊，不说已经开始或会有确定疗效。',
  guided_practice:'先查对应方法步骤和禁忌，再按本人意愿引导一个小步骤；允许留空、暂停和退出，不强迫积极或和解，保存和分享仍分别确认。',
  communication_planning:'先核对想与谁沟通、希望表达什么及具体共享范围。对方动机仍待本人确认；未明确授权不能生成已发出的邀请或共享事实。',
  professional_support:'按实际资源、适配及真实状态说明支持选择；没有已核验人员就如实说明，不虚构资质、接收、预约或治疗效果。',
  clarification_or_pause:'说明当前能力和授权范围，或采用本人的纠正，停止被拒绝的方法或解释；允许暂不回答和结束，不用反复追问或换一种方法继续推动。',
  safety_support:'先关注现实中的安全与支持，暂停普通练习和邀请，不假定监护人一定安全，不泄露私人内容，不声称已经联系真人或提供实时急救。',
  reflection:'先核对实际尝试、感受与障碍，区分已经发生、计划与假设；允许没有变化，不宣称一次练习解决关系问题。',
  observation:'尊重参与者自由沟通，不设置轮次或 Your turn；没有必要介入时保持安静，不生成私人卡片。',
}

export function decideRoute(turn:TurnAssessment,previous:AgentSessionState,domain:Domain,latestMessageId:string|null,contextVersion=previous.context_version):{decision:RouteDecision;state:AgentSessionState}{
  const state:AgentSessionState={...previous,revision:previous.revision+1,context_version:contextVersion,readiness:turn.readiness,last_message_id:latestMessageId,
    declined_methods:[...previous.declined_methods],hypotheses:turn.hypotheses.map(h=>({...h,status:'unconfirmed'}))}
  if(!turn.refusal_target&&(['advice','method_offer','support','communicate'].includes(turn.intent)||turn.user_requested_method||turn.record_request))state.advice_declined=false
  if(!turn.refusal_target&&turn.intent==='method_offer'&&turn.method_candidate&&['exploring','willing'].includes(turn.readiness))state.declined_methods=state.declined_methods.filter(m=>m!==turn.method_candidate)
  if(turn.intent==='refuse'||turn.refusal_target){
    const target=turn.refusal_target||(turn.method_candidate||previous.last_offered_method?'method':'advice')
    if(['method','all_methods','advice'].includes(target))state.advice_declined=true
    if(target==='all_methods')state.declined_methods=[...methodKindSchema.options]
    const declined=target==='method'?(turn.method_candidate||previous.last_offered_method):null
    if(declined&&!state.declined_methods.includes(declined))state.declined_methods.push(declined)
  }
  const enoughForOffer=turn.intent==='method_offer'&&turn.understanding_confirmed&&turn.event_clarity==='partial'
  const decision:RouteDecision={schema_version:1,policy_version:agentPolicyVersion,route:'A',stage:'listening',skill:'emotion_support',reason:'先回应当前感受，不把倾诉变成任务。',allowed_tools:['search_history','read_understandings'],may_offer_method:null,may_prepare_record:false,requires_confirmation:false,gates:[]}
  const gate=(gate:RouteDecision['gates'][number]['gate'],result:'pass'|'block'|'review',reason:string)=>decision.gates.push({gate,result,reason})
  const choose=(route:RouteDecision['route'],stage:RouteDecision['stage'],skill:RouteDecision['skill'],reason:string)=>Object.assign(decision,{route,stage,skill,reason})
  if(previous.safety_state==='blocked'||previous.safety_state==='review_required'||turn.risk!=='none'){
    state.safety_state=turn.risk==='immediate'||previous.safety_state==='blocked'?'blocked':'review_required'
    choose('H','support','safety_support','安全尚未完成核实，暂停普通练习和邀请，优先现实支持。')
    decision.allowed_tools=[];gate('safety','block',turn.risk_reason||'已有安全限制尚待专业复核')
  }else{
    state.safety_state='clear';gate('safety','pass','本轮未发现需要升级的信号；不是诊断或安全证明')
    if(turn.intent==='correct'){
      state.hypotheses=[]
      choose('G',turn.event_clarity==='clear'?'emotion':'event','clarification_or_pause','采用本人的纠正，放弃旧假设，重新理解。');gate('correction','block','旧理解不得继续作为事实')
    }else if(turn.refusal_target||['refuse','pause','end'].includes(turn.intent)||['declined','paused'].includes(turn.readiness)){
      choose('G','listening','clarification_or_pause','尊重拒绝、暂停或结束，不再次推动方法。');decision.allowed_tools=[];gate('readiness','block','本轮没有继续练习的意愿')
    }else if(state.advice_declined){
      gate('readiness','block','此前希望先倾听，尚未主动请求建议或方法')
    }else if(turn.intent==='advice'&&!turn.record_request&&!turn.user_requested_method&&turn.emotion_intensity!=='high'){
      choose('C','meaning','practical_advice','本人明确请求一个说法或小建议，直接回应，不升级成正式练习。')
    }else if(turn.emotion_intensity==='high'||turn.intent==='vent'||turn.readiness==='listening'){
      gate('readiness','block','当前先倾听；表达情绪不是练习同意')
    }else if(turn.intent==='support'){
      choose('F','support','professional_support','本人希望获得现实专业支持，查询真实资源并说明实际状态。')
      if(domain==='private')decision.allowed_tools.push('find_support')
    }else if(turn.confidence<0.55){
      choose('G','event','clarification_or_pause','判断证据或置信度不足，先简短核对，不强行解释。');gate('evidence','review','低置信度只允许核对和倾听')
    }else if(turn.intent==='reflect'){
      choose('C','reflection','reflection','先核对现实中是否尝试及遇到的障碍，不把计划当已发生。')
      if(domain==='private')decision.allowed_tools.push('read_practice')
    }else if(turn.intent==='communicate'){
      choose('E','communication','communication_planning','先理解沟通意愿和具体分享范围；建议不等于邀请或分享已执行。')
      decision.requires_confirmation=true
    }else if(turn.intent==='other'){
      choose('G','event','clarification_or_pause','当前意图或能力范围需要澄清，先说明边界，不升级为意义探索。')
      gate('evidence','review','未识别的意图不自动视为认知或关系探索')
    }else if(turn.event_clarity!=='clear'&&!turn.user_requested_method&&!enoughForOffer){
      choose('B','event','event_clarification','先还原一件具体的事，区分原话、感受和解释。')
    }else{
      const declined=turn.method_candidate&&state.declined_methods.includes(turn.method_candidate)
      if(turn.method_candidate&&turn.user_requested_method&&turn.readiness==='willing'&&domain==='private'){
        state.declined_methods=state.declined_methods.filter(m=>m!==turn.method_candidate)
        choose('D','practice','guided_practice','本人明确愿意尝试此方法；查明步骤后引导，保存仍须另行确认。')
        decision.allowed_tools.push('practice_guide','retrieve_methods','read_practice');decision.may_prepare_record=true;decision.requires_confirmation=true
      }else{
        choose('C',turn.third_party_motive_uncertain?'perspectives':'meaning','meaning_exploration','以待核对的可能解释帮助探索，不替第三方断定动机。')
        if(turn.method_candidate&&!declined&&(turn.readiness==='exploring'||turn.intent==='method_offer'&&turn.readiness==='willing')&&turn.understanding_confirmed&&domain==='private'){
          decision.skill='method_offer';decision.may_offer_method=turn.method_candidate;decision.allowed_tools.push('retrieve_methods');decision.requires_confirmation=true
        }
        if(declined)gate('method','block','此前已拒绝，须本人主动改变意愿才重新开放')
      }
    }
    decision.may_prepare_record=domain==='private'&&turn.record_request!==null&&turn.event_clarity!=='unknown'&&!['G','H'].includes(decision.route)&&turn.readiness==='willing'&&turn.emotion_intensity!=='high'
    if(decision.may_prepare_record)decision.requires_confirmation=true
    if(decision.may_prepare_record&&turn.record_request!=='summary'&&!decision.allowed_tools.includes('practice_guide'))decision.allowed_tools.push('practice_guide')
  }
  if(domain==='room'){
    decision.may_offer_method=null;decision.may_prepare_record=false
    decision.allowed_tools=decision.allowed_tools.filter(t=>!['read_practice','find_support','retrieve_methods','practice_guide'].includes(t));gate('domain','block','公共房间不能生成或读取个人练习记录')
    if(decision.route!=='H'&&!turn.room_intervention_needed){
      choose('A',previous.stage,'observation','双方自由沟通，当前无需 Reso 介入。');decision.allowed_tools=[]
    }
  }else gate('domain','pass','仅本人当前私人事件')
  state.stage=decision.stage;state.last_route=decision.route
  return{decision:routeDecisionSchema.parse(decision),state:sessionStateSchema.parse(state)}
}

export function validateTurnEvidence(turn:TurnAssessment,messages:{id:string;role:string;text:string}[]){
  const sources=new Map(messages.filter(m=>m.role==='user').map(m=>[m.id,m.text]))
  for(const evidence of turn.evidence){
    const source=sources.get(evidence.message_id)
    if(source===undefined||!source.includes(evidence.quote))throw Error('ASSESSMENT_UNGROUNDED_EVIDENCE')
  }
  const ids=new Set(turn.evidence.map(e=>e.message_id))
  if(turn.hypotheses.some(h=>h.evidence_ids.some(id=>!ids.has(id))))throw Error('HYPOTHESIS_UNGROUNDED_EVIDENCE')
  if(turn.understanding_confirmed&&(!turn.confirmation_evidence_id||!ids.has(turn.confirmation_evidence_id)))throw Error('CONFIRMATION_REQUIRES_USER_EVIDENCE')
  if(turn.risk!=='none'&&!turn.evidence.length)throw Error('RISK_REQUIRES_EVIDENCE')
}

export function applySessionFeedback(previous:AgentSessionState,feedback:{kind:'agent_method_started'|'agent_method_declined';method:MethodKind;context_version:number}[]):AgentSessionState{
  const state={...previous,declined_methods:[...previous.declined_methods]}
  for(const item of [...feedback].sort((a,b)=>a.context_version-b.context_version)){
    if(item.context_version<=state.context_version)continue
    if(item.kind==='agent_method_declined'){
      if(!state.declined_methods.includes(item.method))state.declined_methods.push(item.method)
      state.readiness='declined'
      state.advice_declined=true
    }else{
      state.declined_methods=state.declined_methods.filter(m=>m!==item.method);state.readiness='willing';state.advice_declined=false
    }
    state.last_offered_method=item.method;state.context_version=item.context_version
  }
  return sessionStateSchema.parse(state)
}

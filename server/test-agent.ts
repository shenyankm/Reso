import type {Model} from './agent'
import {turnAssessmentPromptTag} from './agent'
import type {TurnAssessment} from './agent-policy'

// Planning/transport regressions use a fixed observer; behavior tests exercise both real graph stages.
export function withObservationFixture(model:Model,overrides:Partial<TurnAssessment>={}):Model{
  return async(prompt,json,signal,onReasoning)=>{
    if(!prompt.startsWith(turnAssessmentPromptTag))return model(prompt,json,signal,onReasoning)
    signal?.throwIfAborted()
    const data=JSON.parse(prompt.slice(prompt.indexOf('INPUT_JSON\n')+11,prompt.lastIndexOf('\nEND_INPUT'))) as {lastMessage:string;latestMessageId:string|null}
    const text=data.lastMessage
    const record=/(整理|生成|写).*摘要|摘要.*(草稿|核对)/.test(text)?'summary':/(整理|生成|写).*回访|回访.*(草稿|核对)/.test(text)?'followup':/(整理|生成|核对).*表达|表达.*草稿/.test(text)?'nvc':null
    const method=record==='nvc'||/表达.*(练习|步骤)|开始.*表达/.test(text)?'nvc':null
    const turn:TurnAssessment={schema_version:1,refusal_target:null,intent:record==='followup'?'reflect':record||method?'exercise':'vent',emotion:'待核对',emotion_intensity:'low',event_clarity:'clear',readiness:record||method?'willing':'listening',risk:'none',risk_reason:'',method_candidate:method,user_requested_method:!!method,record_request:record,understanding_confirmed:false,confirmation_evidence_id:null,third_party_motive_uncertain:true,room_intervention_needed:true,confidence:0.9,evidence:data.latestMessageId&&text?[{message_id:data.latestMessageId,quote:text.slice(0,500)}]:[],hypotheses:[],uncertainty:'合成传输夹具，不是专业审核'}
    return JSON.stringify({...turn,...overrides})
  }
}

import {z} from 'zod'
import {decisionSummarySchema} from '../shared/reply'
import {methodLabels} from '../shared/methods'
import type {Domain} from '../shared/types'
import type {AgentCheckpoint} from './agent'
import {meaningExplorationReference} from './agent-policy'
import type {RouteDecision,TurnAssessment} from './agent-policy'

const intentions:Record<TurnAssessment['intent'],string>={
  vent:'表达困扰',clarify:'核对经历',explore:'探索感受与原因',advice:'寻求建议',
  method_offer:'主动了解方法',exercise:'尝试练习',communicate:'准备沟通',
  support:'寻求现实支持',reflect:'回看尝试',correct:'纠正上一轮理解',
  refuse:'拒绝当前建议',pause:'希望暂停',end:'希望结束',other:'意图待核对',
}
const clarity:Record<TurnAssessment['event_clarity'],string>={
  unknown:'具体经过待核对',partial:'已有部分经过',clear:'已有具体经过',
}
const intensity:Record<TurnAssessment['emotion_intensity'],string>={
  unknown:'',low:'情绪强度较低',moderate:'情绪强度中等',high:'情绪强度较高',
}
const stages:Record<RouteDecision['stage'],string>={
  entry:'进入对话',listening:'倾听与承接',event:'还原事件',emotion:'核对感受',
  meaning:'理解经历的意义',perspectives:'探索不同视角',practice:'引导练习',
  communication:'沟通准备',support:'现实支持',reflection:'回看尝试',
}
const methods:Record<RouteDecision['skill'],string>={
  emotion_support:'情绪承接',event_clarification:'区分原话、经过与当时反应',
  meaning_exploration:'核对事实、解释与自我评价',practical_advice:'提供具体的小建议',
  method_offer:'提供可选择的方法',guided_practice:'按意愿分步练习',
  communication_planning:'核对表达目标和分享范围',professional_support:'核对可用的支持',
  clarification_or_pause:'澄清、接受纠正或暂停',safety_support:'优先考虑现实安全与支持',
  reflection:'回看实际尝试和遇到的困难',observation:'保持旁听',
}
const methodReference=z.object({
  method_id:z.string().min(1).max(80),
  source:z.object({name:z.string().min(1).max(80)}),
  reference_framework:z.string().min(1).max(80).optional(),
})

function excerpt(value:string,limit:number) {
  const text=Array.from(value.replace(/\s+/g,' ').trim())
  return text.length>limit?text.slice(0,limit).join('')+'…':text.join('')
}

export function publicDecisionSummary(progress:AgentCheckpoint,domain:Domain) {
  const {turn_assessment:turn,route_decision:route}=progress
  if(progress.phase!=='complete'||!progress.reply||!progress.reply_summary||!turn||!route)return null

  // A room summary must not re-publish assessments of individual participants or copied excerpts.
  const showPersonalDetails=domain==='private'&&route.route!=='H'
  const evidence=showPersonalDetails?turn.evidence.slice(0,2).map(item=>`“${excerpt(item.quote,48)}”`):[]
  const hypotheses=showPersonalDetails?turn.hypotheses
    .map(item=>excerpt(item.text,80))
    .filter(text=>text&&!/<|reasoning_content|system prompt|内部推理|系统指令/i.test(text))
    .slice(0,2):[]
  const emotion=showPersonalDetails?excerpt(turn.emotion,36):''
  const state=[intentions[turn.intent],emotion&&!/<|reasoning_content|system prompt|内部推理|系统指令/i.test(emotion)?emotion:null,
    showPersonalDetails?intensity[turn.emotion_intensity]:null]
    .filter(Boolean).join(' · ')
  const sources=turn.evidence.length?[`当前对话原话（${new Set(turn.evidence.map(item=>item.message_id)).size} 条）`]:[]
  const references=progress.observations.flatMap(({request,result})=>{
    if((request.name!=='retrieve_methods'&&request.name!=='practice_guide')||request.kind==='followup')return []
    const card=methodReference.safeParse(result)
    return card.success?[{...card.data,label:methodLabels[request.kind]}]:[]
  })
  const reference=references[0]
  const tools=[...new Set(progress.trace.flatMap(entry=>entry.stage==='tool'&&entry.tool?[entry.tool]:[]))]
  const summary=decisionSummarySchema.safeParse({
    state:route.route==='H'?'有待优先核实的安全信号':state,
    situation:route.route==='H'?'需要核对安全与现实支持':clarity[turn.event_clarity],
    strategy:route.reason,
    execution:progress.reply_summary,
    sources:[...sources,...(reference?[`${reference.source.name} · ${reference.method_id}`]:[])],
    evidence,
    hypotheses,
    theory:reference?.reference_framework??(route.skill==='meaning_exploration'?`${meaningExplorationReference}（策略参考）`:null),
    method:reference?`${methods[route.skill]} · ${reference.label}`:methods[route.skill],
    route:route.route,
    stage:stages[route.stage],
    skill:route.skill,
    tools,
  })
  return summary.success?summary.data:null
}

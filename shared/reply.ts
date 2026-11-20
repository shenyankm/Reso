import {z} from 'zod'

export const replyPhases = ['understanding', 'checking', 'composing', 'reviewing'] as const
export type ReplyPhase = typeof replyPhases[number]
export const replyPhaseLabels: Record<ReplyPhase, string> = {
  understanding: '正在理解你的表达…',
  checking: '正在核对相关信息…',
  composing: '正在组织回复…',
  reviewing: '正在检查表达…',
}
export const maxReplyLength = 180
export const legacyReplySummary = '这是一条历史回复，当时未记录思考摘要。'
const shortText=z.string().min(1).max(240)
export const decisionSummarySchema=z.object({
  state:shortText,
  situation:shortText,
  strategy:shortText,
  execution:shortText,
  sources:z.array(shortText).max(4),
  evidence:z.array(shortText).max(2),
  hypotheses:z.array(shortText).max(2),
  theory:shortText.nullable(),
  method:shortText,
  route:z.enum(['A','B','C','D','E','F','G','H']),
  stage:shortText,
  skill:shortText,
  tools:z.array(shortText).max(4),
})
export type DecisionSummary=z.infer<typeof decisionSummarySchema>

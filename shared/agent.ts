import {z} from 'zod'

const sources=z.array(z.string().regex(/^\d{1,19}$/)).min(1).max(8)
export const methodKindSchema=z.enum(['narrative','nvc','roleplay'])
export type MethodKind=z.infer<typeof methodKindSchema>
export const proposalSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('method'),value:z.object({method:methodKindSchema,reason:z.string().trim().min(1).max(500)}).strict(),source_ids:sources}).strict(),
  z.object({kind:z.literal('summary'),value:z.object({summary:z.string().trim().min(1).max(3000)}).strict(),source_ids:sources}).strict(),
  z.object({kind:z.literal('nvc'),value:z.object({observation:z.string().max(2000),feeling:z.string().max(2000),need:z.string().max(2000),request:z.string().max(2000)}).strict(),source_ids:sources}).strict(),
  z.object({kind:z.literal('followup'),value:z.object({reflection:z.string().trim().min(1).max(2000),next_step:z.string().max(1000)}).strict(),source_ids:sources}).strict(),
])
export type AgentProposal=z.infer<typeof proposalSchema>
export type AgentAction=AgentProposal&{id:string;message_id:string;status:'pending'|'applied'|'dismissed'|'stale';created_at:string;sources?:{content:string}[]}

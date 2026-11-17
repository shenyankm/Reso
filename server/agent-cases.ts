import {readFileSync} from 'node:fs'
import {z} from 'zod'
import {methodKindSchema} from '../shared/agent'
const toolName=z.enum(['search_history','read_practice','read_understandings','find_support','practice_guide','retrieve_methods'])

const caseSchema=z.object({
  id:z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
  domain:z.enum(['private','room']).default('private'),
  seeds:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().min(1).max(2000)}).strict()).max(8).default([]),
  message:z.string().min(1).max(2000),
  old:z.string().min(1).max(2000).optional(),
  prior_state:z.object({advice_declined:z.boolean().optional(),declined_methods:z.array(methodKindSchema).max(3).optional(),last_offered_method:methodKindSchema.nullable().optional(),safety_state:z.enum(['clear','review_required','blocked']).optional()}).strict().default({}),
  expected:z.object({
    routes:z.array(z.enum(['A','B','C','D','E','F','G','H'])).min(1).max(8),
    proposals:z.array(z.enum(['method','summary','nvc','followup'])).max(2),
    required_tools:z.array(toolName).max(6).default([]),
    forbidden_tools:z.array(toolName).max(6).default([]),
    no_model:z.boolean().default(false),
    advice_declined:z.boolean().optional(),
  }).strict(),
  rubric:z.string().min(1).max(2000),
}).strict()

export function readWangCases(){
  const data=z.object({schema_version:z.literal(1),provenance:z.literal('synthetic_product_cases'),review_status:z.literal('pending_professional_review'),source_note:z.string().min(1),cases:z.array(caseSchema).min(10).max(15)}).strict().parse(JSON.parse(readFileSync(new URL('../docs/wang-decision-cases.json',import.meta.url),'utf8')))
  if(new Set(data.cases.map(c=>c.id)).size!==data.cases.length)throw Error('DUPLICATE_EVALUATION_CASE')
  return data
}
export type WangCase=ReturnType<typeof readWangCases>['cases'][number]

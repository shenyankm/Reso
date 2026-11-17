import {sql} from './db'
import type {Database} from './db'
import type {Domain} from '../shared/types'
import {HttpError} from './http'
import {sessionStateSchema,initialSessionState,applySessionFeedback,methodKindSchema,explicitDanger} from './agent-policy'
import type {AgentSessionState} from './agent-policy'

type Executor=Parameters<Database['query']>[1]

// Call only after the current actor's event/domain access has been checked.
export async function loadAgentSessionState(database:Database,eventId:string,domain:Domain,executor?:Executor):Promise<AgentSessionState>{
  const scopeKey=`${domain}:${eventId}`
  const parse=(row?:{state:unknown})=>{
    const parsed=row?sessionStateSchema.safeParse(row.state):null
    // Unknown or mis-scoped persisted state must not silently remove a previous safety restriction.
    return parsed?.success&&parsed.data.scope_key===scopeKey?parsed.data:{...initialSessionState(scopeKey),safety_state:row?'review_required' as const:'unassessed' as const}
  }
  const [latest]=await database.query<{state:unknown;status:string}>(sql`SELECT checkpoint->'session_state' AS state,status FROM agent_runs WHERE event_id=${eventId} AND domain=${domain} AND checkpoint ? 'session_state' AND checkpoint->'session_state'<>'null'::jsonb ORDER BY created_at DESC LIMIT 1`,executor)
  let state=parse(latest)
  if(latest&&latest.status!=='complete'&&!['blocked','review_required'].includes(state.safety_state)){
    const [completed]=await database.query<{state:unknown}>(sql`SELECT checkpoint->'session_state' AS state FROM agent_runs WHERE event_id=${eventId} AND domain=${domain} AND status='complete' AND checkpoint ? 'session_state' AND checkpoint->'session_state'<>'null'::jsonb ORDER BY created_at DESC LIMIT 1`,executor)
    state=parse(completed)
  }
  if(domain!=='private')return state
  const feedback=await database.query<{kind:'agent_method_started'|'agent_method_declined';value:{method:unknown;context_version:number}}>(sql`SELECT kind,value FROM revisions WHERE event_id=${eventId} AND kind IN ('agent_method_started','agent_method_declined') AND (value->>'context_version')::bigint>${state.context_version} ORDER BY (value->>'context_version')::bigint`,executor)
  return applySessionFeedback(state,feedback.map(f=>({kind:f.kind,method:methodKindSchema.parse(f.value.method),context_version:f.value.context_version})))
}

async function assertSafetyAllowsAction(database:Database,eventId:string,domain:Domain,executor?:Executor){
  const state=await loadAgentSessionState(database,eventId,domain,executor)
  const [latest]=await database.query<{id:string;content:string;answered:boolean}>(sql`SELECT m.id::text,m.content,EXISTS(SELECT 1 FROM messages a WHERE a.event_id=m.event_id AND a.domain=m.domain AND a.role='assistant' AND a.status='complete' AND a.in_reply_to=m.id) AS answered FROM messages m WHERE m.event_id=${eventId} AND m.domain=${domain} AND m.role='user' AND m.status='complete' ORDER BY m.id DESC LIMIT 1`,executor)
  if(['blocked','review_required'].includes(state.safety_state)||latest&&explicitDanger(latest.content))throw new HttpError(409,'当前需要优先核实安全与现实支持，暂时不能开始练习、邀请或分享。你仍可以继续表达和寻求支持。')
  if(latest&&!latest.answered&&state.last_message_id!==latest.id)throw new HttpError(409,'Reso 还未完成最新消息的安全核对，请等待本轮判断或重试回复。')
}

export async function assertSafetyAllowsPractice(database:Database,eventId:string,executor?:Executor){
  await assertSafetyAllowsAction(database,eventId,'private',executor)
}

export async function assertSafetyAllowsSharing(database:Database,eventId:string,executor?:Executor){
  await assertSafetyAllowsAction(database,eventId,'private',executor)
  await assertSafetyAllowsAction(database,eventId,'room',executor)
}

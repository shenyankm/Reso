import { sql } from './db'
import type { Database } from './db'
import type { ChatMessage, Domain, EventRecord, Exercise } from '../shared/types'
import { createPermissions } from './permissions'
import { HttpError } from './http'
import { readUnderstandings } from './understandings'
import {loadAgentSessionState} from './agent-state'

export type ReplyJob = { eventId: string; domain: Domain; actorId: string;methodOffers?:boolean }

export function serializeAgentContext(value:Record<string,unknown>){
  const context:Record<string,unknown>={...value,context_window_truncated:false}
  const groups=['messages','followups','understandings','perspectives'] as const
  for(const key of groups)context[key]=[...(value[key] as unknown[]||[])]
  const text=JSON.stringify(context)
  if(text.length<=32000)return text
  context.context_window_truncated=true
  // Switching false to true removes one character from the original JSON.
  let size=text.length-1
  const lengths=Object.fromEntries(groups.map(key=>[key,(context[key] as unknown[]).map(item=>JSON.stringify(item)?.length??4)])) as Record<typeof groups[number],number[]>
  function remove(key:typeof groups[number],first=false){
    const rows=context[key] as unknown[]
    size-=(first?lengths[key].shift()!:lengths[key].pop()!)+(rows.length>1?1:0)
    if(first)rows.shift();else rows.pop()
  }
  do{
    const messages=context.messages as unknown[],followups=context.followups as unknown[],understandings=context.understandings as unknown[],perspectives=context.perspectives as unknown[]
    if(messages.length>1)remove('messages',true)
    else if(context.exercise&&!(context.exercise as {available_via?:string}).available_via){
      const next={available_via:'read_practice',paused:(context.exercise as {paused?:boolean}).paused}
      size+=JSON.stringify(next).length-JSON.stringify(context.exercise).length;context.exercise=next
    }else if(followups.length)remove('followups')
    else if(understandings.length>2)remove('understandings')
    else if(perspectives.length)remove('perspectives')
    else throw Error('AGENT_CONTEXT_TOO_LARGE')
  }while(size>32000)
  return JSON.stringify(context)
}

export async function loadAgentContext(database: Database, job: ReplyJob) {
  const { query } = database
  const permissions=createPermissions(database)
  let event:EventRecord
  try { event=await (job.domain==='private'?permissions.requireEventOwner:permissions.requireRoomParticipant)(job.eventId,job.actorId) }
  catch(error){if(error instanceof HttpError&&(error.statusCode===403||error.statusCode===404))return;throw error}
  const history = (await query<ChatMessage>(sql`SELECT * FROM messages WHERE event_id=${job.eventId} AND domain=${job.domain} AND status='complete' ORDER BY id DESC LIMIT 60`)).reverse()
  const lastUser = history.filter(m => m.role === 'user').at(-1)
  if (!lastUser) return
  if (history.some(m => m.role === 'assistant' && m.in_reply_to === lastUser.id)) return
  if((await query(sql`SELECT 1 FROM agent_runs WHERE event_id=${job.eventId} AND domain=${job.domain} AND trigger_message_id=${lastUser.id} AND status='complete' LIMIT 1`)).length)return
  const version = job.domain === 'private' ? event.private_version : event.room_version
  const sessionState=await loadAgentSessionState(database,job.eventId,job.domain)
  const snapshots = job.domain === 'room' ? await query(sql`SELECT s.content,s.source_version AS version FROM share_snapshots s JOIN share_grants g ON g.snapshot_id=s.id JOIN members m ON m.event_id=g.event_id AND m.user_id=g.recipient_id WHERE s.event_id=${job.eventId} AND g.revoked_at IS NULL AND m.active GROUP BY s.id HAVING count(*)=(SELECT count(*) FROM members WHERE event_id=${job.eventId} AND active)`) : []
  const perspectives = await query<{user_id:string;text:string;confirmed:boolean;version:number}>(sql`SELECT p.user_id,p.text,p.confirmed,p.version FROM perspectives p WHERE p.event_id=${job.eventId} AND (p.user_id=${event.owner_id} OR EXISTS(SELECT 1 FROM members m WHERE m.event_id=p.event_id AND m.user_id=p.user_id AND m.active)) ORDER BY (p.user_id=${job.actorId}) DESC,p.user_id LIMIT 13`)
  const exercise=job.domain==='private'?(await query<Exercise>(sql`SELECT act,paused,notes,story,saved,practice_notes FROM exercises WHERE event_id=${job.eventId}`))[0]||null:null
  const followups=job.domain==='private'?await query(sql`SELECT reflection,next_step,review_at,reviewed_at FROM followups WHERE event_id=${job.eventId} AND user_id=${job.actorId} ORDER BY created_at DESC LIMIT 10`):[]
  const understandings=await readUnderstandings(database,job.eventId,job.domain)
  const recentActions=job.domain==='private'?await query(sql`SELECT proposal->>'kind' AS kind,status FROM agent_actions WHERE event_id=${job.eventId} ORDER BY created_at DESC LIMIT 5`):[]
  const context = serializeAgentContext({ domain: job.domain, session_state:sessionState, event: job.domain === 'private' ? { title: event.title, user_confirmed_summary: event.summary, initial_summary: event.initial_summary } : { title: event.room_title || '一起聊聊', shared_snapshots: snapshots }, exercise:exercise?{...exercise,story:String(exercise.story||'').slice(0,1000),notes:Object.fromEntries(Object.entries(exercise.notes as Record<string,string>||{}).map(([k,v])=>[k,v.slice(0,500)])),practice_notes:Object.fromEntries(Object.entries(exercise.practice_notes as Record<string,Record<string,string>>||{}).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).slice(0,8).map(([key,text])=>[key,text.slice(0,500)]))])),excerpts:true}:null,followups:followups.slice(0,5),understandings:understandings.map(u=>({...u,source_author_name:u.source_author_name.slice(0,80),confirmations:u.confirmations.slice(0,8),confirmation_count:u.confirmations.length,content:u.content.slice(0,300),truncated:u.content.length>300||u.confirmations.length>8})),recent_actions:recentActions,history_window:{included:Math.min(history.length,12),search_available:true},perspectives: job.domain === 'room' ? perspectives.slice(0,12).map(p=>({...p,text:String((p as {text:string}).text).slice(0,1000)})) : [],perspectives_truncated:perspectives.length>12, messages: history.slice(-12).map(m => ({ id: m.id, speaker: m.author_name.slice(0,80), role: m.role, text: m.content.slice(0,m.id===lastUser.id?4000:1200),truncated:m.content.length>(m.id===lastUser.id?4000:1200) })) })
  return { lastUser, version, context, history,sessionState }
}

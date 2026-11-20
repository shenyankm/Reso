import {findConsultants} from './consultants'
import {z} from 'zod'
import {sql} from './db'
import type {Database} from './db'
import type {ReplyJob} from './agent-context'
import {createPermissions} from './permissions'
import {methodKindSchema} from '../shared/agent'
import {methodCards,followupGuide} from '../shared/methods'

export const toolSchema=z.discriminatedUnion('name',[
  z.object({name:z.literal('search_history'),query:z.string().trim().min(1).max(80)}).strict(),
  z.object({name:z.literal('read_practice'),kind:z.enum(['story','nvc','roleplay'])}).strict(),
  z.object({name:z.literal('read_understandings')}).strict(),
  z.object({name:z.literal('find_support'),need:z.string().trim().max(80)}).strict(),
  z.object({name:z.literal('practice_guide'),kind:z.enum(['narrative','nvc','roleplay','followup'])}).strict(),
  z.object({name:z.literal('retrieve_methods'),kind:methodKindSchema}).strict(),
])
export type ToolRequest=z.infer<typeof toolSchema>
export type ToolObservation={request:ToolRequest;result:unknown;source_ids:string[];user_source_ids:string[]}
export type AgentTools=(request:ToolRequest)=>Promise<ToolObservation>
export const toolDescriptions=`只读工具（只限当前事件和会话域，不接受 eventId、SQL、URL）：
search_history {query}：查找当前域最近60条以外或需要核对的原话，最多8条，含消息ID、角色与截断标记。
read_practice {kind:story|nvc|roleplay}：读取本人已保存的故事或练习，私聊可用。
read_understandings {}：读取当前版本的理解、修正及确认状态，不把单方确认说成共同事实。
find_support {need}：查询当前可见且核验过的真人支持目录，私聊可用；空结果就如实说明，没有执行申请。
retrieve_methods {kind:narrative|nvc|roleplay}：定向读取版本化产品方法卡，含适用、禁忌、步骤和来源状态；不是已获临床审核的治疗方案。
practice_guide {kind:narrative|nvc|roleplay|followup}：读取本应用表达练习的步骤与边界。提供具体练习前先读取，不能宣称专业疗效。`

export function createAgentTools(database:Database,job:ReplyJob,version:number):AgentTools{
  const {query}=database,permissions=createPermissions(database)
  return async raw=>{
    const request=toolSchema.parse(raw)
    const event=await(job.domain==='private'?permissions.requireEventOwner:permissions.requireRoomParticipant)(job.eventId,job.actorId)
    if((job.domain==='private'?event.private_version:event.room_version)!==version)throw Error('CONTEXT_CHANGED')
    if(job.domain==='room'&&['read_practice','find_support','practice_guide','retrieve_methods'].includes(request.name))return{request,result:{error:'TOOL_NOT_ALLOWED'},source_ids:[],user_source_ids:[]}
    let result:unknown,source_ids:string[]=[],user_source_ids:string[]=[]
    if(request.name==='search_history'){
      const rows=await query<{id:string;author_name:string;role:string;content:string}>(sql`SELECT id::text,author_name,role,content FROM messages WHERE event_id=${job.eventId} AND domain=${job.domain} AND status='complete' AND position(lower(${request.query}) in lower(content))>0 ORDER BY id DESC LIMIT 8`)
      source_ids=rows.map(r=>r.id);user_source_ids=rows.filter(r=>r.role==='user').map(r=>r.id)
      result=rows.reverse().map(r=>({...r,author_name:r.author_name.slice(0,80),content:r.content.slice(0,800),truncated:r.content.length>800}))
    }else if(request.name==='read_practice'){
      const [exercise]=await query<{story:string;saved:boolean;practice_notes:Record<string,unknown>}>(sql`SELECT story,saved,practice_notes FROM exercises WHERE event_id=${job.eventId}`)
      const value=request.kind==='story'?(exercise?.saved?exercise.story:null):exercise?.practice_notes[request.kind]||null
      const text=JSON.stringify(value)
      result={kind:request.kind,value:text.length>8000?text.slice(0,8000):value,truncated:text.length>8000,provenance:'user_saved',hypothetical:request.kind==='roleplay'}
    }else if(request.name==='read_understandings'){
      const {readUnderstandings}=await import('./understandings')
      result=(await readUnderstandings(database,job.eventId,job.domain)).slice(0,8).map(r=>({...r,source_author_name:r.source_author_name.slice(0,80),confirmations:r.confirmations.slice(0,8),confirmation_count:r.confirmations.length,content:r.content.slice(0,300),truncated:r.content.length>300||r.confirmations.length>8}))
    }else if(request.name==='find_support'){
      const rows=await findConsultants(database,request.need.trim())
      result=rows.map(r=>({id:r.id,name:r.name.slice(0,80),approach:r.approach.slice(0,300),price:r.price.slice(0,80),specialties:r.specialties.slice(0,8).map(s=>s.slice(0,80)),matches:r.matches,test_only:r.test_only}))
    }else if(request.name==='retrieve_methods')result=methodCards[request.kind]
    else result=request.kind==='followup'?followupGuide:methodCards[request.kind]
    return{request,result,source_ids,user_source_ids}
  }
}

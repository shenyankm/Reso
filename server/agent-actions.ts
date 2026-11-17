import type {FastifyInstance} from 'fastify'
import {z} from 'zod'
import {sql} from './db'
import type {Database} from './db'
import type {RouteContext} from './context'
import {eventId,uuid,HttpError} from './http'
import {proposalSchema} from '../shared/agent'
import type {AgentAction,AgentProposal} from '../shared/agent'
import type {MethodKind} from '../shared/agent'
import {assertSafetyAllowsPractice} from './agent-state'

export async function readAgentActions(database:Database,id:string,messageIds:string[]){
  if(!messageIds.length)return[]
  const rows=await database.query<{id:string;message_id:string;status:AgentAction['status'];created_at:string;proposal:AgentProposal;sources:{content:string}[]}>(sql`SELECT a.id,a.message_id::text,CASE WHEN a.status='pending' AND a.base_version<>e.private_version THEN 'stale' ELSE a.status END AS status,a.created_at,a.proposal,coalesce((SELECT jsonb_agg(jsonb_build_object('content',left(m.content,500))) FROM messages m WHERE m.event_id=a.event_id AND m.domain='private' AND m.role='user' AND a.proposal->'source_ids' ? m.id::text),'[]'::jsonb) AS sources FROM agent_actions a JOIN events e ON e.id=a.event_id WHERE a.event_id=${id} AND a.message_id IN (${sql.join(messageIds.map(id=>sql`${id}`),sql`,`)}) ORDER BY a.slot`)
  return rows.flatMap(({proposal,...row})=>{const parsed=proposalSchema.safeParse(proposal);return parsed.success?[{...row,...parsed.data}]:[]})
}

export function registerAgentActions(app:FastifyInstance,context:RouteContext){
  const {database,requireEventOwner,revision,notify}=context,{query,db}=database
  app.post('/api/events/:id/agent-actions/:actionId',async request=>{
    const id=eventId(request),userId=request.resoUser!.id,actionId=uuid.parse((request.params as {actionId:string}).actionId)
    const input=z.object({decision:z.enum(['apply','dismiss']),value:z.record(z.string(),z.string()).optional()}).strict().parse(request.body)
    let startedMethod:MethodKind|undefined
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      const event=await requireEventOwner(id,userId,tx)
      const [action]=await query<{status:string;base_version:number;proposal:AgentProposal}>(sql`SELECT status,base_version,proposal FROM agent_actions WHERE id=${actionId} AND event_id=${id} FOR UPDATE`,tx)
      if(!action)throw new HttpError(404,'这份建议已不存在')
      const stored=proposalSchema.parse(action.proposal)
      if(stored.kind==='method'&&input.decision==='apply'){
        if(input.value)throw new HttpError(400,'请按这份推荐选择是否尝试；修改记录需要另行确认')
        await assertSafetyAllowsPractice(database,id,tx)
        startedMethod=stored.value.method
      }
      if(action.status!=='pending'){
        if(action.status===(input.decision==='apply'?'applied':'dismissed'))return
        throw new HttpError(409,'这份建议已经处理，请刷新后重试')
      }
      if(input.decision==='dismiss'){
        await query(sql`UPDATE agent_actions SET status='dismissed',resolved_at=now() WHERE id=${actionId}`,tx)
        await query(sql`UPDATE events SET private_version=private_version+1,updated_at=now() WHERE id=${id}`,tx)
        await revision(id,userId,stored.kind==='method'?'agent_method_declined':'agent_proposal_dismissed',{actionId,...(stored.kind==='method'?{method:stored.value.method,context_version:event.private_version+1}:{})},tx)
        return
      }
      if(action.base_version!==event.private_version)throw new HttpError(409,'对话或记录已有更新，请告诉 Reso 按最新内容重新整理')
      if(stored.kind!=='method')await assertSafetyAllowsPractice(database,id,tx)
      if(stored.kind==='method'){
        await query(sql`UPDATE agent_actions SET status='applied',resolved_at=now() WHERE id=${actionId}`,tx)
        await query(sql`UPDATE events SET private_version=private_version+1,updated_at=now() WHERE id=${id}`,tx)
        await revision(id,userId,'agent_method_started',{actionId,method:stored.value.method,context_version:event.private_version+1},tx)
        return
      }
      const proposal=proposalSchema.parse({...action.proposal,value:input.value??action.proposal.value})
      if(proposal.kind==='method')throw new HttpError(400,'此方法推荐不能作为记录写入')
      if(proposal.kind==='summary')await query(sql`UPDATE events SET summary=${proposal.value.summary},summary_version=summary_version+1 WHERE id=${id}`,tx)
      else if(proposal.kind==='nvc'){
        await query(sql`INSERT INTO exercises(event_id) VALUES(${id}) ON CONFLICT DO NOTHING`,tx)
        await query(sql`UPDATE exercises SET practice_notes=jsonb_set(practice_notes,'{nvc}',${JSON.stringify(proposal.value)}::jsonb),version=version+1,updated_at=now() WHERE event_id=${id}`,tx)
      }else await query(sql`INSERT INTO followups(event_id,user_id,reflection,next_step) VALUES(${id},${userId},${proposal.value.reflection},${proposal.value.next_step})`,tx)
      await query(sql`UPDATE events SET private_version=private_version+1,updated_at=now() WHERE id=${id}`,tx)
      await query(sql`UPDATE agent_actions SET status='applied',resolved_at=now(),proposal=${JSON.stringify(proposal)}::jsonb WHERE id=${actionId}`,tx)
      await revision(id,userId,'agent_proposal_applied',{actionId,...proposal},tx)
    })
    await notify(id,'private');return startedMethod?{saved:false,startedMethod}:{saved:input.decision==='apply'}
  })
}

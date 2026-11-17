import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db'
import { HttpError, uuid, eventId } from '../http'
import type { RouteContext } from '../context'
import { randomUUID } from 'node:crypto'
import type { Application, Consultant } from '../../shared/types'

type ApplicationRow=Application&{applicant_id:string;counselor_id:string}

export function registerSupport(app: FastifyInstance, context: RouteContext) {
  const { database, requireEventOwner, requireActiveCounselor, revision, notify } = context
  const { query, db } = database
  async function application(id:string,executor:Parameters<typeof query>[1]){
    const [parent]=await query<{event_id:string}>(sql`SELECT event_id FROM applications WHERE id=${id}`,executor)
    if(!parent)throw new HttpError(404,'申请不存在')
    await query(sql`SELECT id FROM events WHERE id=${parent.event_id} FOR UPDATE`,executor)
    const [a]=await query<ApplicationRow>(sql`SELECT a.*,c.user_id AS counselor_id FROM applications a JOIN consultants c ON c.id=a.consultant_id WHERE a.id=${id} FOR UPDATE OF a`,executor)
    if(!a)throw new HttpError(404,'申请不存在')
    return a
  }
  app.get('/api/consultants',async request=>{
    const {need}=z.object({need:z.string().trim().max(80).default('')}).parse(request.query)
    const rows=await query<Consultant>(sql`SELECT id,name,approach,qualifications,price,test_only,specialties,service_modes,availability,verified_at FROM consultants WHERE active AND (test_only OR verified_at IS NOT NULL) ORDER BY test_only,name LIMIT 100`)
    return rows.map(c=>{
      const matches=c.specialties.filter(topic=>need&&need.includes(topic))
      return {...c,score:matches.length,recommendation_reason:c.test_only?'本地测试资料，仅用于验证申请流程':matches.length?`与你选择的方向相关：${matches.join('、')}`:'未找到明确匹配的方向，请先核对擅长领域和服务方式'}
    }).sort((a,b)=>b.score-a.score).slice(0,3)
  })
  app.post('/api/events/:id/applications',async request=>{
    const id=eventId(request),userId=request.resoUser!.id
    const input=z.object({consultantId:uuid,shareSummary:z.boolean(),version:z.number().int().nonnegative(),clientId:uuid}).parse(request.body)
    const result=await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      const event=await requireEventOwner(id,userId,tx)
      if(input.shareSummary&&(input.version!==event.summary_version||!event.summary.trim()))throw new HttpError(409,'请重新核对要分享的摘要')
      if(!(await query(sql`SELECT 1 FROM consultants WHERE id=${input.consultantId} AND active AND (test_only OR verified_at IS NOT NULL) FOR SHARE`,tx)).length)throw new HttpError(409,'该服务当前不可申请')
      const [created]=await query<Application>(sql`INSERT INTO applications(id,client_id,event_id,applicant_id,consultant_id,shared_summary) VALUES(${randomUUID()},${input.clientId},${id},${userId},${input.consultantId},${input.shareSummary?event.summary:null}) ON CONFLICT(client_id) DO NOTHING RETURNING *`,tx)
      if(!created)throw new HttpError(409,'该申请已提交，请查看当前状态')
      return created
    });await notify(id,'private');return result
  })
  app.get('/api/counselor/applications',async request=>{
    await requireActiveCounselor(request.resoUser!.id)
    return query(sql`SELECT a.*,c.name AS consultant_name,u.name AS applicant_name,n.content AS note_content,n.version AS note_version,n.client_visible AS note_visible FROM applications a JOIN consultants c ON c.id=a.consultant_id JOIN "user" u ON u.id=a.applicant_id LEFT JOIN consultation_notes n ON n.application_id=a.id WHERE c.user_id=${request.resoUser!.id} AND c.active ORDER BY a.created_at DESC`)
  })
  app.patch('/api/applications/:id',async request=>{
    const id=uuid.parse((request.params as {id:string}).id),userId=request.resoUser!.id
    const input=z.object({status:z.enum(['accepted','rejected','cancelled','proposed','completed']),scheduledAt:z.string().datetime().optional(),reason:z.string().trim().max(300).default('')}).parse(request.body)
    const event=await db.transaction(async tx=>{
      const a=await application(id,tx)
      if(input.status!=='cancelled')await requireActiveCounselor(userId,tx)
      const allowed=input.status==='cancelled'?a.applicant_id===userId&&['pending','accepted','proposed','scheduled'].includes(a.status):a.counselor_id===userId&&(({accepted:['pending'],rejected:['pending'],proposed:['accepted','proposed','scheduled'],completed:['scheduled']} as Record<string,string[]>)[input.status]||[]).includes(a.status)
      if(!allowed)throw new HttpError(403,'当前身份或申请状态不允许此操作')
      if(input.status==='proposed'&&(!input.scheduledAt||new Date(input.scheduledAt)<=new Date()))throw new HttpError(400,'请选择未来的咨询时间')
      if(input.status==='completed'&&(!a.scheduled_at||new Date(a.scheduled_at)>new Date()))throw new HttpError(409,'预约时间尚未到，不能标记完成')
      await query(sql`UPDATE applications SET status=${input.status},proposed_at=${input.status==='proposed'?input.scheduledAt!:null},schedule_version=schedule_version+1,rejection_reason=${input.status==='rejected'?input.reason:''},shared_summary=${input.status==='cancelled'?null:a.shared_summary} WHERE id=${id}`,tx)
      if(input.status==='cancelled')await query(sql`UPDATE note_shares SET revoked_at=now() WHERE application_id=${id} AND revoked_at IS NULL`,tx)
      await revision(a.event_id,userId,'application_status',{id,status:input.status,scheduledAt:input.scheduledAt,reason:input.reason},tx)
      return a.event_id
    });await notify(event,'private');return{saved:true}
  })
  app.post('/api/applications/:id/appointment-response',async request=>{
    const id=uuid.parse((request.params as {id:string}).id),userId=request.resoUser!.id
    const input=z.object({accepted:z.boolean(),version:z.number().int().nonnegative()}).parse(request.body)
    const event=await db.transaction(async tx=>{
      const a=await application(id,tx)
      if(a.applicant_id!==userId)throw new HttpError(403,'只有申请人能确认时间')
      if(a.status!=='proposed'||a.schedule_version!==input.version)throw new HttpError(409,'时间提议已更新，请重新核对')
      if(input.accepted&&(!a.proposed_at||new Date(a.proposed_at)<=new Date()))throw new HttpError(409,'提议时间已经过期，请重新协商')
      if(input.accepted)await requireActiveCounselor(a.counselor_id,tx)
      const status=input.accepted?'scheduled':a.scheduled_at?'scheduled':'accepted'
      await query(sql`UPDATE applications SET status=${status},scheduled_at=${input.accepted?a.proposed_at:a.scheduled_at},proposed_at=NULL,schedule_version=schedule_version+1 WHERE id=${id}`,tx)
      await revision(a.event_id,userId,'appointment_response',{id,...input},tx);return a.event_id
    });await notify(event,'private');return{saved:true}
  })
  app.delete('/api/applications/:id/share',async request=>{
    const id=uuid.parse((request.params as {id:string}).id),userId=request.resoUser!.id
    const rows=await query(sql`UPDATE applications SET shared_summary=NULL WHERE id=${id} AND applicant_id=${userId} RETURNING id`)
    if(!rows.length)throw new HttpError(404,'申请不存在或无权操作')
    return{revoked:true}
  })
  app.put('/api/applications/:id/note',async request=>{
    const id=uuid.parse((request.params as {id:string}).id),userId=request.resoUser!.id
    const input=z.object({content:z.string().trim().min(1).max(5000),clientVisible:z.boolean(),version:z.number().int().nonnegative()}).parse(request.body)
    const event=await db.transaction(async tx=>{
      const a=await application(id,tx);await requireActiveCounselor(userId,tx)
      if(a.counselor_id!==userId||!['scheduled','completed'].includes(a.status))throw new HttpError(403,'仅当前服务的咨询人员可填写纪要')
      const [previous]=await query<{version:number}>(sql`SELECT version FROM consultation_notes WHERE application_id=${id}`,tx)
      if((previous?.version||0)!==input.version)throw new HttpError(409,'纪要已有新版本，请刷新后修改')
      await query(sql`INSERT INTO consultation_notes(application_id,author_id,content,client_visible) VALUES(${id},${userId},${input.content},${input.clientVisible}) ON CONFLICT(application_id) DO UPDATE SET content=excluded.content,client_visible=excluded.client_visible,version=consultation_notes.version+1,updated_at=now()`,tx)
      await revision(a.event_id,userId,'consultation_note_saved',{id,clientVisible:input.clientVisible,version:input.version+1},tx);return a.event_id
    });await notify(event,'private');return{saved:true}
  })
  app.post('/api/applications/:id/note-shares',async request=>{
    const id=uuid.parse((request.params as {id:string}).id),userId=request.resoUser!.id
    const input=z.object({recipientId:z.string().min(1).max(100),version:z.number().int().positive()}).parse(request.body)
    const event=await db.transaction(async tx=>{
      const a=await application(id,tx)
      await query(sql`SELECT id FROM events WHERE id=${a.event_id} FOR UPDATE`,tx)
      if(a.applicant_id!==userId)throw new HttpError(403,'只有申请人能分享纪要')
      const [note]=await query<{content:string;version:number}>(sql`SELECT content,version FROM consultation_notes WHERE application_id=${id} AND client_visible FOR SHARE`,tx)
      if(!note||note.version!==input.version)throw new HttpError(409,'请核对当前可见的纪要版本')
      if(!(await query(sql`SELECT 1 FROM members WHERE event_id=${a.event_id} AND user_id=${input.recipientId} AND active`,tx)).length)throw new HttpError(403,'只能向当前房间成员分享')
      const [current]=await query<{source_version:number}>(sql`SELECT source_version FROM note_shares WHERE application_id=${id} AND recipient_id=${input.recipientId} AND revoked_at IS NULL`,tx)
      if(current?.source_version===input.version)return a.event_id
      await query(sql`UPDATE note_shares SET revoked_at=now() WHERE application_id=${id} AND recipient_id=${input.recipientId} AND revoked_at IS NULL`,tx)
      await query(sql`INSERT INTO note_shares(application_id,recipient_id,granted_by,content,source_version) VALUES(${id},${input.recipientId},${userId},${note.content},${note.version})`,tx)
      await revision(a.event_id,userId,'note_shared',{id,recipient:input.recipientId,version:input.version},tx);return a.event_id
    });await notify(event,'private');return{saved:true}
  })
  app.delete('/api/applications/:id/note-shares/:recipientId',async request=>{
    const id=uuid.parse((request.params as {id:string}).id),userId=request.resoUser!.id,recipient=z.string().min(1).max(100).parse((request.params as {recipientId:string}).recipientId)
    const [a]=await query<{event_id:string}>(sql`SELECT event_id FROM applications WHERE id=${id} AND applicant_id=${userId}`)
    if(!a)throw new HttpError(403,'只有申请人能撤回纪要分享')
    await query(sql`UPDATE note_shares SET revoked_at=now() WHERE application_id=${id} AND recipient_id=${recipient} AND revoked_at IS NULL`)
    await notify(a.event_id,'private');return{revoked:true}
  })
}

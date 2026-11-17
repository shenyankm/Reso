import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from './db'
import type { Database } from './db'
import type { RouteContext } from './context'
import type { Domain, Understanding } from '../shared/types'
import { HttpError, domainSchema, eventId, uuid } from './http'

export async function readUnderstandings(database:Database,id:string,domain:Domain):Promise<Understanding[]> {
  const participants=await database.query<{user_id:string}>(sql`SELECT owner_id AS user_id FROM events WHERE id=${id} UNION SELECT user_id FROM members WHERE event_id=${id} AND active AND ${domain}='room'`)
  const required=new Set(participants.map(p=>p.user_id))
  // shortcut: show the latest 40 entries; add pagination when longer ledgers are needed.
  const rows=await database.query<Understanding>(sql`SELECT u.*,m.author_id AS source_author_id,m.author_name AS source_author_name,coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',c.user_id,'agreed',c.agreed,'confirmed_at',c.confirmed_at)) FROM understanding_confirmations c WHERE c.understanding_id=u.id AND c.version=u.version),'[]'::jsonb) AS confirmations FROM understandings u JOIN messages m ON m.id=u.source_message_id WHERE u.event_id=${id} AND u.domain=${domain} ORDER BY u.created_at DESC LIMIT 40`)
  return rows.map(row=>{
    const current=row.confirmations.filter(c=>required.has(c.user_id))
    const status=current.some(c=>!c.agreed)?'disputed':current.length===required.size&&required.size>1?'jointly_confirmed':current.some(c=>c.agreed)?'participant_confirmed':'unconfirmed'
    return {...row,confirmations:current,status}
  })
}

export function registerUnderstandings(app:FastifyInstance,context:RouteContext){
  const {database,requireEventOwner,requireRoomParticipant,revision,notify}=context
  const {query,db}=database
  const access=(domain:Domain)=>(domain==='private'?requireEventOwner:requireRoomParticipant)
  async function touch(id:string,domain:Domain,tx:Parameters<typeof query>[1]){
    if(domain==='private')await query(sql`UPDATE events SET private_version=private_version+1 WHERE id=${id}`,tx)
    else await query(sql`UPDATE events SET room_version=room_version+1,room_updated_at=now() WHERE id=${id}`,tx)
  }
  app.post('/api/events/:id/understandings',async request=>{
    const id=eventId(request),userId=request.resoUser!.id
    const input=z.object({domain:domainSchema,sourceMessageId:z.string().regex(/^\d+$/)}).parse(request.body)
    const result=await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      await access(input.domain)(id,userId,tx)
      const [source]=await query<{content:string;role:string}>(sql`SELECT content,role FROM messages WHERE id=${input.sourceMessageId} AND event_id=${id} AND domain=${input.domain} AND status='complete'`,tx)
      if(!source)throw new HttpError(404,'原始消息不存在或不在当前会话中')
      const [row]=await query<{id:string}>(sql`INSERT INTO understandings(event_id,domain,author_id,source_message_id,content,provenance) VALUES(${id},${input.domain},${userId},${input.sourceMessageId},${source.content},${source.role==='assistant'?'model_inference':'user_quoted'}) ON CONFLICT(event_id,domain,source_message_id) DO NOTHING RETURNING id`,tx)
      if(!row)return{saved:true}
      await revision(id,userId,'understanding_created',{id:row.id,sourceMessageId:input.sourceMessageId},tx)
      await touch(id,input.domain,tx);return{saved:true}
    });await notify(id,input.domain);return result
  })
  app.patch('/api/events/:id/understandings/:understandingId',async request=>{
    const id=eventId(request),userId=request.resoUser!.id,entryId=uuid.parse((request.params as {understandingId:string}).understandingId)
    const input=z.object({content:z.string().trim().min(1).max(4000),version:z.number().int().positive()}).parse(request.body)
    const domain=await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      const [entry]=await query<Understanding>(sql`SELECT * FROM understandings WHERE id=${entryId} AND event_id=${id} FOR UPDATE`,tx)
      if(!entry)throw new HttpError(404,'这条理解不存在')
      await access(entry.domain)(id,userId,tx)
      if(entry.author_id!==userId)throw new HttpError(403,'只能修改自己整理的理解；你也可以表示不同意')
      if(entry.version!==input.version)throw new HttpError(409,'理解已有新版本，请刷新后核对')
      await query(sql`UPDATE understandings SET content=${input.content},provenance='user_corrected',version=version+1 WHERE id=${entryId}`,tx)
      await revision(id,userId,'user_corrected',{kind:'understanding',id:entryId,...input},tx)
      await touch(id,entry.domain,tx);return entry.domain
    });await notify(id,domain);return{saved:true}
  })
  app.post('/api/events/:id/understandings/:understandingId/confirm',async request=>{
    const id=eventId(request),userId=request.resoUser!.id,entryId=uuid.parse((request.params as {understandingId:string}).understandingId)
    const input=z.object({agreed:z.boolean(),version:z.number().int().positive()}).parse(request.body)
    const domain=await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      const [entry]=await query<Understanding>(sql`SELECT * FROM understandings WHERE id=${entryId} AND event_id=${id} FOR UPDATE`,tx)
      if(!entry)throw new HttpError(404,'这条理解不存在')
      await access(entry.domain)(id,userId,tx)
      if(entry.version!==input.version)throw new HttpError(409,'理解已修改，请确认当前版本')
      await query(sql`INSERT INTO understanding_confirmations(understanding_id,user_id,version,agreed) VALUES(${entryId},${userId},${input.version},${input.agreed}) ON CONFLICT(understanding_id,user_id,version) DO UPDATE SET agreed=excluded.agreed,confirmed_at=now()`,tx)
      await revision(id,userId,input.agreed?'participant_confirmed':'understanding_disputed',{kind:'understanding',id:entryId,...input},tx)
      await touch(id,entry.domain,tx);return entry.domain
    });await notify(id,domain);return{saved:true}
  })
}

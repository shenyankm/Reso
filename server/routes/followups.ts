import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db'
import type { RouteContext } from '../context'
import { eventId,HttpError,uuid } from '../http'

export function registerFollowups(app:FastifyInstance,context:RouteContext){
  const {database,requireEventOwner,revision,notify}=context
  const {query,db}=database
  // shortcut: global history shows 100 entries; add pagination when growth history exceeds this.
  app.get('/api/followups',async request=>query(sql`SELECT f.*,e.title AS event_title FROM followups f JOIN events e ON e.id=f.event_id WHERE f.user_id=${request.resoUser!.id} AND e.owner_id=${request.resoUser!.id} ORDER BY f.created_at DESC LIMIT 100`))
  app.get('/api/followups/reminders',async request=>query(sql`
    SELECT f.id,(extract(epoch FROM f.review_at)*1000)::double precision AS at FROM followups f JOIN events e ON e.id=f.event_id
    WHERE f.user_id=${request.resoUser!.id} AND e.owner_id=f.user_id AND f.reviewed_at IS NULL
      AND f.review_at>=now()-interval '1 day'
    ORDER BY f.review_at,f.id LIMIT 100
  `))
  app.post('/api/events/:id/followups',async request=>{
    const id=eventId(request),userId=request.resoUser!.id
    const input=z.object({id:uuid,reflection:z.string().trim().min(1).max(2000),nextStep:z.string().trim().max(1000),reviewAt:z.string().datetime().nullable()}).parse(request.body)
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx);await requireEventOwner(id,userId,tx)
      const [existing]=await query<{event_id:string;user_id:string;reflection:string;next_step:string;review_at:string|Date|null}>(sql`SELECT * FROM followups WHERE id=${input.id}`,tx)
      if(existing){
        if(existing.event_id!==id||existing.user_id!==userId||existing.reflection!==input.reflection||existing.next_step!==input.nextStep||(existing.review_at?new Date(existing.review_at).toISOString():null)!==(input.reviewAt?new Date(input.reviewAt).toISOString():null))throw new HttpError(409,'记录标识与原内容不一致')
        return
      }
      await query(sql`INSERT INTO followups(id,event_id,user_id,reflection,next_step,review_at) VALUES(${input.id},${id},${userId},${input.reflection},${input.nextStep},${input.reviewAt})`,tx)
      await query(sql`UPDATE events SET private_version=private_version+1 WHERE id=${id}`,tx)
      await revision(id,userId,'followup_saved',{id:input.id},tx)
    });await notify(id,'private');return{saved:true}
  })
  app.post('/api/events/:id/followups/:followupId/review',async request=>{
    const id=eventId(request),userId=request.resoUser!.id,followupId=uuid.parse((request.params as {followupId:string}).followupId)
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx);await requireEventOwner(id,userId,tx)
      const rows=await query(sql`UPDATE followups SET reviewed_at=coalesce(reviewed_at,now()) WHERE id=${followupId} AND event_id=${id} AND user_id=${userId} RETURNING id`,tx)
      if(!rows.length)throw new HttpError(404,'回访记录不存在')
      await query(sql`UPDATE events SET private_version=private_version+1 WHERE id=${id}`,tx)
    });await notify(id,'private');return{saved:true}
  })
}

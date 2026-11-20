import {assertSafetyAllowsSharing} from '../agent-state'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db'
import { HttpError, uuid, text, eventId } from '../http'
import type { RouteContext } from '../context'
import { createHash, randomBytes } from 'node:crypto'
import type { EventRecord } from '../../shared/types'
import { shareSnapshot, replaceShareGrant } from '../shares'
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export function registerSharing(app: FastifyInstance, context: RouteContext) {
  const { database, requireEventOwner, requireRoomParticipant, requireOpenRoom, revision, notify } = context
  const { query, db } = database
  async function readInvitation(value:unknown){
    const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(value)
    const [invite]=await query<{event_id:string;title:string;status:string;expires_at:string;has_summary:boolean}>(sql`SELECT i.event_id,e.room_title AS title,i.status,i.expires_at,(i.snapshot_id IS NOT NULL) AS has_summary FROM invites i JOIN events e ON e.id=i.event_id WHERE i.token_hash=${hash(token)}`)
    if(!invite)throw new HttpError(404,'邀请不存在')
    if(invite.status!=='pending'||new Date(invite.expires_at)<new Date())throw new HttpError(410,'邀请已使用、取消或过期')
    return invite
  }
  app.post('/api/events/:id/close-room',async request=>{
    const id=eventId(request),userId=request.resoUser!.id
    const changed=await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      const event=await requireEventOwner(id,userId,tx)
      if(event.room_closed_at)return false
      if(!event.room_title)throw new HttpError(409,'还没有可以结束的会谈')
      await query(sql`UPDATE events SET room_closed_at=now(),room_version=room_version+1,room_updated_at=now() WHERE id=${id}`,tx)
      await query(sql`UPDATE invites SET status='cancelled' WHERE event_id=${id} AND status='pending'`,tx)
      await revision(id,userId,'room_closed',{},tx)
      return true
    })
    if(changed)await notify(id,'room')
    return {closed:true}
  })
  app.post('/api/events/:id/invites',async request=>{
    const id=eventId(request),event=await requireEventOwner(id,request.resoUser!.id)
    const input=z.object({shareSummary:z.boolean(),version:z.number().int().nonnegative(),clientId:uuid}).parse(request.body)
    if(input.version!==event.summary_version)throw new HttpError(409,'摘要已更新，请重新核对后邀请')
    if(input.shareSummary&&!event.summary.trim())throw new HttpError(400,'请先填写并确认要分享的摘要')
    const token=randomBytes(32).toString('base64url'),inviteId=input.clientId
    const rows=await db.transaction(async tx=>{
      const [fresh]=await query<EventRecord>(sql`SELECT * FROM events WHERE id=${id} FOR UPDATE`,tx)
      if(!fresh||fresh.summary_version!==input.version)throw new HttpError(409,'记录已更新，请重新核对后邀请')
      if(fresh.room_closed_at)throw new HttpError(409,'会谈已结束，无法发出新邀请')
      await assertSafetyAllowsSharing(database,id,tx)
      await query(sql`UPDATE events SET room_title=CASE WHEN room_title='' THEN title ELSE room_title END WHERE id=${id}`,tx)
      const snapshotId = input.shareSummary ? await shareSnapshot(database, fresh, tx) : null
      return query(sql`INSERT INTO invites(id,event_id,token_hash,snapshot_id,expires_at) VALUES(${inviteId},${id},${hash(token)},${snapshotId},now()+interval '7 days') ON CONFLICT(id) DO NOTHING RETURNING id`,tx)
    })
    if(!rows.length)throw new HttpError(409,'此邀请已生成，请查看邀请状态；如未保存链接，可取消旧邀请后重新生成')
    return{id:inviteId,token,expiresInDays:7}
  })
  app.get('/api/invites/:token',async request=>{
    const {title,status,expires_at,has_summary}=await readInvitation((request.params as {token:string}).token)
    return{title,status,expires_at,has_summary}
  })
  app.get('/api/invites/:token/details',async request=>{
    const invite=await readInvitation((request.params as {token:string}).token)
    const [owner]=await query<{name:string}>(sql`SELECT u.name FROM events e JOIN "user" u ON u.id=e.owner_id WHERE e.id=${invite.event_id}`)
    const members=await query<{name:string}>(sql`SELECT u.name FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.event_id=${invite.event_id} AND m.active ORDER BY m.joined_at,m.user_id`)
    return{title:invite.title,has_summary:invite.has_summary,inviter_name:owner.name,member_names:members.map(member=>member.name)}
  })
  app.post('/api/invites/:token/respond',async request=>{
    const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse((request.params as {token:string}).token),userId=request.resoUser!.id
    const {accept}=z.object({accept:z.boolean()}).parse(request.body)
    const result=await db.transaction(async tx=>{
      const tokenHash=hash(token)
      const [match]=await query<{event_id:string}>(sql`SELECT event_id FROM invites WHERE token_hash=${tokenHash}`,tx)
      if(!match)throw new HttpError(404,'邀请不存在')
      await query(sql`SELECT id FROM events WHERE id=${match.event_id} FOR UPDATE`,tx)
      const [invite]=await query<{id:string;event_id:string;snapshot_id:string|null;owner_id:string;status:string;recipient_id:string|null;expires_at:string}>(sql`SELECT i.*,e.owner_id FROM invites i JOIN events e ON e.id=i.event_id WHERE i.token_hash=${tokenHash} FOR UPDATE OF i`,tx)
      if(!invite)throw new HttpError(404,'邀请不存在')
      if(invite.owner_id===userId)throw new HttpError(409,'请让受邀者用另一个账号打开邀请')
      if(invite.status==='accepted'&&invite.recipient_id===userId&&accept){
        const [member]=await query(sql`SELECT 1 FROM members WHERE event_id=${invite.event_id} AND user_id=${userId} AND active`,tx)
        if(!member)throw new HttpError(410,'这次邀请已失效，需要重新邀请')
        return{eventId:invite.event_id}
      }
      if(invite.status!=='pending'||new Date(invite.expires_at)<new Date())throw new HttpError(410,'邀请已使用、取消或过期')
      if(accept)await assertSafetyAllowsSharing(database,invite.event_id,tx)
      await query(sql`UPDATE invites SET status=${accept?'accepted':'declined'},recipient_id=${userId} WHERE id=${invite.id}`,tx)
      if(accept){await query(sql`INSERT INTO members(event_id,user_id) VALUES(${invite.event_id},${userId}) ON CONFLICT(event_id,user_id) DO UPDATE SET active=true,joined_at=now()`,tx)
        await replaceShareGrant(database,invite.event_id,userId,invite.snapshot_id,invite.owner_id,tx)
      }
      if(accept)await query(sql`UPDATE events SET room_version=room_version+1,room_updated_at=now() WHERE id=${invite.event_id}`,tx)
      await revision(invite.event_id,userId,accept?'invite_accepted':'invite_declined',{},tx)
      return{eventId:invite.event_id}
    });await notify(result.eventId,accept?'room':'private');return result
  })
  app.delete('/api/events/:id/invites/:inviteId',async request=>{
    const id=eventId(request);await requireEventOwner(id,request.resoUser!.id)
    const inviteId=uuid.parse((request.params as {inviteId:string}).inviteId)
    await query(sql`UPDATE invites SET status='cancelled' WHERE id=${inviteId} AND event_id=${id} AND status='pending'`)
    await notify(id,'private');return{cancelled:true}
  })
  app.delete('/api/events/:id/members/:userId',async request=>{
    const id=eventId(request),actor=request.resoUser!.id,target=z.string().min(1).max(100).parse((request.params as {userId:string}).userId)
    const removed=await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      const event=await requireRoomParticipant(id,actor,tx)
      if(actor!==event.owner_id&&actor!==target)throw new HttpError(403,'只能管理自己的加入状态')
      const [member]=await query(sql`UPDATE members SET active=false WHERE event_id=${id} AND user_id=${target} AND active RETURNING user_id`,tx)
      if(!member)return false
      if(actor===event.owner_id)await query(sql`UPDATE invites SET status='cancelled' WHERE event_id=${id} AND status='pending'`,tx)
      await replaceShareGrant(database,id,target,null,actor,tx)
      await query(sql`UPDATE note_shares SET revoked_at=now() WHERE recipient_id=${target} AND revoked_at IS NULL AND application_id IN (SELECT id FROM applications WHERE event_id=${id})`,tx)
      await query(sql`UPDATE events SET room_version=room_version+1,room_updated_at=now() WHERE id=${id}`,tx)
      await revision(id,actor,'member_removed',{recipient:target},tx)
      return true
    })
    if(removed)await notify(id,'room',target)
    return{revoked:true}
  })
  app.put('/api/events/:id/shares/:userId', async request => {
    const id=eventId(request),actor=request.resoUser!.id,target=text(100).parse((request.params as {userId:string}).userId)
    await requireEventOwner(id,actor)
    const input=z.object({version:z.number().int().nonnegative()}).parse(request.body)
    await db.transaction(async tx => {
      const [event]=await query<EventRecord>(sql`SELECT * FROM events WHERE id=${id} FOR UPDATE`,tx)
      if(!event||event.summary_version!==input.version)throw new HttpError(409,'摘要已更新，请重新核对后分享')
      if(event.room_closed_at)throw new HttpError(409,'会谈已结束，仍可撤回已分享的摘要')
      await assertSafetyAllowsSharing(database,id,tx)
      if(!event.summary.trim())throw new HttpError(400,'请先填写并确认要分享的摘要')
      if(!(await query(sql`SELECT 1 FROM members WHERE event_id=${id} AND user_id=${target} AND active`,tx)).length)throw new HttpError(409,'对方尚未加入或已经退出房间')
      const snapshotId=await shareSnapshot(database,event,tx)
      if(await replaceShareGrant(database,id,target,snapshotId,actor,tx)){
        await query(sql`UPDATE events SET room_version=room_version+1,room_updated_at=now() WHERE id=${id}`,tx)
        await revision(id,actor,'share_granted',{recipient:target,snapshotId,version:input.version},tx)
      }
    })
    await notify(id,'room');return{saved:true}
  })
  app.delete('/api/events/:id/shares/:userId', async request => {
    const id=eventId(request),actor=request.resoUser!.id,target=text(100).parse((request.params as {userId:string}).userId)
    await requireEventOwner(id,actor)
    await db.transaction(async tx => {
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      if(await replaceShareGrant(database,id,target,null,actor,tx)){
        await query(sql`UPDATE events SET room_version=room_version+1,room_updated_at=now() WHERE id=${id}`,tx)
        await revision(id,actor,'share_revoked',{recipient:target},tx)
      }
    })
    await notify(id,'room');return{revoked:true}
  })
  app.put('/api/events/:id/perspective',async request=>{
    const id=eventId(request),userId=request.resoUser!.id;await requireRoomParticipant(id,userId)
    const input=z.object({text:text(2000),confirmed:z.boolean(),version:z.number().int().nonnegative()}).parse(request.body)
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      await requireOpenRoom(id,userId,tx)
      await query(sql`INSERT INTO perspectives(event_id,user_id,text) VALUES(${id},${userId},'') ON CONFLICT DO NOTHING`,tx)
      const rows=await query(sql`UPDATE perspectives SET text=${input.text},confirmed=${input.confirmed},version=version+1 WHERE event_id=${id} AND user_id=${userId} AND version=${input.version} RETURNING user_id`,tx)
      if(!rows.length)throw new HttpError(409,'你的表达已有新版本，请刷新后核对')
      await query(sql`UPDATE events SET room_version=room_version+1,room_updated_at=now() WHERE id=${id}`,tx)
      await revision(id,userId,input.confirmed?'participant_confirmed':'user_corrected',{kind:'perspective',...input},tx)
    });await notify(id,'room');return{saved:true}
  })
}

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db'
import { HttpError, uuid, text, domainSchema, eventId, json } from '../http'
import type { RouteContext } from '../context'
import { randomUUID } from 'node:crypto'
import type {Domain} from '../../shared/types'
import {readAgentActions} from '../agent-actions'
import {supportsMethodOffers} from '../../shared/capabilities'
import { readUnderstandings } from '../understandings'
import {legacyReplySummary,replyPhases} from '../../shared/reply'
import type {ReplyPhase} from '../../shared/reply'
import type { ChatMessage, EventRecord, Exercise, Questionnaire,MessagePage } from '../../shared/types'

export function registerEvents(app: FastifyInstance, context: RouteContext) {
  const { database, requireEventOwner, requireRoomParticipant, revision, notify, enqueue } = context
  const { query, db } = database
  const messageQuery=z.object({domain:domainSchema,before:z.string().refine(value=>/^\d{1,19}$/.test(value)&&BigInt(value)<=9223372036854775807n).optional()})
  async function readMessages(id:string,domain:Domain,before?:string,methodOffers=false):Promise<MessagePage>{
    const rows=(await query<ChatMessage>(sql`SELECT * FROM messages WHERE event_id=${id} AND domain=${domain} ${before?sql`AND id<${before}`:sql``} ORDER BY id DESC LIMIT 51`)).reverse()
    const messages=rows.slice(rows.length>50?1:0),actions=domain==='private'?await readAgentActions(database,id,messages.map(m=>String(m.id))):[]
    const runs=messages.length?await query<{response_message_id:string;kind:ChatMessage['understanding_kind'];reply_summary:string|null}>(sql`SELECT DISTINCT ON (response_message_id) response_message_id::text,assessment->>'understanding_kind' AS kind,checkpoint->>'reply_summary' AS reply_summary FROM agent_runs WHERE event_id=${id} AND domain=${domain} AND status='complete' AND response_message_id IN (${sql.join(messages.map(m=>sql`${m.id}`),sql`,`)}) ORDER BY response_message_id,created_at DESC`):[]
    const metadata=new Map(runs.map(run=>[run.response_message_id,run]))
    return{messages:messages.map(m=>({...m,understanding_kind:m.role==='assistant'&&m.author_name==='Reso'&&m.status==='complete'&&!m.card_type?metadata.get(String(m.id))?.kind||null:null,reply_summary:m.role!=='assistant'?null:m.status==='error'?'这轮回复未完成，尚未形成可用的思考摘要。':m.author_name==='Reso'?metadata.get(String(m.id))?.reply_summary?.trim()||legacyReplySummary:null,agent_actions:actions.filter(a=>a.message_id===String(m.id)&&(methodOffers||a.kind!=='method'))})),hasMore:rows.length>50}
  }
  app.get('/api/events/:id/messages',async request=>{
    const id=eventId(request),{domain,before}=messageQuery.parse(request.query)
    await (domain==='private'?requireEventOwner:requireRoomParticipant)(id,request.resoUser!.id)
    return readMessages(id,domain,before,supportsMethodOffers(request.headers['x-reso-features']))
  })
  app.get('/api/events', async request => query(sql`SELECT e.id,e.owner_id,CASE WHEN e.owner_id=${request.resoUser!.id} THEN e.title ELSE e.room_title END AS title,e.created_at,CASE WHEN e.owner_id=${request.resoUser!.id} THEN e.updated_at ELSE e.room_updated_at END AS updated_at,(e.owner_id=${request.resoUser!.id}) AS is_owner FROM events e WHERE e.id IN (SELECT id FROM events WHERE owner_id=${request.resoUser!.id} UNION SELECT event_id FROM members WHERE user_id=${request.resoUser!.id} AND active) ORDER BY CASE WHEN e.owner_id=${request.resoUser!.id} THEN e.updated_at ELSE e.room_updated_at END DESC`))
  app.get('/api/people',async request=>query(sql`WITH mine AS (SELECT id FROM events WHERE owner_id=${request.resoUser!.id} UNION SELECT event_id FROM members WHERE user_id=${request.resoUser!.id} AND active), participants AS (SELECT e.id AS event_id,e.owner_id AS user_id FROM events e JOIN mine ON mine.id=e.id UNION SELECT m.event_id,m.user_id FROM members m JOIN mine ON mine.id=m.event_id WHERE m.active) SELECT DISTINCT p.user_id,u.name,e.id AS event_id,e.room_title AS event_title,e.room_updated_at AS last_interaction_at FROM participants p JOIN events e ON e.id=p.event_id JOIN "user" u ON u.id=p.user_id WHERE p.user_id<>${request.resoUser!.id} ORDER BY e.room_updated_at DESC,u.name,e.id`))
  app.post('/api/events', async request => {
    const input = z.object({ title: text(80) }).parse(request.body), userId = request.resoUser!.id
    const [event] = await query<EventRecord>(sql`INSERT INTO events(id,owner_id,title) VALUES(${randomUUID()},${userId},${input.title}) RETURNING *`)
    return event
  })
  app.patch('/api/events/:id', async request => {
    const id = eventId(request), userId = request.resoUser!.id
    await requireEventOwner(id, userId)
    const input = z.object({ title: text(80), summary: z.string().trim().max(3000), version: z.number().int().nonnegative() }).parse(request.body)
    await db.transaction(async tx => {
      const updated = await query(sql`UPDATE events SET title=${input.title},summary=${input.summary},summary_version=summary_version+1,private_version=private_version+1,updated_at=now() WHERE id=${id} AND summary_version=${input.version} RETURNING id`, tx)
      if (!updated.length) throw new HttpError(409, '记录已更新，请刷新后再修改')
      await revision(id, userId, 'user_corrected', input, tx)
    }); await notify(id,'private'); return { saved: true }
  })
  app.delete('/api/events/:id', async request => {
    const id = eventId(request); await requireEventOwner(id, request.resoUser!.id)
    await query(sql`DELETE FROM events WHERE id=${id}`); await notify(id,'private'); return { deleted: true }
  })
  app.get('/api/events/:id', async request => {
    const id = eventId(request), userId = request.resoUser!.id
    const { domain, before } = messageQuery.parse(request.query)
    const event = await (domain === 'private' ? requireEventOwner : requireRoomParticipant)(id, userId), owner = event.owner_id === userId
    const {messages:rows,hasMore}=await readMessages(id,domain,before,supportsMethodOffers(request.headers['x-reso-features']))
    const last=rows.at(-1),version=domain==='private'?event.private_version:event.room_version
    const [run]=last?.role==='user'?await query<{status:'running'|'complete'|'error';response_message_id:string|null;display_phase:ReplyPhase}>(sql`SELECT status,response_message_id,checkpoint->>'display_phase' AS display_phase FROM agent_runs WHERE event_id=${id} AND domain=${domain} AND trigger_message_id=${last.id} AND context_version=${version} ORDER BY created_at DESC LIMIT 1`):[]
    const reply_state=last?.role!=='user'?'complete':run?.status==='complete'?(run.response_message_id?'running':'silent'):run?.status||'pending'
    const members = await query(sql`SELECT m.user_id,u.name,EXISTS(SELECT 1 FROM share_grants g WHERE g.event_id=m.event_id AND g.recipient_id=m.user_id AND g.revoked_at IS NULL) AS shared FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.event_id=${id} AND m.active`)
    const snapshots = await query(sql`SELECT g.recipient_id AS user_id,s.content,s.source_version AS version,g.granted_at FROM share_grants g JOIN share_snapshots s ON s.id=g.snapshot_id JOIN members m ON m.event_id=g.event_id AND m.user_id=g.recipient_id WHERE g.event_id=${id} AND g.revoked_at IS NULL AND m.active ${owner ? sql`` : sql`AND g.recipient_id=${userId}`}`)
    const perspectives = await query(sql`SELECT p.user_id,u.name,p.text,p.confirmed,p.version FROM perspectives p JOIN "user" u ON u.id=p.user_id WHERE p.event_id=${id} AND (p.user_id=${event.owner_id} OR EXISTS(SELECT 1 FROM members m WHERE m.event_id=p.event_id AND m.user_id=p.user_id AND m.active))`)
    return { event: owner ? {...event,...(domain==='room'?{title:event.room_title||event.title}:{})} : { id: event.id, owner_id: event.owner_id, title: event.room_title,room_title:event.room_title, summary: '', summary_version: 0, initial_summary: '', private_version: 0, room_version: event.room_version, created_at: event.created_at, updated_at: event.room_updated_at,room_updated_at:event.room_updated_at }, messages:rows,hasMore, members, snapshots, perspectives,
      exercise: owner && domain === 'private' ? (await query<Exercise>(sql`SELECT act,paused,notes,story,saved,version,practice_notes FROM exercises WHERE event_id=${id}`))[0] || null : null,
      questionnaire: owner && domain === 'private' ? (await query<Questionnaire>(sql`SELECT * FROM questionnaires WHERE event_id=${id}`))[0] || null : null,
      invites: owner ? await query(sql`SELECT i.id,CASE WHEN i.status='pending' AND i.expires_at<now() THEN 'expired' ELSE i.status END AS status,i.expires_at,i.created_at,u.name AS recipient_name,(i.snapshot_id IS NOT NULL) AS has_summary,s.content AS shared_content,s.source_version FROM invites i LEFT JOIN "user" u ON u.id=i.recipient_id LEFT JOIN share_snapshots s ON s.id=i.snapshot_id WHERE i.event_id=${id} ORDER BY i.created_at DESC`) : [],
      applications: owner ? await query(sql`SELECT a.*,c.name AS consultant_name,n.content AS note_content,n.version AS note_version,coalesce((SELECT jsonb_agg(jsonb_build_object('recipient_id',s.recipient_id,'source_version',s.source_version)) FROM note_shares s WHERE s.application_id=a.id AND s.revoked_at IS NULL),'[]'::jsonb) AS note_shares FROM applications a JOIN consultants c ON c.id=a.consultant_id LEFT JOIN consultation_notes n ON n.application_id=a.id AND n.client_visible WHERE a.event_id=${id}`) : [],
      understandings:await readUnderstandings(database,id,domain),
      followups:owner&&domain==='private'?await query(sql`SELECT * FROM followups WHERE event_id=${id} AND user_id=${userId} ORDER BY created_at DESC`):[],
      shared_notes:domain==='room'?await query(sql`SELECT s.application_id,s.content,s.source_version FROM note_shares s JOIN applications a ON a.id=s.application_id JOIN members m ON m.event_id=a.event_id AND m.user_id=s.recipient_id WHERE a.event_id=${id} AND s.recipient_id=${userId} AND s.revoked_at IS NULL AND m.active`):[],
      reply_state,reply_progress:reply_state==='running'&&run?.status==='running'&&replyPhases.includes(run.display_phase)?{phase:run.display_phase,message_id:String(last!.id)}:null,
    }
  })
  app.post('/api/events/:id/messages', async request => {
    const id = eventId(request), user = request.resoUser!
    const input = z.object({ domain: domainSchema, content: text(4000), clientId: uuid }).parse(request.body)
    await (input.domain === 'private' ? requireEventOwner : requireRoomParticipant)(id, user.id)
    const column = input.domain === 'private' ? sql`private_version` : sql`room_version`
    const message = await db.transaction(async tx => {
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`, tx)
      await (input.domain === 'private' ? requireEventOwner : requireRoomParticipant)(id,user.id,tx)
      const rows = await query<ChatMessage>(sql`INSERT INTO messages(event_id,author_id,author_name,domain,role,content,client_id) VALUES(${id},${user.id},${user.name},${input.domain},'user',${input.content},${input.clientId}) ON CONFLICT(client_id) DO NOTHING RETURNING *`, tx)
      if (!rows.length) {
        const [existing] = await query<ChatMessage>(sql`SELECT * FROM messages WHERE client_id=${input.clientId} AND author_id=${user.id} AND event_id=${id} AND domain=${input.domain}`, tx)
        if (!existing || existing.content !== input.content) throw new HttpError(409, '重复请求标识与原消息不一致')
        return existing
      }
      await query(sql`UPDATE events SET ${column}=${column}+1,updated_at=now(),room_updated_at=CASE WHEN ${input.domain}='room' THEN now() ELSE room_updated_at END WHERE id=${id}`, tx)
      await enqueue(id,input.domain,user.id,tx,supportsMethodOffers(request.headers['x-reso-features']))
      return rows[0]
    })
    await notify(id,input.domain); return message
  })
  app.post('/api/events/:id/retry',async request=>{
    const id=eventId(request),domain=domainSchema.parse((request.body as {domain?:string})?.domain),userId=request.resoUser!.id
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      await (domain==='private'?requireEventOwner:requireRoomParticipant)(id,userId,tx)
      await enqueue(id,domain,userId,tx,supportsMethodOffers(request.headers['x-reso-features']))
    });return{queued:true}
  })
  app.get('/api/events/:id/export',async request=>{
    const id=eventId(request)
    return db.transaction(async tx=>{
    await requireEventOwner(id,request.resoUser!.id,tx)
    const query=<T>(statement:Parameters<typeof database.query>[0])=>database.query<T>(statement,tx)
    return{agent_actions:await query(sql`SELECT id,message_id,proposal,status,created_at,resolved_at FROM agent_actions WHERE event_id=${id} AND status='applied'`),event:(await query(sql`SELECT * FROM events WHERE id=${id}`))[0],private_messages:await query(sql`SELECT * FROM messages WHERE event_id=${id} AND domain='private' ORDER BY id`),exercise:(await query(sql`SELECT * FROM exercises WHERE event_id=${id}`))[0]||null,questionnaire:(await query(sql`SELECT * FROM questionnaires WHERE event_id=${id}`))[0]||null,revisions:await query(sql`SELECT * FROM revisions WHERE event_id=${id} AND actor_id=${request.resoUser!.id} ORDER BY id`),room_messages:await query(sql`SELECT * FROM messages WHERE event_id=${id} AND domain='room' ORDER BY id`),share_snapshots:await query(sql`SELECT * FROM share_snapshots WHERE event_id=${id}`),share_grants:await query(sql`SELECT * FROM share_grants WHERE event_id=${id}`),perspectives:await query(sql`SELECT * FROM perspectives WHERE event_id=${id}`),understandings:await query(sql`SELECT * FROM understandings WHERE event_id=${id}`),confirmations:await query(sql`SELECT c.* FROM understanding_confirmations c JOIN understandings u ON u.id=c.understanding_id WHERE u.event_id=${id}`),followups:await query(sql`SELECT * FROM followups WHERE event_id=${id}`),applications:await query(sql`SELECT * FROM applications WHERE event_id=${id} AND applicant_id=${request.resoUser!.id}`),consultation_notes:await query(sql`SELECT n.* FROM consultation_notes n JOIN applications a ON a.id=n.application_id WHERE a.event_id=${id} AND a.applicant_id=${request.resoUser!.id} AND n.client_visible`),note_shares:await query(sql`SELECT s.* FROM note_shares s JOIN applications a ON a.id=s.application_id WHERE a.event_id=${id} AND a.applicant_id=${request.resoUser!.id}`)}
    },{isolationLevel:'repeatable read',accessMode:'read only'})
  })
}

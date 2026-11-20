import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RoomTopic } from '../../shared/types'
import type { RouteContext } from '../context'
import { sql } from '../db'
import { eventId, HttpError, uuid } from '../http'

export function registerTopics(app: FastifyInstance, {database, requireRoomParticipant, requireOpenRoom, notify}: RouteContext) {
  const {db, query} = database
  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

  async function lockRoom(id: string, userId: string, tx: Transaction) {
    await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`, tx)
    await requireOpenRoom(id, userId, tx)
    if (!(await query(sql`SELECT 1 FROM members WHERE event_id=${id} AND active LIMIT 1`, tx)).length) {
      throw new HttpError(409, '邀请的人加入会谈后，就可以一起抽话题卡。')
    }
  }

  app.get('/api/events/:id/topics', async request => {
    const id = eventId(request)
    const userId = request.resoUser!.id
    return query<RoomTopic>(sql`
      SELECT r.id,r.question,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',u.name,'answer',a.answer) ORDER BY u.name,a.user_id)
          FROM room_topic_answers a JOIN "user" u ON u.id=a.user_id
          WHERE a.round_id=r.id AND (a.user_id=e.owner_id OR EXISTS (
            SELECT 1 FROM members m WHERE m.event_id=e.id AND m.user_id=a.user_id AND m.active
          ))
        ), '[]'::jsonb) AS answers
      FROM room_topic_rounds r JOIN events e ON e.id=r.event_id
      WHERE e.id=${id} AND (e.owner_id=${userId} OR EXISTS (
        SELECT 1 FROM members m WHERE m.event_id=e.id AND m.user_id=${userId} AND m.active
      ))
      ORDER BY r.created_at DESC,r.id DESC LIMIT 10
    `).then(async rounds => {
      if (!rounds.length) await requireRoomParticipant(id, userId)
      return rounds
    })
  })

  app.post('/api/events/:id/topics', async request => {
    const id = eventId(request)
    const {previousId} = z.object({previousId:uuid.nullable()}).parse(request.body)
    const changed = await db.transaction(async tx => {
      await lockRoom(id, request.resoUser!.id, tx)
      const [current] = await query<{id:string;card_id:number}>(sql`
        SELECT id,card_id FROM room_topic_rounds WHERE event_id=${id} ORDER BY created_at DESC,id DESC LIMIT 1
      `, tx)
      if ((current?.id ?? null) !== previousId) return false
      const [card] = await query<{id:number;question:string}>(sql`
        SELECT c.id,c.question FROM topic_cards c WHERE c.active AND c.id IS DISTINCT FROM ${current?.card_id ?? null}
        ORDER BY EXISTS(SELECT 1 FROM room_topic_rounds r WHERE r.event_id=${id} AND r.card_id=c.id),random() LIMIT 1
      `, tx)
      if (!card) throw new HttpError(409, '暂时没有其他话题卡，稍后再看看。')
      await query(sql`INSERT INTO room_topic_rounds(id,event_id,card_id,question) VALUES(${randomUUID()},${id},${card.id},${card.question})`, tx)
      return true
    })
    if (changed) await notify(id, 'room')
    return {changed}
  })

  app.put('/api/events/:id/topics/:roundId/answer', async request => {
    const id = eventId(request), userId = request.resoUser!.id
    const roundId = uuid.parse((request.params as {roundId:string}).roundId)
    const {answer} = z.object({answer:z.string().trim().min(1).max(400)}).parse(request.body)
    await db.transaction(async tx => {
      await lockRoom(id, userId, tx)
      const [current] = await query<{id:string}>(sql`
        SELECT id FROM room_topic_rounds WHERE event_id=${id} ORDER BY created_at DESC,id DESC LIMIT 1
      `, tx)
      if (current?.id !== roundId) throw new HttpError(409, '会谈成员已经换了话题，请核对当前话题。')
      await query(sql`
        INSERT INTO room_topic_answers(round_id,user_id,answer) VALUES(${roundId},${userId},${answer})
        ON CONFLICT(round_id,user_id) DO UPDATE SET answer=excluded.answer
      `, tx)
    })
    await notify(id, 'room')
    return {saved:true}
  })
}

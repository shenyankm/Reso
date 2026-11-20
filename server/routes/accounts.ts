import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db'
import type { RouteContext } from '../context'
import { localTestPolicy } from '../../shared/consent'
import { text } from '../http'
import type { SavedRecord, User } from '../../shared/types'

export function registerAccounts(app: FastifyInstance, context: RouteContext) {
  const { database } = context
  const { query, db } = database
  app.get('/api/me', async request => {
    const consultants = await query(sql`SELECT id FROM consultants WHERE user_id=${request.resoUser!.id} AND active`)
    return { user: request.resoUser, role: consultants.length ? 'counselor' : 'member', consentRequired: false }
  })
  app.patch('/api/me', async request => {
    const { name } = z.object({ name:text(50) }).strict().parse(request.body)
    const [user] = await query<User>(sql`UPDATE "user" SET name=${name},"updatedAt"=now() WHERE id=${request.resoUser!.id} RETURNING id,name,email`)
    return { user }
  })
  app.get('/api/me/applications',async request=>query(sql`SELECT a.id,a.event_id,a.status,c.name AS consultant_name,c.test_only,e.title AS event_title FROM applications a JOIN events e ON e.id=a.event_id JOIN consultants c ON c.id=a.consultant_id WHERE a.applicant_id=${request.resoUser!.id} AND e.owner_id=${request.resoUser!.id} ORDER BY CASE a.status WHEN 'scheduled' THEN 0 WHEN 'proposed' THEN 1 WHEN 'accepted' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END,a.created_at DESC,a.id LIMIT 20`))
  app.get('/api/me/records', async request => {
    const userId=request.resoUser!.id
    const {offset,kind}=z.object({
      offset:z.coerce.number().int().min(0).max(1_000_000).default(0),
      kind:z.literal('story').optional(),
    }).parse(request.query)
    const rows=await query<SavedRecord>(sql`
      WITH mine AS (SELECT id,title FROM events WHERE owner_id=${userId}), records AS (
        SELECT x.event_id::text AS id,x.event_id,e.title AS event_title,'story' AS kind,x.updated_at
        FROM exercises x JOIN mine e ON e.id=x.event_id WHERE x.saved AND btrim(x.story)<>''
        UNION ALL
        SELECT x.event_id::text,x.event_id,e.title,p.key,x.updated_at
        FROM exercises x JOIN mine e ON e.id=x.event_id
        CROSS JOIN LATERAL jsonb_each(x.practice_notes) p
        WHERE p.key IN ('nvc','roleplay') AND EXISTS (
          SELECT 1 FROM jsonb_each_text(p.value) field WHERE field.value ~ '[^[:space:]]'
        )
        UNION ALL
        SELECT f.id::text,f.event_id,e.title,'followup',f.created_at
        FROM followups f JOIN mine e ON e.id=f.event_id WHERE f.user_id=${userId}
      ) SELECT * FROM records WHERE (${!kind} OR kind='story')
        ORDER BY updated_at DESC,kind,id LIMIT 21 OFFSET ${offset}
    `)
    return { records:rows.slice(0,20),nextOffset:rows.length>20?offset+20:null }
  })
  app.post('/api/consent', async request => {
    z.object({ accepted: z.literal(true), version: z.literal(localTestPolicy.version) }).parse(request.body)
    const userId = request.resoUser!.id
    await db.transaction(async tx => {
      await query(sql`INSERT INTO profiles(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`, tx)
      await query(sql`INSERT INTO consent_records(user_id,consent_type,policy_version,action) VALUES(${userId},${localTestPolicy.type},${localTestPolicy.version},'accepted') ON CONFLICT(user_id,consent_type,policy_version) DO NOTHING`, tx)
    })
    return { accepted: true }
  })
}

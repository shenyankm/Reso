import {assertSafetyAllowsPractice} from '../agent-state'
import {isDeepStrictEqual} from 'node:util'
import type {Exercise} from '../../shared/types'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../db'
import { HttpError, eventId, json } from '../http'
import type { RouteContext } from '../context'
import { scqaItems, scqaOptions, scqaVersion, scoreScqa, describeScqa } from '../../shared/scqa'

export function registerAssessments(app: FastifyInstance, context: RouteContext) {
  const { database, requireEventOwner, revision, notify } = context
  const { query, db } = database
  app.get('/api/questionnaire', async () => ({ version:scqaVersion,items:scqaItems,options:scqaOptions,referenceOnly:true }))
  app.put('/api/events/:id/questionnaire', async request => {
    const id=eventId(request), userId=request.resoUser!.id; await requireEventOwner(id,userId)
    const input=z.object({answers:z.array(z.number().int().min(1).max(6).nullable()).length(24),revision:z.number().int().nonnegative(),version:z.literal(scqaVersion)}).parse(request.body)
    const complete=input.answers.every(n=>n!==null), scores=complete?scoreScqa(input.answers as number[]):null, discovery=scores?describeScqa(scores):''
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      await requireEventOwner(id,userId,tx)
      await query(sql`INSERT INTO questionnaires(event_id,version,answers) VALUES(${id},${scqaVersion},${json(Array(24).fill(null))}::jsonb) ON CONFLICT DO NOTHING`,tx)
      const rows=await query(sql`UPDATE questionnaires SET answers=${json(input.answers)}::jsonb,scores=${json(scores)}::jsonb,discovery=${discovery},state=${complete?'unconfirmed':'draft'},confirmed_summary='',revision=revision+1,updated_at=now() WHERE event_id=${id} AND revision=${input.revision} RETURNING event_id`,tx)
      if(!rows.length)throw new HttpError(409,'问卷已在其它页面更新，请刷新后重试')
      await query(sql`UPDATE events SET initial_summary='',private_version=private_version+1 WHERE id=${id}`,tx)
    }); await notify(id,'private');return{saved:true}
  })
  app.post('/api/events/:id/discovery', async request=>{
    const id=eventId(request),userId=request.resoUser!.id;await requireEventOwner(id,userId)
    const input=z.object({accepted:z.boolean(),summary:z.string().trim().max(1000),revision:z.number().int().nonnegative()}).parse(request.body)
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      await requireEventOwner(id,userId,tx)
      const rows=await query(sql`UPDATE questionnaires SET state=${input.accepted?'accepted':'rejected'},confirmed_summary=${input.accepted?input.summary:''},revision=revision+1 WHERE event_id=${id} AND scores IS NOT NULL AND revision=${input.revision} RETURNING event_id`,tx)
      if(!rows.length)throw new HttpError(409,'请完成问卷并刷新当前发现后再确认')
      await query(sql`UPDATE events SET initial_summary=${input.accepted?input.summary:''},private_version=private_version+1 WHERE id=${id}`,tx)
      await revision(id,userId,input.accepted?'participant_confirmed':'user_corrected',{kind:'discovery',...input},tx)
    });await notify(id,'private');return{saved:true}
  })
  app.put('/api/events/:id/exercise',async request=>{
    const id=eventId(request),userId=request.resoUser!.id;await requireEventOwner(id,userId)
    const input=z.object({act:z.number().int().min(0).max(5),paused:z.boolean(),notes:z.record(z.string().regex(/^[0-5]$/),z.string().max(2000)),story:z.string().max(4000),saved:z.boolean(),version:z.number().int().nonnegative(),practice_notes:z.partialRecord(z.enum(['nvc','roleplay']),z.record(z.string().max(50),z.string().max(2000))).optional()}).parse(request.body)
    await db.transaction(async tx=>{
      await query(sql`SELECT id FROM events WHERE id=${id} FOR UPDATE`,tx)
      await requireEventOwner(id,userId,tx)
      await query(sql`INSERT INTO exercises(event_id) VALUES(${id}) ON CONFLICT DO NOTHING`,tx)
      const [previous]=await query<Exercise>(sql`SELECT act,notes,story,saved,practice_notes FROM exercises WHERE event_id=${id} FOR UPDATE`,tx)
      const onlyPausing=input.paused&&input.act===previous.act&&input.story===previous.story&&input.saved===previous.saved&&isDeepStrictEqual(input.notes,previous.notes)&&isDeepStrictEqual(input.practice_notes??previous.practice_notes,previous.practice_notes)
      if(!onlyPausing)await assertSafetyAllowsPractice(database,id,tx)
      if(!onlyPausing&&input.saved&&!input.story.trim())throw new HttpError(400,'请确认故事后保存')
      if(input.saved&&!previous.saved&&input.act!==5)throw new HttpError(400,'请在第五幕确认并保存故事')
      const rows=await query(sql`UPDATE exercises SET act=${input.act},paused=${input.paused},notes=${json(input.notes)}::jsonb,story=${input.story},saved=${input.saved},practice_notes=coalesce(${input.practice_notes?json(input.practice_notes):null}::jsonb,practice_notes),version=version+1,updated_at=now() WHERE event_id=${id} AND version=${input.version} RETURNING event_id`,tx)
      if(!rows.length)throw new HttpError(409,'练习已有新进度，请刷新后再修改')
      await query(sql`UPDATE events SET private_version=private_version+1 WHERE id=${id}`,tx)
      await revision(id,userId,input.saved?'story_saved':'exercise_progress',input,tx)
    });await notify(id,'private');return{saved:true}
  })
}

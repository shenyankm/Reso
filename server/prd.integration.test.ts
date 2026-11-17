import {withObservationFixture} from './test-agent'
const processReply=(...args:Parameters<typeof processProductionReply>)=>processProductionReply(args[0],args[1],args[2],args[3]?withObservationFixture(args[3]):undefined,args[4])
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {createApp} from './app'
import {createTestDatabase} from './test-database'
import {loadAgentContext} from './agent-context'
import {processReply as processProductionReply} from './worker'
import {localTestPolicy} from '../shared/consent'
import type {Model} from './agent'

async function scenario(){
  const fixture=await createTestDatabase()
  const service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
  let nextIp=2;const ips=new Map<string,string>()
  const call=(method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:string,cookie='',payload?:unknown)=>service.app.inject({method,url,remoteAddress:cookie?ips.get(cookie)||'127.0.0.1':`127.0.0.${nextIp}`,headers:{origin:'http://localhost:5173',...(cookie?{cookie}:{}),...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{payload:JSON.stringify(payload)})})
  const signup=async(name:string)=>{
    const result=await call('POST','/api/auth/sign-up/email','',{name,email:`${name}@prd.test`,password:randomBytes(18).toString('hex')});assert.equal(result.statusCode,200,result.body)
    const raw=result.headers['set-cookie'],cookie=(Array.isArray(raw)?raw:[raw]).filter(Boolean).map(v=>String(v).split(';')[0]).join('; ');ips.set(cookie,`127.0.0.${nextIp++}`)
    assert.equal((await call('POST','/api/consent',cookie,{accepted:true,version:localTestPolicy.version})).statusCode,200)
    return{id:result.json().user.id as string,cookie}
  }
  const invite=async(id:string,owner:string,recipient:string,version=0)=>{
    const response=await call('POST',`/api/events/${id}/invites`,owner,{shareSummary:false,version,clientId:randomUUID()})
    assert.equal(response.statusCode,200,response.body)
    const link=response.json()
    assert.equal((await call('POST',`/api/invites/${link.token}/respond`,recipient,{accept:true})).statusCode,200)
  }
  return {fixture,service,call,signup,invite,close:async()=>{await service.app.close();await fixture.cleanup()}}
}
const skip=!process.env.DATABASE_URL
const model:Model=async(_prompt,json)=>json?JSON.stringify({intent:'test',strategy:'listen',evidence_ids:[],uncertainty:'',needs_human:false}):'MODEL_INFERENCE_FOR_REVIEW'

test('saved practices and followups reach only private context; source-based confirmations, corrections, safety cards and export persist',{skip},async()=>{
  const s=await scenario(),{call,signup,invite,service}=s
  try{
    const owner=await signup('owner'),parent=await signup('parent'),other=await signup('other')
    const id=(await call('POST','/api/events',owner.cookie,{title:'私人的事件'})).json().id
    await invite(id,owner.cookie,parent.cookie)
    const send=async(content:string,domain='private',cookie=owner.cookie)=>{
      const result=await call('POST',`/api/events/${id}/messages`,cookie,{content,domain,clientId:randomUUID()});assert.equal(result.statusCode,200,result.body);return result.json()
    }
    const exercise={act:5,paused:false,notes:{'1':'PRIVATE_PRACTICE_NOTE'},story:'PRIVATE_SAVED_STORY',saved:true,version:0,practice_notes:{nvc:{need:'PRIVATE_NVC_NEED'},roleplay:{possible_reply:'HYPOTHETICAL_REPLY'}}}
    assert.equal((await call('PUT',`/api/events/${id}/exercise`,owner.cookie,exercise)).statusCode,200)
    const followupId=randomUUID(),body={id:followupId,reflection:'PRIVATE_FOLLOWUP',nextStep:'写下我的请求',reviewAt:new Date(Date.now()+86400000).toISOString()}
    assert.equal((await call('POST',`/api/events/${id}/followups`,owner.cookie,body)).statusCode,200)
    assert.equal((await call('POST',`/api/events/${id}/followups`,owner.cookie,body)).statusCode,200)
    assert.equal((await call('POST',`/api/events/${id}/followups`,owner.cookie,{...body,nextStep:'different'})).statusCode,409)
    assert.equal((await call('GET','/api/followups',other.cookie)).json().length,0)
    await send('请接着我保存的练习聊聊')
    const loaded=await loadAgentContext(service.database,{eventId:id,domain:'private',actorId:owner.id});assert.ok(loaded)
    for(const content of ['PRIVATE_PRACTICE_NOTE','PRIVATE_SAVED_STORY','PRIVATE_NVC_NEED','HYPOTHETICAL_REPLY','PRIVATE_FOLLOWUP'])assert.ok(loaded.context.includes(content),content)
    // Pending safety assessment blocks practice changes; an allowed summary edit still invalidates the reply.
    await assert.rejects(processReply(service.database,{eventId:id,domain:'private',actorId:owner.id},service.notify,async(prompt,json)=>{
      if(json)return model(prompt,json)
      assert.equal((await call('PUT',`/api/events/${id}/exercise`,owner.cookie,{...exercise,version:1,notes:{'1':'LATEST_PRIVATE_NOTE'}})).statusCode,409)
      assert.equal((await call('PATCH',`/api/events/${id}`,owner.cookie,{title:'私人的事件',summary:'PRIVATE_EDIT_DURING_REPLY',version:0})).statusCode,200)
      return 'MUST_NOT_PUBLISH_OLD_PRACTICE'
    }),/CONTEXT_CHANGED/)
    await send('请核对你的理解')
    await processReply(service.database,{eventId:id,domain:'private',actorId:owner.id},service.notify,model)
    assert.equal((await call('PUT',`/api/events/${id}/exercise`,owner.cookie,{...exercise,version:1,notes:{'1':'LATEST_PRIVATE_NOTE'}})).statusCode,200)
    let detail=(await call('GET',`/api/events/${id}`,owner.cookie)).json()
    const assistant=detail.messages.at(-1)
    assert.equal((await call('POST',`/api/events/${id}/understandings`,owner.cookie,{domain:'private',sourceMessageId:assistant.id})).statusCode,200)
    detail=(await call('GET',`/api/events/${id}`,owner.cookie)).json();const privateEntry=detail.understandings[0]
    assert.equal(privateEntry.provenance,'model_inference');assert.equal(privateEntry.status,'unconfirmed')
    await call('POST',`/api/events/${id}/understandings/${privateEntry.id}/confirm`,owner.cookie,{agreed:false,version:1})
    await send('我对之前的理解有不同意见')
    const disputed=await loadAgentContext(service.database,{eventId:id,domain:'private',actorId:owner.id})
    assert.ok(disputed!.context.includes('disputed'))
    await send('我不想活了')
    let calls=0;await processReply(service.database,{eventId:id,domain:'private',actorId:owner.id},service.notify,async()=>{calls++;throw new Error('not allowed')})
    detail=(await call('GET',`/api/events/${id}`,owner.cookie)).json()
    assert.equal(calls,0);assert.equal(detail.messages.at(-1).card_type,'safety');assert.equal(detail.exercise.paused,true)
    assert.equal((await call('POST',`/api/events/${id}/invites`,owner.cookie,{shareSummary:false,version:1,clientId:randomUUID()})).statusCode,409)
    const roomMessage=await send('PUBLIC_SOURCE_WORDS','room',parent.cookie)
    assert.equal((await call('POST',`/api/events/${id}/understandings`,owner.cookie,{domain:'room',sourceMessageId:assistant.id})).statusCode,404)
    assert.equal((await call('POST',`/api/events/${id}/understandings`,owner.cookie,{domain:'room',sourceMessageId:roomMessage.id})).statusCode,200)
    detail=(await call('GET',`/api/events/${id}?domain=room`,owner.cookie)).json();const entry=detail.understandings[0]
    assert.equal(entry.provenance,'user_quoted');assert.equal(entry.source_author_id,parent.id);assert.equal(entry.source_author_name,'parent');assert.equal(entry.author_id,owner.id)
    assert.equal((await call('POST',`/api/events/${id}/understandings/${entry.id}/confirm`,other.cookie,{agreed:true,version:1})).statusCode,403)
    await call('POST',`/api/events/${id}/understandings/${entry.id}/confirm`,owner.cookie,{agreed:true,version:1})
    assert.equal((await call('GET',`/api/events/${id}?domain=room`,owner.cookie)).json().understandings[0].status,'participant_confirmed')
    await call('POST',`/api/events/${id}/understandings/${entry.id}/confirm`,parent.cookie,{agreed:true,version:1})
    assert.equal((await call('GET',`/api/events/${id}?domain=room`,owner.cookie)).json().understandings[0].status,'jointly_confirmed')
    assert.equal((await call('PATCH',`/api/events/${id}/understandings/${entry.id}`,parent.cookie,{content:'Cannot edit another author',version:1})).statusCode,403)
    await call('PATCH',`/api/events/${id}/understandings/${entry.id}`,owner.cookie,{content:'PUBLIC_CORRECTED_WORDS',version:1})
    assert.equal((await call('POST',`/api/events/${id}/understandings/${entry.id}/confirm`,parent.cookie,{agreed:true,version:1})).statusCode,409)
    detail=(await call('GET',`/api/events/${id}?domain=room`,owner.cookie)).json();assert.equal(detail.understandings[0].status,'unconfirmed');assert.equal(detail.understandings[0].provenance,'user_corrected')
    await call('POST',`/api/events/${id}/understandings/${entry.id}/confirm`,parent.cookie,{agreed:false,version:2})
    assert.equal((await call('GET',`/api/events/${id}?domain=room`,owner.cookie)).json().understandings[0].status,'disputed')
    const room=await loadAgentContext(service.database,{eventId:id,domain:'room',actorId:parent.id});assert.ok(room)
    for(const content of ['LATEST_PRIVATE_NOTE','PRIVATE_SAVED_STORY','PRIVATE_NVC_NEED','PRIVATE_FOLLOWUP','MODEL_INFERENCE_FOR_REVIEW'])assert.ok(!room.context.includes(content),content)
    assert.ok(room.context.includes('PUBLIC_CORRECTED_WORDS'))
    assert.equal((await call('POST',`/api/events/${id}/followups/${followupId}/review`,parent.cookie,{})).statusCode,403)
    assert.equal((await call('POST',`/api/events/${id}/followups/${followupId}/review`,owner.cookie,{})).statusCode,200)
    const exported=(await call('GET',`/api/events/${id}/export`,owner.cookie)).json()
    assert.ok(exported.room_messages.length);assert.equal(exported.followups.length,1);assert.ok(exported.followups[0].reviewed_at);assert.equal(exported.understandings.length,2);assert.ok(exported.confirmations.length>=3)
    assert.equal((await call('GET',`/api/events/${id}/export`,parent.cookie)).statusCode,403)
    const newEvent=(await call('POST','/api/events',owner.cookie,{title:'尚未开始练习的事件'})).json().id
    await call('POST',`/api/events/${newEvent}/messages`,owner.cookie,{content:'我不想活了',domain:'private',clientId:randomUUID()})
    await processReply(service.database,{eventId:newEvent,domain:'private',actorId:owner.id},service.notify,model)
    assert.equal((await call('GET',`/api/events/${newEvent}`,owner.cookie)).json().exercise.paused,true)

    assert.equal((await call('DELETE',`/api/events/${id}`,owner.cookie)).statusCode,200)
    for(const table of ['understandings','followups'])assert.equal((await s.fixture.fixtures.pool.query(`SELECT count(*) FROM ${table} WHERE event_id=$1`,[id])).rows[0].count,'0')
  }finally{await s.close()}
})

test('appointments require current client confirmation and notes require separate versioned sharing',{skip},async()=>{
  const s=await scenario(),{call,signup,invite,fixture}=s
  try{
    const owner=await signup('client'),parent=await signup('parent'),other=await signup('other'),expert=await signup('expert')
    const id=(await call('POST','/api/events',owner.cookie,{title:'咨询测试事件'})).json().id
    await invite(id,owner.cookie,parent.cookie);await invite(id,owner.cookie,other.cookie)
    const consultantId=randomUUID(),unverifiedId=randomUUID()
    await fixture.fixtures.pool.query("INSERT INTO consultants(id,user_id,name,approach,qualifications,price,specialties,service_modes) VALUES($1,$2,'TEST EXPERT','测试','测试资料','不收费',ARRAY['亲子沟通'],ARRAY['测试流程'])",[consultantId,expert.id])
    await fixture.fixtures.pool.query("INSERT INTO consultants(id,user_id,name,approach,qualifications,price,test_only) VALUES($1,$2,'UNVERIFIED','test','test','test',false)",[unverifiedId,other.id])
    const directory=(await call('GET','/api/consultants?need=亲子沟通',owner.cookie)).json()
    assert.equal(directory.length,1);assert.equal(directory[0].id,consultantId);assert.ok(directory[0].recommendation_reason.includes('测试'))
    const a=(await call('POST',`/api/events/${id}/applications`,owner.cookie,{consultantId,shareSummary:false,version:0,clientId:randomUUID()})).json()
    const get=async()=>((await call('GET',`/api/events/${id}`,owner.cookie)).json().applications as {id:string;status:string;schedule_version:number;scheduled_at:string|null;note_content:string|null;note_version:number;note_shares:unknown[]}[]).find(row=>row.id===a.id)!
    const patch=(payload:unknown)=>call('PATCH',`/api/applications/${a.id}`,expert.cookie,payload)
    assert.equal((await patch({status:'accepted'})).statusCode,200)
    assert.equal((await patch({status:'scheduled',scheduledAt:new Date(Date.now()+86400000).toISOString()})).statusCode,400)
    assert.equal((await patch({status:'proposed',scheduledAt:new Date(Date.now()+86400000).toISOString()})).statusCode,200)
    let current=await get();assert.equal(current.status,'proposed');assert.equal(current.scheduled_at,null)
    assert.equal((await call('POST',`/api/applications/${a.id}/appointment-response`,expert.cookie,{accepted:true,version:current.schedule_version})).statusCode,403)
    const oldVersion=current.schedule_version
    await patch({status:'proposed',scheduledAt:new Date(Date.now()+172800000).toISOString()})
    assert.equal((await call('POST',`/api/applications/${a.id}/appointment-response`,owner.cookie,{accepted:true,version:oldVersion})).statusCode,409)
    current=await get()
    await fixture.fixtures.pool.query('UPDATE consultants SET active=false WHERE id=$1',[consultantId])
    assert.equal((await call('POST',`/api/applications/${a.id}/appointment-response`,owner.cookie,{accepted:true,version:current.schedule_version})).statusCode,403)
    assert.equal((await call('POST',`/api/applications/${a.id}/appointment-response`,owner.cookie,{accepted:false,version:current.schedule_version})).statusCode,200)
    await fixture.fixtures.pool.query('UPDATE consultants SET active=true WHERE id=$1',[consultantId])
    assert.equal((await get()).status,'accepted')
    await patch({status:'proposed',scheduledAt:new Date(Date.now()+86400000).toISOString()});current=await get()
    assert.equal((await call('POST',`/api/applications/${a.id}/appointment-response`,owner.cookie,{accepted:true,version:current.schedule_version})).statusCode,200)
    assert.equal((await get()).status,'scheduled');assert.equal((await patch({status:'completed'})).statusCode,409)
    const saveNote=(content:string,version:number,clientVisible=true)=>call('PUT',`/api/applications/${a.id}/note`,expert.cookie,{content,version,clientVisible})
    assert.equal((await saveNote('EXPERT_PRIVATE_DRAFT',0,false)).statusCode,200)
    assert.equal((await get()).note_content,null)
    assert.equal((await call('GET',`/api/events/${id}/export`,owner.cookie)).json().consultation_notes.length,0)
    assert.equal((await call('PUT',`/api/applications/${a.id}/note`,parent.cookie,{content:'Unauthorized',version:1,clientVisible:true})).statusCode,403)
    assert.equal((await saveNote('CLIENT_VISIBLE_NOTE_V2',1)).statusCode,200)
    assert.equal((await get()).note_content,'CLIENT_VISIBLE_NOTE_V2')
    const share=()=>call('POST',`/api/applications/${a.id}/note-shares`,owner.cookie,{recipientId:parent.id,version:2})
    assert.equal((await share()).statusCode,200);assert.equal((await share()).statusCode,200)
    assert.equal((await get()).note_shares.length,1)
    const parentDetail=async()=>(await call('GET',`/api/events/${id}?domain=room`,parent.cookie)).json()
    assert.equal((await parentDetail()).shared_notes[0].content,'CLIENT_VISIBLE_NOTE_V2')
    assert.equal((await call('GET',`/api/events/${id}?domain=room`,other.cookie)).json().shared_notes.length,0)
    assert.equal((await call('POST',`/api/applications/${a.id}/note-shares`,parent.cookie,{recipientId:other.id,version:2})).statusCode,403)
    await call('POST',`/api/events/${id}/messages`,parent.cookie,{content:'请继续房间对话',domain:'room',clientId:randomUUID()})
    const context=await loadAgentContext(s.service.database,{eventId:id,domain:'room',actorId:parent.id})
    assert.ok(!context!.context.includes('CLIENT_VISIBLE_NOTE'));assert.ok(!context!.context.includes('EXPERT_PRIVATE_DRAFT'))
    await processReply(s.service.database,{eventId:id,domain:'room',actorId:parent.id},s.service.notify,model)
    assert.equal((await saveNote('CLIENT_VISIBLE_NOTE_V3',2)).statusCode,200)
    assert.equal((await parentDetail()).shared_notes[0].content,'CLIENT_VISIBLE_NOTE_V2')
    assert.equal((await saveNote('EXPERT_HIDDEN_AGAIN',3,false)).statusCode,200)
    assert.equal((await get()).note_content,null);assert.equal((await get()).note_shares.length,1)
    assert.equal((await call('DELETE',`/api/applications/${a.id}/note-shares/${parent.id}`,owner.cookie)).statusCode,200)
    assert.equal((await parentDetail()).shared_notes.length,0)
    assert.equal((await saveNote('CLIENT_VISIBLE_NOTE_V5',4)).statusCode,200)
    assert.equal((await call('POST',`/api/applications/${a.id}/note-shares`,owner.cookie,{recipientId:parent.id,version:5})).statusCode,200)
    assert.equal((await call('DELETE',`/api/events/${id}/members/${parent.id}`,owner.cookie)).statusCode,200)
    await invite(id,owner.cookie,parent.cookie)
    assert.equal((await parentDetail()).shared_notes.length,0,'rejoining must not reactivate a previous medical-note share')
    const exported=(await call('GET',`/api/events/${id}/export`,owner.cookie)).json()
    assert.equal(exported.applications.length,1);assert.equal(exported.consultation_notes[0].content,'CLIENT_VISIBLE_NOTE_V5');assert.equal(exported.note_shares.length,2)
  }finally{await s.close()}
})

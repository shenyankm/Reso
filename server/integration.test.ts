import {withObservationFixture} from './test-agent'
const processReply=(...args:Parameters<typeof processProductionReply>)=>processProductionReply(args[0],args[1],args[2],args[3]?withObservationFixture(args[3]):undefined,args[4])
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createTestDatabase } from './test-database'
import { createApp } from './app'
import { processReply as processProductionReply } from './worker'
import { asrAuthHeaders } from './asr'
import type { Model } from './agent'
import { localTestPolicy } from '../shared/consent'
import { scqaVersion } from '../shared/scqa'

test('local MVP persists data and enforces private, room and counselor boundaries',{skip:!process.env.DATABASE_URL,timeout:120000},async()=>{
  const testDatabase=await createTestDatabase()
  let service:Awaited<ReturnType<typeof createApp>>|undefined
  try{
    service=await createApp({databaseUrl:testDatabase.runtimeUrl,secret:testDatabase.secret,startJobs:false})
    const {app,database,notify}=service
    const origin='http://localhost:5173'
    const ips=new Map<string,string>();let nextIp=2
    const call=async(method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:string,cookie='',payload?:unknown)=>app.inject({method,url,remoteAddress:cookie?ips.get(cookie)||'127.0.0.1':`127.0.0.${nextIp}`,headers:{origin,...(cookie?{cookie}: {}),...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{payload:JSON.stringify(payload)})})
    const signup=async(name:string)=>{
      const result=await call('POST','/api/auth/sign-up/email','',{name,email:`${name.toLowerCase()}@test.example`,password:randomBytes(18).toString('hex')})
      assert.equal(result.statusCode,200,result.body)
      const headers=result.headers['set-cookie'];const cookie=(Array.isArray(headers)?headers:[headers]).filter(Boolean).map(s=>String(s).split(';')[0]).join('; ')
      assert.ok(cookie)
      ips.set(cookie,`127.0.0.${nextIp++}`)
      assert.equal((await call('GET','/api/me',cookie)).json().consentRequired,false)
      assert.equal((await testDatabase.fixtures.pool.query('SELECT count(*) FROM consent_records WHERE user_id=$1',[result.json().user.id])).rows[0].count,'0')
      assert.equal((await call('POST','/api/consent',cookie,{accepted:true,version:'outdated'})).statusCode,400)
      return{cookie,id:result.json().user.id as string}
    }
    const alice=await signup('Alice'),bob=await signup('Bob'),carol=await signup('Carol'),counselor=await signup('Counselor')
    assert.equal((await call('POST','/api/consent',alice.cookie,{accepted:true,version:localTestPolicy.version})).statusCode,200)
    assert.equal((await testDatabase.fixtures.pool.query('SELECT count(*) FROM consent_records WHERE user_id=$1',[alice.id])).rows[0].count,'1')
    assert.equal((await call('GET','/api/me',alice.cookie)).json().consentRequired,false)
    assert.equal((await call('GET','/api/events')).statusCode,401)
    assert.equal((await app.inject({method:'POST',url:'/api/events',headers:{origin:'https://untrusted.example',cookie:alice.cookie},payload:{title:'blocked'}})).statusCode,403)
    const event=(await call('POST','/api/events',alice.cookie,{title:'我的考试'})).json();const id=event.id
    assert.equal((await call('GET',`/api/events/${id}`,bob.cookie)).statusCode,403)
    const messageId=randomUUID()
    const message=await call('POST',`/api/events/${id}/messages`,alice.cookie,{content:'PRIVATE_ONLY_甲的原文',domain:'private',clientId:messageId})
    assert.equal(message.statusCode,200,message.body)
    const duplicate=await call('POST',`/api/events/${id}/messages`,alice.cookie,{content:'PRIVATE_ONLY_甲的原文',domain:'private',clientId:messageId})
    assert.equal(message.json().id,duplicate.json().id)
    assert.equal((await call('POST',`/api/events/${id}/messages`,alice.cookie,{content:'不同内容',domain:'private',clientId:messageId})).statusCode,409)
    await processReply(database,{eventId:id,domain:'private',actorId:alice.id},notify,async(_prompt,json)=>json?JSON.stringify({intent:'test',strategy:'listen',evidence_ids:[],uncertainty:'',needs_human:false}):'先听你说完。')
    assert.equal((await call('PUT',`/api/events/${id}/questionnaire`,alice.cookie,{answers:Array(24).fill(4),version:scqaVersion,revision:0})).statusCode,200)
    let state=(await call('GET',`/api/events/${id}`,alice.cookie)).json()
    assert.equal(Object.keys(state.questionnaire.scores).length,8)
    assert.equal((await call('POST',`/api/events/${id}/discovery`,alice.cookie,{accepted:false,summary:'',revision:1})).statusCode,200)
    assert.equal((await call('GET',`/api/events/${id}`,alice.cookie)).json().event.initial_summary,'')
    assert.equal((await call('PUT',`/api/events/${id}/exercise`,alice.cookie,{act:2,paused:true,notes:{'1':'我想修正这一幕'},story:'',saved:false,version:0})).statusCode,200)
    assert.equal((await call('PUT',`/api/events/${id}/exercise`,alice.cookie,{act:0,paused:false,notes:{},story:'',saved:false,version:0})).statusCode,409)
    assert.equal((await call('PATCH',`/api/events/${id}`,alice.cookie,{title:'我的考试',summary:'SHARED_我想让努力被看见',version:0})).statusCode,200)
    const invite=(await call('POST',`/api/events/${id}/invites`,alice.cookie,{shareSummary:true,version:1,clientId:randomUUID()})).json()
    assert.ok(invite.token)
    const preview=await call('GET',`/api/invites/${invite.token}`);assert.equal(preview.statusCode,200);assert.ok(!preview.body.includes('SHARED_'))
    assert.deepEqual(Object.keys(preview.json()).sort(),['expires_at','has_summary','status','title'])
    assert.equal((await call('GET',`/api/invites/${invite.token}/details`)).statusCode,401)
    const invitationDetails=await call('GET',`/api/invites/${invite.token}/details`,bob.cookie)
    assert.equal(invitationDetails.statusCode,200)
    assert.deepEqual(invitationDetails.json(),{title:'我的考试',has_summary:true,inviter_name:'Alice',member_names:[]})
    assert.ok(!invitationDetails.body.includes('SHARED_')&&!invitationDetails.body.includes('@')&&!invitationDetails.body.includes('PRIVATE_ONLY_'))
    assert.equal((await call('POST',`/api/invites/${invite.token}/respond`,alice.cookie,{accept:true})).statusCode,409)
    assert.equal((await call('POST',`/api/invites/${invite.token}/respond`,bob.cookie,{accept:true})).statusCode,200)
    assert.equal((await call('POST',`/api/invites/${invite.token}/respond`,bob.cookie,{accept:true})).statusCode,200)
    assert.equal((await call('PATCH',`/api/events/${id}`,alice.cookie,{title:'NEW_PRIVATE_TITLE',summary:'NEW_PRIVATE_不应扩散',version:1})).statusCode,200)
    const room=await call('GET',`/api/events/${id}?domain=room`,bob.cookie)
    assert.equal(room.statusCode,200)
    assert.equal(room.json().snapshots[0].content,'SHARED_我想让努力被看见')
    assert.equal(room.json().snapshots[0].version,1)
    assert.ok(Number.isFinite(Date.parse(room.json().snapshots[0].granted_at)))
    assert.deepEqual(room.json().invites,[])
    const ownerSharing=(await call('GET',`/api/events/${id}`,alice.cookie)).json()
    assert.equal(ownerSharing.event.summary,'NEW_PRIVATE_不应扩散')
    assert.equal(ownerSharing.snapshots[0].content,'SHARED_我想让努力被看见')
    assert.equal(ownerSharing.invites[0].shared_content,'SHARED_我想让努力被看见')
    assert.equal(ownerSharing.invites[0].source_version,1)
    assert.ok(Number.isFinite(Date.parse(ownerSharing.invites[0].created_at)))
    assert.equal(room.json().event.summary,'');assert.equal(room.json().questionnaire,null);assert.equal(room.json().exercise,null)
    assert.ok(!room.body.includes('PRIVATE_ONLY_'));assert.ok(!room.body.includes('NEW_PRIVATE_'));assert.ok(!room.body.includes('NEW_PRIVATE_TITLE'))
    assert.equal((await call('GET',`/api/events/${id}/export`,bob.cookie)).statusCode,403)
    await call('POST',`/api/events/${id}/messages`,bob.cookie,{content:'我愿意一起说说',domain:'room',clientId:randomUUID()})
    assert.equal((await call('PUT',`/api/events/${id}/perspective`,alice.cookie,{text:'OWNER_PERSPECTIVE_我的表达',confirmed:true,version:0})).statusCode,200)
    let captured=''
    const fake:Model=async(prompt,json)=>{captured+=prompt;if(json){const context=JSON.parse(prompt.split('授权上下文：')[1].split('\n')[0]);return JSON.stringify({intent:'核对',strategy:'listen',evidence_ids:[context.messages.at(-1).id],uncertainty:'',needs_human:false})}return'我们可以分别说说，不必急着得出同一个答案。'}
    await processReply(database,{eventId:id,domain:'room',actorId:bob.id},notify,fake)
    assert.ok(captured.includes('OWNER_PERSPECTIVE_'));assert.ok(captured.includes('SHARED_'));assert.ok(!captured.includes('PRIVATE_ONLY_'));assert.ok(!captured.includes('NEW_PRIVATE_'));assert.ok(!captured.includes('academic_down'))
    const successRun=(await testDatabase.fixtures.pool.query("SELECT * FROM agent_runs WHERE event_id=$1 AND status='complete'",[id])).rows[0]
    assert.ok(successRun.trigger_message_id);assert.ok(successRun.response_message_id);assert.ok(successRun.prompt_version);assert.ok(successRun.finished_at);assert.equal(successRun.error_code,null)
    assert.equal((await call('DELETE',`/api/events/${id}/shares/${bob.id}`,bob.cookie)).statusCode,403)
    assert.equal((await call('DELETE',`/api/events/${id}/shares/${bob.id}`,carol.cookie)).statusCode,403)
    assert.equal((await call('DELETE',`/api/events/${id}/shares/${bob.id}`,alice.cookie)).statusCode,200)
    const unshared=(await call('GET',`/api/events/${id}?domain=room`,bob.cookie)).json()
    assert.equal(unshared.snapshots.length,0);assert.ok(unshared.members.some((m:{user_id:string})=>m.user_id===bob.id))
    assert.equal((await call('POST',`/api/events/${id}/messages`,bob.cookie,{content:'撤回摘要后仍能聊天',domain:'room',clientId:randomUUID()})).statusCode,200)
    captured='';await processReply(database,{eventId:id,domain:'room',actorId:bob.id},notify,fake);assert.ok(!captured.includes('SHARED_'))
    assert.equal((await call('PUT',`/api/events/${id}/shares/${bob.id}`,alice.cookie,{version:1})).statusCode,409)
    assert.equal((await call('PUT',`/api/events/${id}/shares/${bob.id}`,alice.cookie,{version:2})).statusCode,200)
    assert.equal((await call('PUT',`/api/events/${id}/shares/${bob.id}`,alice.cookie,{version:2})).statusCode,200)
    const grants=(await testDatabase.fixtures.pool.query('SELECT g.revoked_at,s.content FROM share_grants g JOIN share_snapshots s ON s.id=g.snapshot_id WHERE g.event_id=$1 AND g.recipient_id=$2 ORDER BY g.granted_at',[id,bob.id])).rows
    assert.equal(grants.length,2);assert.ok(grants[0].revoked_at);assert.equal(grants[0].content,'SHARED_我想让努力被看见');assert.equal(grants[1].revoked_at,null)
    await call('POST',`/api/events/${id}/messages`,bob.cookie,{content:'并发授权变更测试',domain:'room',clientId:randomUUID()})
    const beforeStale=await testDatabase.fixtures.pool.query("SELECT count(*) FROM messages WHERE event_id=$1 AND role='assistant'",[id])
    const stale:Model=async(prompt,json)=>{if(json)return fake(prompt,json);assert.equal((await call('DELETE',`/api/events/${id}/shares/${bob.id}`,alice.cookie)).statusCode,200);return 'STALE_OUTPUT_MUST_NOT_PUBLISH'}
    await assert.rejects(processReply(database,{eventId:id,domain:'room',actorId:bob.id},notify,stale),/CONTEXT_CHANGED/)
    const afterStale=await testDatabase.fixtures.pool.query("SELECT count(*) FROM messages WHERE event_id=$1 AND role='assistant'",[id]);assert.equal(afterStale.rows[0].count,beforeStale.rows[0].count)
    const staleRun=(await testDatabase.fixtures.pool.query("SELECT * FROM agent_runs WHERE event_id=$1 AND error_code='CONTEXT_CHANGED'",[id])).rows[0]
    assert.equal(staleRun.status,'error');assert.ok(staleRun.finished_at);assert.equal(staleRun.response_message_id,null)
    await processReply(database,{eventId:id,domain:'room',actorId:bob.id},notify,fake)
    assert.equal((await call('PUT',`/api/events/${id}/shares/${bob.id}`,alice.cookie,{version:2})).statusCode,200)
    const noShare=(await call('POST',`/api/events/${id}/invites`,alice.cookie,{shareSummary:false,version:2,clientId:randomUUID()})).json()
    const withMember=(await call('GET',`/api/invites/${noShare.token}/details`,carol.cookie)).json()
    assert.equal(withMember.inviter_name,'Alice');assert.deepEqual(withMember.member_names,['Bob'])
    assert.ok(!JSON.stringify(withMember).includes('NEW_PRIVATE_'))
    await call('POST',`/api/invites/${noShare.token}/respond`,carol.cookie,{accept:true})
    assert.equal((await call('GET',`/api/invites/${noShare.token}/details`,carol.cookie)).statusCode,410)
    await call('POST',`/api/events/${id}/messages`,bob.cookie,{content:'让我们继续',domain:'room',clientId:randomUUID()});captured=''
    await processReply(database,{eventId:id,domain:'room',actorId:bob.id},notify,fake)
    assert.ok(!captured.includes('NEW_PRIVATE_'),'a snapshot granted to Bob must not be broadcast to ungranted Carol through the model')
    assert.equal((await call('PUT',`/api/events/${id}/shares/${carol.id}`,alice.cookie,{version:2})).statusCode,200)
    await call('POST',`/api/events/${id}/messages`,bob.cookie,{content:'所有当前成员获准阅读同一版本',domain:'room',clientId:randomUUID()});captured=''
    await processReply(database,{eventId:id,domain:'room',actorId:bob.id},notify,fake)
    assert.ok(captured.includes('NEW_PRIVATE_'),'a common snapshot must be available when all current members hold a grant')
    await call('POST',`/api/events/${id}/messages`,bob.cookie,{content:'测试无需介入',domain:'room',clientId:randomUUID()})
    await processProductionReply(database,{eventId:id,domain:'room',actorId:bob.id},notify,withObservationFixture(async(_prompt,json)=>{assert.equal(json,true);return JSON.stringify({intent:'旁听',strategy:'silent',evidence_ids:[],uncertainty:'',needs_human:false})},{room_intervention_needed:false}))
    const silentRun=(await testDatabase.fixtures.pool.query("SELECT * FROM agent_runs WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1",[id])).rows[0]
    assert.equal(silentRun.status,'complete');assert.equal(silentRun.response_message_id,null);assert.ok(silentRun.finished_at)
    assert.equal((await call('PUT',`/api/events/${id}/perspective`,bob.cookie,{text:'我在意的事',confirmed:true,version:0})).statusCode,200)
    state=(await call('GET',`/api/events/${id}?domain=room`,alice.cookie)).json();assert.equal(state.perspectives.length,2);assert.ok(state.perspectives.some((p:{user_id:string})=>p.user_id===bob.id))
    const peopleBefore=(await call('GET','/api/people',bob.cookie)).json();assert.ok(peopleBefore.some((p:{user_id:string})=>p.user_id===alice.id))
    assert.equal((await call('DELETE',`/api/events/${id}/members/${bob.id}`,alice.cookie)).statusCode,200)
    assert.equal((await call('GET','/api/people',bob.cookie)).json().length,0)
    assert.equal((await call('GET',`/api/events/${id}?domain=room`,bob.cookie)).statusCode,403)
    assert.equal((await call('PUT',`/api/events/${id}/shares/${bob.id}`,alice.cookie,{version:2})).statusCode,409)
    assert.equal((await call('POST',`/api/events/${id}/messages`,bob.cookie,{content:'撤回后不能发送',domain:'room',clientId:randomUUID()})).statusCode,403)
    await call('POST',`/api/events/${id}/messages`,alice.cookie,{content:'测试失败记录',domain:'private',clientId:randomUUID()})
    await assert.rejects(processReply(database,{eventId:id,domain:'private',actorId:alice.id},notify,async()=>{throw new Error('MODEL_HTTP_503')}),/MODEL_HTTP_503/)
    const failedRun=(await testDatabase.fixtures.pool.query("SELECT * FROM agent_runs WHERE event_id=$1 AND error_code='MODEL_HTTP_503'",[id])).rows[0]
    assert.equal(failedRun.status,'error');assert.ok(failedRun.trigger_message_id);assert.ok(failedRun.response_message_id);assert.ok(failedRun.finished_at)
    const consultantId=randomUUID()
    await testDatabase.fixtures.pool.query("UPDATE profiles SET role='counselor' WHERE user_id=$1",[counselor.id])
    await testDatabase.fixtures.pool.query('INSERT INTO consultants(id,user_id,name,approach,qualifications,price,test_only,verified_at) VALUES($1,$2,$3,$4,$5,$6,false,now())',[consultantId,counselor.id,'本地测试老师','测试','非真实资质','本地测试不收费'])
    const apply=await call('POST',`/api/events/${id}/applications`,alice.cookie,{consultantId,shareSummary:false,version:2,clientId:randomUUID()});assert.equal(apply.statusCode,200,apply.body)
    const applicationId=apply.json().id
    const inbox=await call('GET','/api/counselor/applications',counselor.cookie);assert.equal(inbox.statusCode,200);assert.equal(inbox.json()[0].shared_summary,null);assert.ok(!inbox.body.includes('PRIVATE_ONLY_'))
    assert.equal((await call('GET',`/api/events/${id}?domain=room`,counselor.cookie)).statusCode,403)
    assert.equal((await call('PATCH',`/api/applications/${applicationId}`,alice.cookie,{status:'accepted'})).statusCode,403)
    assert.equal((await call('PATCH',`/api/applications/${applicationId}`,counselor.cookie,{status:'accepted'})).statusCode,200)
    assert.equal((await call('PATCH',`/api/applications/${applicationId}`,counselor.cookie,{status:'proposed',scheduledAt:new Date(Date.now()+86400000).toISOString()})).statusCode,200)
    const proposed=(await call('GET',`/api/events/${id}`,alice.cookie)).json().applications.find((a:{id:string})=>a.id===applicationId)
    assert.equal((await call('POST',`/api/applications/${applicationId}/appointment-response`,alice.cookie,{accepted:true,version:proposed.schedule_version})).statusCode,200)
    assert.equal((await call('PATCH',`/api/applications/${applicationId}`,alice.cookie,{status:'cancelled'})).statusCode,200)
    if(!asrAuthHeaders())assert.equal((await call('POST','/api/asr',alice.cookie)).statusCode,503)
    // Historical development receipts no longer gate writes or model processing.
    await testDatabase.fixtures.pool.query("UPDATE consent_records SET policy_version='previous-policy' WHERE user_id=$1",[alice.id])
    assert.equal((await call('GET','/api/me',alice.cookie)).json().consentRequired,false)
    assert.equal((await call('POST',`/api/events/${id}/messages`,alice.cookie,{content:'直接继续聊天',domain:'private',clientId:randomUUID()})).statusCode,200)
    assert.equal((await call('GET',`/api/events/${id}/export`,alice.cookie)).statusCode,200)
    let callsWithoutReceipt=0;await processReply(database,{eventId:id,domain:'private',actorId:alice.id},notify,async(prompt,json)=>{callsWithoutReceipt++;return fake(prompt,json)});assert.ok(callsWithoutReceipt>0)
    assert.equal((await testDatabase.fixtures.pool.query('SELECT count(*) FROM consent_records WHERE user_id=$1 AND policy_version=$2',[alice.id,localTestPolicy.version])).rows[0].count,'0')
    assert.equal((await call('DELETE',`/api/events/${id}/shares/${carol.id}`,alice.cookie)).statusCode,200)
    assert.equal((await call('POST','/api/consent',alice.cookie,{accepted:true,version:localTestPolicy.version})).statusCode,200)
    const disposable=(await call('POST','/api/events',alice.cookie,{title:'级联删除测试'})).json().id
    await call('PATCH',`/api/events/${disposable}`,alice.cookie,{title:'级联删除测试',summary:'仅测试数据',version:0})
    await call('POST',`/api/events/${disposable}/invites`,alice.cookie,{shareSummary:true,version:1,clientId:randomUUID()})
    assert.equal((await call('DELETE',`/api/events/${disposable}`,alice.cookie)).statusCode,200)
    assert.equal((await testDatabase.fixtures.pool.query('SELECT count(*) FROM share_snapshots WHERE event_id=$1',[disposable])).rows[0].count,'0')
    const stored=(await call('GET',`/api/events/${id}`,alice.cookie)).json();assert.equal(stored.exercise.act,2);assert.equal(stored.exercise.notes['1'],'我想修正这一幕')
    await service.app.close();service=await createApp({databaseUrl:testDatabase.runtimeUrl,secret:testDatabase.secret,startJobs:false})
    const persisted=await service.database.pool.query('SELECT count(*) FROM messages WHERE event_id=$1',[id]);assert.ok(Number(persisted.rows[0].count)>2)
  }finally{if(service)await service.app.close();await testDatabase.cleanup()}
})

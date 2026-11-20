import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {createApp} from './app'
import {createTestDatabase} from './test-database'
import type {SavedRecordPage} from '../shared/types'

test('profile edits and saved records stay within the signed-in account',{skip:!process.env.DATABASE_URL,timeout:120000},async()=>{
  const fixture=await createTestDatabase()
  let service:Awaited<ReturnType<typeof createApp>>|undefined
  try{
    service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
    service.app.get('/api/test-client-ip',request=>({ip:request.ip}))
    const call=(method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:string,cookie='',payload?:unknown)=>service!.app.inject({method,url,headers:{origin:'http://localhost:5173',cookie,...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{payload:JSON.stringify(payload)})})
    async function signup(name:string){
      const result=await call('POST','/api/auth/sign-up/email','',{name,email:`${name}@example.test`,password:randomBytes(18).toString('hex')})
      assert.equal(result.statusCode,200,result.body)
      const cookies=result.headers['set-cookie']
      return {id:result.json().user.id as string,cookie:(Array.isArray(cookies)?cookies:[cookies]).map(value=>String(value).split(';')[0]).join('; ')}
    }
    const alice=await signup('alice'),bob=await signup('bob')
    for(const [remoteAddress,expected] of [['127.0.0.1','203.0.113.8'],['192.0.2.8','192.0.2.8']]){
      assert.equal((await service.app.inject({method:'GET',url:'/api/test-client-ip',remoteAddress,headers:{cookie:alice.cookie,'x-forwarded-for':'203.0.113.8'}})).json().ip,expected)
    }
    assert.equal((await call('PATCH','/api/me','',{name:'unknown'})).statusCode,401)
    assert.equal((await call('GET','/api/me/records')).statusCode,401)
    for(const name of ['', '   ', 'x'.repeat(51)])assert.equal((await call('PATCH','/api/me',alice.cookie,{name})).statusCode,400)
    assert.equal((await call('PATCH','/api/me',alice.cookie,{name:'Alice',id:bob.id})).statusCode,400)
    assert.equal((await call('PATCH','/api/me',alice.cookie,{name:'  新的称呼  '})).json().user.name,'新的称呼')
    assert.equal((await call('GET','/api/auth/get-session',alice.cookie)).json().user.name,'新的称呼')
    assert.equal((await call('GET','/api/me',bob.cookie)).json().user.name,'bob')
    assert.deepEqual((await call('GET','/api/me/records',alice.cookie)).json(),{records:[],nextOffset:null})

    const event=(await call('POST','/api/events',alice.cookie,{title:'我的私人事件'})).json()
    const draft={act:5,paused:false,notes:{},story:'未确认保存的故事',saved:false,version:0,practice_notes:{nvc:{observation:'  \n\t '}}}
    assert.equal((await call('PUT',`/api/events/${event.id}/exercise`,alice.cookie,draft)).statusCode,200)
    assert.equal((await call('GET','/api/me/records',alice.cookie)).json().records.length,0)
    assert.deepEqual((await call('GET','/api/me/records?kind=story',alice.cookie)).json(),{records:[],nextOffset:null})
    assert.equal((await call('PUT',`/api/events/${event.id}/exercise`,alice.cookie,{...draft,saved:true,version:1,practice_notes:{nvc:{feeling:'想被听见'},roleplay:{my_words:'我想说完'}}})).statusCode,200)
    const invite=(await call('POST',`/api/events/${event.id}/invites`,alice.cookie,{shareSummary:false,version:0,clientId:randomUUID()})).json()
    assert.equal((await call('POST',`/api/invites/${invite.token}/respond`,bob.cookie,{accept:true})).statusCode,200)
    assert.deepEqual((await call('GET','/api/me/records',bob.cookie)).json(),{records:[],nextOffset:null})
    assert.deepEqual((await call('GET','/api/me/records?kind=story',bob.cookie)).json(),{records:[],nextOffset:null})

    for(let i=0;i<23;i++)await fixture.fixtures.pool.query('INSERT INTO followups(id,event_id,user_id,reflection) VALUES($1,$2,$3,$4)',[randomUUID(),event.id,alice.id,`私人回访 ${i}`])
    const first=(await call('GET','/api/me/records',alice.cookie)).json<SavedRecordPage>()
    const second=(await call('GET',`/api/me/records?offset=${first.nextOffset}`,alice.cookie)).json<SavedRecordPage>()
    assert.equal(first.records.length,20);assert.equal(first.nextOffset,20)
    assert.equal(second.records.length,6);assert.equal(second.nextOffset,null)
    const all=[...first.records,...second.records]
    assert.equal(new Set(all.map(row=>`${row.kind}:${row.id}`)).size,26)
    assert.deepEqual([...new Set(all.map(row=>row.kind))].sort(),['followup','nvc','roleplay','story'])
    assert.ok(all.every(row=>row.event_id===event.id&&row.event_title==='我的私人事件'&&Number.isFinite(Date.parse(row.updated_at))))
    const stories=(await call('GET','/api/me/records?kind=story',alice.cookie)).json<SavedRecordPage>()
    assert.deepEqual(stories,{records:all.filter(record=>record.kind==='story'),nextOffset:null})
    for(const offset of ['-1','1.5','1000001','nope'])assert.equal((await call('GET',`/api/me/records?offset=${offset}`,alice.cookie)).statusCode,400)
    const consultantId=randomUUID()
    await fixture.fixtures.pool.query("INSERT INTO consultants(id,user_id,name,approach,qualifications,price,test_only,verified_at) VALUES($1,$2,'测试支持老师','测试','测试','测试',false,now())",[consultantId,bob.id])
    await fixture.fixtures.pool.query("INSERT INTO applications(id,client_id,event_id,applicant_id,consultant_id,shared_summary) VALUES($1,$2,$3,$4,$5,'PRIVATE_SUMMARY')",[randomUUID(),randomUUID(),event.id,alice.id,consultantId])
    assert.equal((await call('GET','/api/me/applications')).statusCode,401)
    assert.deepEqual((await call('GET','/api/me/applications',bob.cookie)).json(),[])
    const support=(await call('GET','/api/me/applications',alice.cookie)).json()
    assert.equal(support.length,1);assert.equal(support[0].status,'pending');assert.equal(support[0].event_title,'我的私人事件');assert.equal(support[0].test_only,false);assert.equal('shared_summary' in support[0],false)
    assert.equal((await call('DELETE',`/api/events/${event.id}`,alice.cookie)).statusCode,200)
    assert.deepEqual((await call('GET','/api/me/records',alice.cookie)).json(),{records:[],nextOffset:null})
  }finally{await service?.app.close();await fixture.cleanup()}
})

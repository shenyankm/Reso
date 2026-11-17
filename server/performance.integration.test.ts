import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {createTestDatabase} from './test-database'
import {createApp} from './app'
import {localTestPolicy} from '../shared/consent'
import type {MessagePage} from '../shared/types'

test('lightweight history preserves cursor ordering and domain permissions without loading event metadata',{skip:!process.env.DATABASE_URL},async()=>{
  const fixture=await createTestDatabase()
  const service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
  const origin='http://localhost:5173'
  try{
    const signup=async(name:string,ip:number)=>{
      const result=await service.app.inject({method:'POST',url:'/api/auth/sign-up/email',remoteAddress:`127.2.0.${ip}`,headers:{origin},payload:{name,email:`${name}@performance.test`,password:randomBytes(18).toString('hex')}})
      assert.equal(result.statusCode,200,result.body)
      const cookies=result.headers['set-cookie'],cookie=(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(value=>String(value).split(';')[0]).join('; ')
      assert.equal((await service.app.inject({method:'POST',url:'/api/consent',remoteAddress:`127.2.0.${ip}`,headers:{origin,cookie},payload:{accepted:true,version:localTestPolicy.version}})).statusCode,200)
      return{id:result.json().user.id,cookie}
    }
    const owner=await signup('owner',2),member=await signup('member',3),stranger=await signup('stranger',4)
    const id=randomUUID()
    await fixture.fixtures.pool.query("INSERT INTO events(id,owner_id,title) VALUES($1,$2,'History')",[id,owner.id])
    await fixture.fixtures.pool.query('INSERT INTO members(event_id,user_id) VALUES($1,$2)',[id,member.id])
    await fixture.fixtures.pool.query("INSERT INTO messages(event_id,author_id,author_name,domain,role,content) SELECT $1,$2,'Owner','private','user','PRIVATE_HISTORY_'||n FROM generate_series(1,120) n",[id,owner.id])
    await fixture.fixtures.pool.query("INSERT INTO messages(event_id,author_id,author_name,domain,role,content) SELECT $1,$2,'Owner','room','user','ROOM_HISTORY_'||n FROM generate_series(1,75) n",[id,owner.id])
    await fixture.fixtures.pool.query("INSERT INTO exercises(event_id,story) VALUES($1,'PRIVATE_STORY')",[id])
    const read=(path:string,cookie=owner.cookie)=>service.app.inject({method:'GET',url:`/api/events/${id}${path}`,headers:{origin,cookie}})
    const collected:string[]=[]
    let before='',hasMore=true
    while(hasMore){
      const response=await read(`/messages?domain=private${before?`&before=${before}`:''}`)
      assert.equal(response.statusCode,200,response.body)
      const page=response.json<MessagePage>()
      assert.deepEqual(Object.keys(page).sort(),['hasMore','messages'])
      assert.ok(page.messages.length<=50);assert.ok(page.messages.every(message=>message.domain==='private'))
      assert.ok(page.messages.every((message,index)=>index===0||BigInt(message.id)>BigInt(page.messages[index-1].id)))
      collected.push(...page.messages.map(message=>message.id));before=page.messages[0].id;hasMore=page.hasMore
    }
    assert.equal(collected.length,120);assert.equal(new Set(collected).size,120)
    const first=(await read('/messages?domain=private')).json<MessagePage>()
    const legacy=(await read(`?domain=private&before=${first.messages[0].id}`)).json()
    const lightweight=(await read(`/messages?domain=private&before=${first.messages[0].id}`)).json<MessagePage>()
    assert.deepEqual(lightweight,{messages:legacy.messages,hasMore:legacy.hasMore})
    assert.equal((await read('/messages?domain=private',member.cookie)).statusCode,403)
    assert.equal((await read('/messages?domain=room',stranger.cookie)).statusCode,403)
    const room=await read('/messages?domain=room',member.cookie)
    assert.equal(room.statusCode,200);assert.ok(!room.body.includes('PRIVATE_'))
    assert.equal(room.json<MessagePage>().messages.length,50)
    for(const cursor of ['invalid','9'.repeat(100),'9999999999999999999'])assert.equal((await read(`/messages?before=${cursor}`)).statusCode,400)
    assert.equal((await read('/messages','')).statusCode,401)
    await fixture.fixtures.pool.query('UPDATE members SET active=false WHERE event_id=$1 AND user_id=$2',[id,member.id])
    assert.equal((await read('/messages?domain=room',member.cookie)).statusCode,403)
  }finally{await service.app.close();await fixture.cleanup()}
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import https from 'node:https'
import {createServer,request} from 'node:http'
import {createTestDatabase} from './test-database'
import {createApp} from './app'

test('upstream ASR authorization failures preserve the user login',{skip:!process.env.DATABASE_URL,timeout:120000},async t=>{
  const fixture=await createTestDatabase(),previous=process.env.DOUBAO_ASR_API_KEY
  let service:Awaited<ReturnType<typeof createApp>>|undefined
  const upstream=createServer((_request,response)=>response.writeHead(401).end())
  try{
    await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve))
    const address=upstream.address();assert.ok(address&&typeof address==='object')
    process.env.DOUBAO_ASR_API_KEY='synthetic-asr-secret'
    t.mock.method(https,'request',()=>request({hostname:'127.0.0.1',port:address.port}))
    t.mock.method(console,'error',()=>{})
    service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret,startJobs:false})
    const origin='http://localhost:5173'
    const signup=await service.app.inject({method:'POST',url:'/api/auth/sign-up/email',headers:{origin},payload:{name:'ASR test',email:'asr@example.test',password:randomBytes(20).toString('hex')}})
    assert.equal(signup.statusCode,200)
    const cookies=signup.headers['set-cookie'],cookie=(Array.isArray(cookies)?cookies:[cookies]).map(value=>String(value).split(';')[0]).join('; ')
    const form=new FormData();form.append('audio',new Blob([new Uint8Array(320)],{type:'application/octet-stream'}),'synthetic.pcm')
    const upload=new Request('http://localhost/api/asr',{method:'POST',body:form})
    const result=await service.app.inject({method:'POST',url:'/api/asr',headers:{origin,cookie,'content-type':upload.headers.get('content-type')!},payload:Buffer.from(await upload.arrayBuffer())})
    assert.equal(result.statusCode,503);assert.match(result.json().error,/授权未通过.*录音已保留/)
    assert.equal((await service.app.inject({method:'GET',url:'/api/me',headers:{cookie}})).statusCode,200)
  }finally{
    if(previous===undefined)delete process.env.DOUBAO_ASR_API_KEY;else process.env.DOUBAO_ASR_API_KEY=previous
    upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()))
    await service?.app.close();await fixture.cleanup()
  }
})

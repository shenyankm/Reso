import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { scoreScqa, scales } from '../shared/scqa'
import { asrAuthHeaders, decodeFrame, encodeFrame, transcribe } from './asr'
import { createAgent as createProductionAgent, explicitDanger, safetyReply } from './agent'
import {Pool} from 'pg'
import {createAuth} from './auth'
import https from 'node:https'
import {createServer,request} from 'node:http'

import {withObservationFixture} from './test-agent'
const createAgent=(...args:Parameters<typeof createProductionAgent>)=>createProductionAgent(args[0]?withObservationFixture(args[0]):undefined,args[1],args[2])
test('SCQA keeps eight independent means and validates every answer',()=>{
  const answers=Array.from({length:24},(_,i)=>i%6+1)
  const scores=scoreScqa(answers)
  assert.equal(Object.keys(scores).length,8)
  for(const scale of scales)assert.equal(scores[scale.id],scale.items.reduce((n,i)=>n+answers[i-1],0)/3)
  assert.deepEqual(scales.flatMap(s=>s.items).sort((a,b)=>a-b),Array.from({length:24},(_,i)=>i+1))
  assert.throws(()=>scoreScqa(Array(23).fill(1)))
  assert.throws(()=>scoreScqa([...Array(23).fill(1),7]))
  assert.throws(()=>scoreScqa([...Array(23).fill(1),NaN]))
})

test('ASR accepts either complete auth mode, prefers API Key and rejects partial credentials',()=>{
  assert.equal(asrAuthHeaders({}),null)
  assert.equal(asrAuthHeaders({DOUBAO_ASR_APP_ID:'test-app'}),null)
  assert.equal(asrAuthHeaders({DOUBAO_ASR_ACCESS_TOKEN:'test-token'}),null)
  assert.equal(asrAuthHeaders({DOUBAO_ASR_APP_ID:'test-app',DOUBAO_ASR_ACCESS_TOKEN:'  '}),null)
  const legacy={DOUBAO_ASR_APP_ID:' test-app ',DOUBAO_ASR_ACCESS_TOKEN:' test-token '}
  assert.deepEqual(asrAuthHeaders(legacy),{'X-Api-App-Key':'test-app','X-Api-Access-Key':'test-token'})
  assert.deepEqual(asrAuthHeaders({...legacy,DOUBAO_ASR_API_KEY:' test-key '}),{'X-Api-Key':'test-key'})
  assert.deepEqual(asrAuthHeaders({...legacy,DOUBAO_ASR_API_KEY:' '}),{'X-Api-App-Key':'test-app','X-Api-Access-Key':'test-token'})
})

test('ASR protocol handles final response, framing errors and provider errors',()=>{
  const payload=gzipSync(Buffer.from(JSON.stringify({result:{text:'想说的话'}})))
  const size=Buffer.alloc(4);size.writeUInt32BE(payload.length)
  const seq=Buffer.alloc(4);seq.writeInt32BE(-1)
  const frame=Buffer.concat([Buffer.from([0x11,0x93,0x11,0]),seq,size,payload])
  assert.deepEqual(decodeFrame(frame),{final:true,text:'想说的话'})
  assert.equal(encodeFrame(2,2,false,Buffer.alloc(320))[1],0x22)
  assert.throws(()=>decodeFrame(Buffer.from([0x11])))
  assert.throws(()=>decodeFrame(frame.subarray(0,frame.length-2)))
  assert.throws(()=>decodeFrame(Buffer.from([0x11,0xf0,0,0,0,0,0,1])),/ASR_PROVIDER_1/)
})

test('ASR identifies rejected credentials without logging keys or response bodies',async t=>{
  let status=401
  const server=createServer((_request,response)=>response.writeHead(status,{'X-Tt-Logid':'synthetic-log-id'}).end('sensitive-upstream-body'))
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();assert.ok(address&&typeof address==='object')
  const previous=process.env.DOUBAO_ASR_API_KEY,logs:unknown[][]=[]
  process.env.DOUBAO_ASR_API_KEY='synthetic-asr-secret'
  t.mock.method(https,'request',()=>request({hostname:'127.0.0.1',port:address.port}))
  t.mock.method(console,'error',(...args:unknown[])=>{logs.push(args)})
  try{
    for(const code of [401,403,500]){status=code;await assert.rejects(transcribe(Buffer.alloc(320)),new RegExp(code===500?'ASR_CONNECTION_FAILED':'ASR_AUTH_FAILED'))}
    assert.equal(logs.length,3)
    assert.match(JSON.stringify(logs),/synthetic-log-id/)
    assert.doesNotMatch(JSON.stringify(logs),/synthetic-asr-secret|sensitive-upstream-body/)
  }finally{
    if(previous===undefined)delete process.env.DOUBAO_ASR_API_KEY;else process.env.DOUBAO_ASR_API_KEY=previous
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
  }
})

test('explicit danger bypasses model calls and enters safety support',async()=>{
  assert.equal(explicitDanger('我想听一首歌'),false)
  let calls=0
  const graph=createAgent(async()=>{calls++;throw new Error('should not call provider')})
  const result=await graph.invoke({input:{domain:'private',context:'',lastMessage:'我不想活了',messageIds:['1']}})
  assert.equal(calls,0);assert.equal(result.reply,safetyReply)
})

test('assessment cannot cite nonexistent evidence or silence private conversation',async()=>{
  const invalid=createAgent(async()=>JSON.stringify({intent:'倾诉',strategy:'listen',evidence_ids:['not-present'],uncertainty:'',needs_human:false}))
  await assert.rejects(invalid.invoke({input:{domain:'private',context:'',lastMessage:'有点委屈',messageIds:['1']}}),/UNKNOWN_EVIDENCE/)
  const graph=createAgent(async(_prompt,json)=>json?JSON.stringify({intent:'倾诉',strategy:'silent',evidence_ids:['1'],uncertainty:'',needs_human:false}):'我听到了。你想先说说哪一部分？')
  const result=await graph.invoke({input:{domain:'private',context:'',lastMessage:'有点委屈',messageIds:['1']}})
  assert.equal(result.assessment?.strategy,'listen');assert.ok(result.reply)
})

test('an already cancelled ASR request does not open an unhandled WebSocket',async t=>{
  const previous=process.env.DOUBAO_ASR_API_KEY
  process.env.DOUBAO_ASR_API_KEY='unit-test'
  t.after(()=>{if(previous===undefined)delete process.env.DOUBAO_ASR_API_KEY;else process.env.DOUBAO_ASR_API_KEY=previous})
  await assert.rejects(transcribe(Buffer.alloc(320),AbortSignal.abort()),/ASR_CANCELLED/)
})

test('HTTPS origins use secure session cookies and trusted origins tolerate whitespace',async t=>{
  const previous={PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN,TRUSTED_ORIGINS:process.env.TRUSTED_ORIGINS},pool=new Pool()
  t.after(async()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value}await pool.end()})
  process.env.PUBLIC_ORIGIN='https://reso.test';process.env.TRUSTED_ORIGINS=' https://reso.test, http://localhost:5173 '
  const secure=createAuth(pool,'unit-test-session-secret-1234567890123456789').options
  assert.equal(secure.advanced?.useSecureCookies,true)
  assert.deepEqual(secure.trustedOrigins,['https://reso.test','http://localhost:5173'])
  process.env.PUBLIC_ORIGIN='http://localhost:5173'
  assert.equal(createAuth(pool,'unit-test-session-secret-1234567890123456789').options.advanced?.useSecureCookies,false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createTestDatabase} from '../server/test-database'
import {createApp} from '../server/app'
import {processReply} from '../server/worker'
import type {ReplyJob} from '../server/worker'

if(process.env.E2E_LIVE!=='1')throw Error('Live tests call paid providers. Run E2E_LIVE=1 npm run test:e2e:live explicitly.')

test('live provider acceptance with synthetic data',{timeout:180000},async t=>{
  const artifacts=join('.data','e2e-live',new Date().toISOString().replace(/[:.]/g,'-'))
  await mkdir(artifacts,{recursive:true,mode:0o700})
  const fixture=await createTestDatabase(),report:{provider:string;passed:boolean;code?:string}[]=[]
  let service:Awaited<ReturnType<typeof createApp>>|undefined
  try{
    service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret})
    await service.app.listen({host:'127.0.0.1',port:0})
    const address=service.app.server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/api`
    const origin=process.env.PUBLIC_ORIGIN||'http://localhost:5173'
    const signup=await fetch(base+'/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'小禾（模拟体验）',email:`live-${randomBytes(6).toString('hex')}@example.test`,password:randomBytes(20).toString('hex')})})
    assert.equal(signup.status,200);const cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
    const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'}
    await t.test('real model via message HTTP, durable queue, worker and stored reply',async()=>{
      let passed=false,code=''
      try{
        assert.ok(process.env.DEEPSEEK_API_KEY,'DeepSeek is not configured')
        await service!.queue!.work<ReplyJob>('agent.reply',{batchSize:1,pollingIntervalSeconds:.5},async jobs=>{for(const job of jobs)await processReply(service!.database,job.data,service!.notify,undefined,job.signal)})
        const event=await(await fetch(base+'/events',{method:'POST',headers,body:JSON.stringify({title:'和妈妈商量学习与休息（模拟）'})})).json()
        const sent=await fetch(base+`/events/${event.id}/messages`,{method:'POST',headers,body:JSON.stringify({content:'昨晚我和妈妈因为休息时间吵了起来。我已经写完作业，但她一进门就说我只知道玩，我又委屈又生气。',domain:'private',clientId:randomUUID()})});assert.equal(sent.status,200)
        const deadline=Date.now()+100000
        let response:any
        while(Date.now()<deadline){const d=await(await fetch(base+`/events/${event.id}`,{headers})).json();response=d.messages.find((m:any)=>m.role==='assistant');if(response)break;await new Promise(r=>setTimeout(r,300))}
        const runs=await fixture.fixtures.pool.query('SELECT status,error_code FROM agent_runs WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1',[event.id]);code=runs.rows[0]?.error_code||'NO_REPLY'
        assert.ok(response,'No reply reached the HTTP detail endpoint');assert.equal(response.status,'complete',`Provider result: ${code}`);assert.equal(runs.rows[0].status,'complete');assert.ok(response.content.trim().length>0)
        passed=true
      }finally{report.push({provider:'DeepSeek real HTTP+queue',passed,...(passed?{}:{code})})}
    })
    await t.test('real speech-to-text with generated Mandarin PCM through multipart HTTP',async()=>{
      let passed=false,code=''
      try{
        assert.ok(process.env.DOUBAO_ASR_API_KEY||(process.env.DOUBAO_ASR_APP_ID&&process.env.DOUBAO_ASR_ACCESS_TOKEN),'Doubao ASR is not configured')
        const aiff=join(artifacts,'synthetic.aiff'),wav=join(artifacts,'synthetic.wav')
        execFileSync('say',['-v','Tingting','-o',aiff,'今天我想练习表达我的感受。'])
        execFileSync('afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',aiff,wav])
        const audio=await readFile(wav);assert.equal(audio.toString('ascii',0,4),'RIFF');assert.equal(audio.toString('ascii',8,12),'WAVE')
        let pcm:Buffer|undefined
        for(let at=12;at+8<=audio.length;){const size=audio.readUInt32LE(at+4),end=at+8+size;assert.ok(end<=audio.length);if(audio.toString('ascii',at,at+4)==='fmt '){assert.equal(audio.readUInt16LE(at+8),1);assert.equal(audio.readUInt16LE(at+10),1);assert.equal(audio.readUInt32LE(at+12),16000);assert.equal(audio.readUInt16LE(at+22),16)}if(audio.toString('ascii',at,at+4)==='data')pcm=audio.subarray(at+8,end);at=end+(size%2)}
        assert.ok(pcm&&pcm.length>=320&&pcm.length<=1_920_000)
        const form=new FormData();form.append('audio',new Blob([new Uint8Array(pcm)],{type:'application/octet-stream'}),'synthetic.pcm')
        const response=await fetch(base+'/asr',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form,signal:AbortSignal.timeout(100000)}),data=await response.json();code=`HTTP_${response.status}`
        assert.equal(response.status,200,`ASR result: ${code}; ${data.error||''}`);assert.ok(typeof data.text==='string'&&data.text.includes('感受'),'Synthetic Mandarin was not recognized')
        await writeFile(join(artifacts,'recognized.json'),JSON.stringify({synthetic:true,text:data.text},null,2));passed=true
      }finally{report.push({provider:'Doubao real multipart+WebSocket',passed,...(passed?{}:{code})})}
    })
  }finally{
    try{await service?.app.close()}finally{await fixture.cleanup();await writeFile(join(artifacts,'results.json'),JSON.stringify(report,null,2));console.log('Live E2E artifacts:',artifacts)}
  }
})

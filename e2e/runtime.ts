import {withObservationFixture} from '../server/test-agent'
const processReply=(...args:Parameters<typeof processProductionReply>)=>processProductionReply(args[0],args[1],args[2],args[3]?withObservationFixture(args[3]):undefined,args[4])
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomBytes,randomUUID} from 'node:crypto'
import {preview} from 'vite'
import {names,reply,retryReply,roomReply} from './conversation'
import type {AddressInfo} from 'node:net'
import {createTestDatabase} from '../server/test-database'
import {createApp} from '../server/app'
import {processReply as processProductionReply} from '../server/worker'
import type {ReplyJob} from '../server/worker'
import type {Model} from '../server/agent'

export async function startRuntime(artifacts:string,overrideModel?:Model,realAgent=false){
  // Test processes never inherit paid provider credentials.
  for(const key of Object.keys(process.env))if(key.startsWith('DEEPSEEK_')||key.startsWith('DOUBAO_'))delete process.env[key]
  process.env.PUBLIC_ORIGIN='http://127.0.0.1:5189'
  process.env.TRUSTED_ORIGINS='http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5189'
  process.env.DEEPSEEK_API_KEY='local-e2e-model-double'
  const fixture=await createTestDatabase()
  const url=new URL(fixture.runtimeUrl)
  await writeFile(join(artifacts,'database.json'),JSON.stringify({database:url.pathname.slice(1),role:url.username},null,2),{mode:0o600})
  let service:Awaited<ReturnType<typeof createApp>>|undefined,web:Awaited<ReturnType<typeof preview>>|undefined
  const errors:{route:string;code:string;message:string;stack?:string}[]=[]
  const control={model:'reply' as 'reply'|'error'|'silent',calls:0,asr:'error' as 'error'|'text',asrBytes:0}
  const model:Model=overrideModel??(async(prompt,json)=>{
    control.calls++
    if(control.model==='error')throw new Error('E2E_PROVIDER_UNAVAILABLE')
    const context=JSON.parse(prompt.split('授权上下文：')[1].split('\n')[0])
    if(json)return JSON.stringify({understanding_kind:context.domain==='private'&&context.messages.at(-1)?.text.includes('怕话没说完')?'inference':null,intent:'理解学习安排与休息时间的分歧',strategy:control.model==='silent'?'silent':'listen',evidence_ids:[],uncertainty:'隔离测试使用固定对话，不评估真实模型能力',needs_human:false})
    return context.domain==='room'?roomReply:context.messages.at(-1)?.text.includes('怕话没说完')?retryReply:reply
  })
  async function close(){
    try{await service?.app.close()}finally{
      try{if(web){const server=web.httpServer;if('closeAllConnections' in server&&typeof server.closeAllConnections==='function')server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}finally{await fixture.cleanup();await writeFile(join(artifacts,'database-cleanup.json'),JSON.stringify({databaseRemoved:true,roleRemoved:true},null,2))}
    }
  }
  try{
    service=await createApp({databaseUrl:fixture.runtimeUrl,secret:fixture.secret})
    service.app.addHook('onError',(request,_reply,error,done)=>{if((error.statusCode||500)>=500)errors.push({route:request.routeOptions.url||request.url.split('?')[0],code:error.code||error.name,message:error.message.split('\n')[0].replace(/:\/\/[^@\s]+@/g, '://[redacted]@'),stack:error.stack?.split('\n').slice(1,7).join('\n')});done()})
    service.app.addHook('preHandler',async(request,reply)=>{
      if(request.url==='/api/asr'){
        // Only the provider transport is substituted; auth, recorder, PCM and multipart are real.
        const file=await request.file(),pcm=await file?.toBuffer()
        if(!file||file.mimetype!=='application/octet-stream'||!pcm||pcm.length<320||pcm.length%2)throw Error('Invalid E2E PCM upload')
        control.asrBytes=pcm.length
        return control.asr==='error'?reply.code(503).send({error:'E2E：语音授权未通过，请用文字输入'}):reply.send({text:'等我把这周的复习计划说完，再一起商量休息时间。'})
      }
    })
    await service.queue!.work<ReplyJob>('agent.reply',{batchSize:1,pollingIntervalSeconds:.5},async jobs=>{for(const job of jobs)await (realAgent?processProductionReply:processReply)(service!.database,job.data,service!.notify,model,job.signal)})
    await service.app.listen({host:'127.0.0.1',port:0})
    const apiOrigin=`http://127.0.0.1:${(service.app.server.address() as AddressInfo).port}`
    web=await preview({logLevel:'silent',preview:{host:'127.0.0.1',port:0,strictPort:true,headers:{'Cache-Control':'no-store'},proxy:{'/api':apiOrigin}}})
    const webPort=(web.httpServer.address() as AddressInfo).port
    const accounts:Record<string,{id:string;email:string;password:string;cookie:string}>={}
    async function request(who:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){
      const response=await fetch(apiOrigin+'/api'+path,{method,headers:{Origin:'http://localhost:5173',...(accounts[who]?.cookie?{Cookie:accounts[who].cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
      const data=await response.json()
      if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`)
      return data
    }
    async function account(who:string){
      const email=`${who}-${randomBytes(6).toString('hex')}@example.test`,password=randomBytes(20).toString('hex')
      const response=await fetch(apiOrigin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({name:names[who]||who,email,password})})
      if(!response.ok)throw Error(`Fixture signup: ${response.status}`)
      const data=await response.json();return accounts[who]={id:data.user.id,email,password,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}
    }
    async function expert(){const user=await account('expert'),id=randomUUID();await fixture.fixtures.pool.query("INSERT INTO consultants(id,user_id,name,approach,qualifications,price,test_only,specialties,service_modes,verified_at) VALUES($1,$2,$3,'本地测试','仅用于 E2E 验收','不收费',false,ARRAY['亲子沟通'],ARRAY['测试流程'],now())",[id,user.id,names.expert]);return id}
    return{fixture,service,webPort,accounts,request,account,expert,control,errors,close}
  }catch(error){await close();throw error}
}

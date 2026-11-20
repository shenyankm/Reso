import type { FastifyInstance } from 'fastify'
import type { EventEmitter } from 'node:events'
import { asrAuthHeaders, transcribe } from '../asr'
import { HttpError, json } from '../http'
import type { RouteContext } from '../context'
import type { EventNotification } from '../notifications'

export function registerTransport(app: FastifyInstance, context: RouteContext, updates: EventEmitter) {
  const { hasEventAccess, hasSession } = context
  app.post('/api/asr',{config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(!asrAuthHeaders())throw new HttpError(503,'豆包语音尚未配置，请先使用文字输入')
    const file=await request.file();if(!file||file.mimetype!=='application/octet-stream')throw new HttpError(400,'需要16kHz单声道16位PCM音频')
    const buffer=await file.toBuffer();if(file.file.truncated)throw new HttpError(413,'录音不能超过60秒')
    const abort=new AbortController();const cancel=()=>{if(!reply.raw.writableEnded)abort.abort()};reply.raw.on('close',cancel)
    try{return{text:await transcribe(buffer,abort.signal)}}catch(error){
      if(error instanceof Error&&error.message==='ASR_AUTH_FAILED')throw new HttpError(503,'语音服务授权未通过，请联系服务管理员检查配置；录音已保留，可稍后重试或使用文字')
      throw new HttpError(502,'语音识别未完成，请保留录音重试或改用文字')
    }finally{reply.raw.off('close',cancel)}
  })
  const streams=new Map<import('node:http').ServerResponse,()=>void>()
  app.addHook('preClose',async()=>{for(const close of streams.values())close()})
  app.get('/api/stream',async(request,reply)=>{
    const userId=request.resoUser!.id
    const sessionId=request.resoSessionId!
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'})
    reply.raw.write('event: ready\ndata: {}\n\n')
    let pending:EventNotification|null=null,checking=false,heartbeatBusy=false,targetedRefresh=false
    const open=()=>!reply.raw.destroyed&&!reply.raw.writableEnded
    const handler=(event:EventNotification)=>{
      if(event.refreshUserId===userId)targetedRefresh=true
      pending=event
      void flush()
    }
    async function flush(){
      if(checking)return
      checking=true
      try{
        while((pending||targetedRefresh)&&open()){
          const event=pending;pending=null
          const refreshRecipient=targetedRefresh;targetedRefresh=false
          if(!await hasSession(sessionId,userId)){reply.raw.end();return}
          if(refreshRecipient){
            // A direct refresh carries no event metadata. The next API request checks permissions.
            if(open()&&!reply.raw.write('event: update\ndata: {}\n\n')){reply.raw.end();return}
          }else if(event&&await hasEventAccess(event.eventId,userId,event.domain)&&open()&&!reply.raw.write(`event: update\ndata: ${json({eventId:event.eventId})}\n\n`)){reply.raw.end();return}
        }
      }catch{reply.raw.end()}finally{checking=false}
    }
    updates.on('update',handler)
    const heartbeat=setInterval(async()=>{
      if(heartbeatBusy||!open())return
      heartbeatBusy=true
      try{
        if(!await hasSession(sessionId,userId)){reply.raw.end();return}
        if(open()&&!reply.raw.write(': heartbeat\n\n'))reply.raw.end()
      }catch{reply.raw.end()}finally{heartbeatBusy=false}
    },15000)
    const cleanup=()=>{if(!streams.delete(reply.raw))return;updates.off('update',handler);clearInterval(heartbeat);reply.raw.off('close',cleanup);reply.raw.off('finish',cleanup)}
    streams.set(reply.raw,()=>{cleanup();reply.raw.end()})
    reply.raw.once('close',cleanup);reply.raw.once('finish',cleanup)
    if(!open())cleanup()
  })
}

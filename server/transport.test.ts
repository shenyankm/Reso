import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {setImmediate} from 'node:timers/promises'
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify'
import {registerTransport} from './routes/transport'
import type {RouteContext} from './context'

test('SSE coalesces bursts, bounds permission queries and closes slow readers',async()=>{
  let route!:(request:FastifyRequest,reply:FastifyReply)=>Promise<void>
  const app={post(){},addHook(){},get(_path:string,handler:typeof route){route=handler}} as unknown as FastifyInstance
  let release!:()=>void,checks=0,active=0,maxActive=0
  const barrier=new Promise<void>(done=>{release=done})
  const context={hasSession:async()=>{checks++;active++;maxActive=Math.max(active,maxActive);await barrier;active--;return true},hasEventAccess:async()=>true} as unknown as RouteContext
  const updates=new EventEmitter(),writes:string[]=[]
  let writable=true
  const raw=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,writeHead(){},write(text:string){writes.push(text);return writable},end():void{raw.writableEnded=true;raw.emit('close')}})
  registerTransport(app,context,updates)
  await route({resoUser:{id:'user'},resoSessionId:'session'} as FastifyRequest,{raw,hijack(){}} as unknown as FastifyReply)
  try{
    for(let i=0;i<200;i++)updates.emit('update',{eventId:'event',domain:'private'})
    release();await setImmediate()
    assert.equal(maxActive,1);assert.ok(checks<=2);assert.equal(writes.filter(text=>text.includes('event: update')).length,2)
    writable=false;updates.emit('update',{eventId:'event',domain:'private'});await setImmediate()
    assert.equal(raw.writableEnded,true);assert.equal(updates.listenerCount('update'),0)
  }finally{raw.end()}
})

test('SSE shutdown clears heartbeat and subscription even before a socket close event',async t=>{
  let route!:(request:FastifyRequest,reply:FastifyReply)=>Promise<void>,close!:()=>Promise<void>
  const app={post(){},addHook(_name:string,hook:typeof close){close=hook},get(_path:string,handler:typeof route){route=handler}} as unknown as FastifyInstance
  const updates=new EventEmitter(),context={hasSession:async()=>true,hasEventAccess:async()=>true} as unknown as RouteContext
  const raw=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,writeHead(){},write(){return true},end(){raw.writableEnded=true}})
  const clear=t.mock.method(globalThis,'clearInterval')
  registerTransport(app,context,updates)
  await route({resoUser:{id:'user'},resoSessionId:'session'} as FastifyRequest,{raw,hijack(){}} as unknown as FastifyReply)
  try{
    assert.equal(updates.listenerCount('update'),1)
    await close()
    assert.equal(raw.writableEnded,true);assert.equal(updates.listenerCount('update'),0);assert.equal(clear.mock.callCount(),1)
    raw.emit('close');assert.equal(clear.mock.callCount(),1)
    await route({resoUser:{id:'user'},resoSessionId:'session'} as FastifyRequest,{raw,hijack(){}} as unknown as FastifyReply)
    assert.equal(updates.listenerCount('update'),0);assert.equal(clear.mock.callCount(),2)
    await close();assert.equal(clear.mock.callCount(),2)
    raw.writableEnded=false
    await route({resoUser:{id:'user'},resoSessionId:'session'} as FastifyRequest,{raw,hijack(){}} as unknown as FastifyReply)
    raw.emit('finish');raw.emit('close');assert.equal(updates.listenerCount('update'),0);assert.equal(clear.mock.callCount(),3)
  }finally{raw.emit('close')}
})

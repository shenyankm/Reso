import test from 'node:test'
import assert from 'node:assert/strict'
import {api,ApiError} from './api'
import {methodOfferFeature,supportsMethodOffers} from '../shared/capabilities'

test('invalid successful responses and unavailable networks reject instead of entering application state',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>proxy error</html>',{status:200}))
  await assert.rejects(api('/events'),error=>error instanceof ApiError&&error.status===502)
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch')})
  await assert.rejects(api('/events'),error=>error instanceof ApiError&&error.status===0)
})

test('request cancellation is forwarded and a hung request has a deadline',async t=>{
  t.mock.method(AbortSignal,'timeout',()=>AbortSignal.abort(new DOMException('timed out','TimeoutError')))
  t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{
    assert.ok(options?.signal)
    options!.signal!.throwIfAborted()
    return new Response('[]')
  })
  await assert.rejects(api('/events'),error=>error instanceof ApiError&&error.message.includes('结果尚未确认'))
  await assert.rejects(api('/events',undefined,'GET',AbortSignal.abort()),error=>error instanceof Error&&error.name==='AbortError')
})

test('authentication failures retain their request scope and show useful Chinese messages',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid email or password'},{status:401}))
  await assert.rejects(api('/auth/sign-in/email',{email:'demo@reso.test',password:'wrong'}),error=>error instanceof ApiError&&error.status===401&&error.path==='/auth/sign-in/email'&&error.message==='邮箱或密码不正确，请修改后重试')
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'会话已失效'},{status:401}))
  await assert.rejects(api('/events'),error=>error instanceof ApiError&&error.path==='/events'&&error.message==='会话已失效')
})

test('new clients explicitly negotiate method cards without accepting similar or malformed capabilities',async t=>{
  t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{
    assert.equal(new Headers(options?.headers).get('X-Reso-Features'),methodOfferFeature)
    return Response.json([])
  })
  await api('/events');await api('/events',{title:'合成事件'})
  assert.equal(supportsMethodOffers(`another, ${methodOfferFeature}`),true)
  for(const value of [undefined,[],methodOfferFeature+'-new',''])assert.equal(supportsMethodOffers(value),false)
})

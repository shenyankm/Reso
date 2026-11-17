import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

export function asrAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> | null {
  const apiKey = env.DOUBAO_ASR_API_KEY?.trim()
  if (apiKey) return { 'X-Api-Key': apiKey }
  const appId = env.DOUBAO_ASR_APP_ID?.trim(), accessToken = env.DOUBAO_ASR_ACCESS_TOKEN?.trim()
  return appId && accessToken ? { 'X-Api-App-Key': appId, 'X-Api-Access-Key': accessToken } : null
}

export function encodeFrame(type: number, flags: number, json: boolean, data: Buffer) {
  const payload = gzipSync(data)
  const header = Buffer.from([0x11, (type << 4) | flags, (json ? 0x10 : 0) | 1, 0])
  const size = Buffer.alloc(4); size.writeUInt32BE(payload.length)
  return Buffer.concat([header, size, payload])
}

export function decodeFrame(data: Buffer): { final: boolean; text: string } {
  if (data.length < 8 || data[0] >> 4 !== 1) throw new Error('ASR_INVALID_FRAME')
  const type = data[1] >> 4, flags = data[1] & 15
  let offset = (data[0] & 15) * 4
  if (offset < 4 || offset + 4 > data.length) throw new Error('ASR_INVALID_FRAME')
  if (type === 15) throw new Error(`ASR_PROVIDER_${data.readUInt32BE(offset)}`)
  if (type !== 9) throw new Error('ASR_INVALID_FRAME')
  if (flags & 1) offset += 4
  if (offset + 4 > data.length) throw new Error('ASR_INVALID_FRAME')
  const length = data.readUInt32BE(offset); offset += 4
  if (length > 2_000_000 || offset + length > data.length) throw new Error('ASR_INVALID_FRAME')
  let payload = data.subarray(offset, offset + length)
  if ((data[2] & 15) === 1) payload = gunzipSync(payload, { maxOutputLength: 2_000_000 })
  const result = JSON.parse(payload.toString('utf8')) as { result?: { text?: unknown } | { text?: unknown }[] }
  const text = Array.isArray(result.result) ? result.result.map(r => typeof r.text === 'string' ? r.text : '').join('') : typeof result.result?.text === 'string' ? result.result.text : ''
  return { final: (flags & 2) !== 0, text }
}

export function transcribe(pcm: Buffer, signal?: AbortSignal): Promise<string> {
  const auth = asrAuthHeaders()
  if (!auth) throw new Error('ASR_NOT_CONFIGURED')
  if (pcm.length < 320 || pcm.length % 2 || pcm.length > 1_920_000) throw new Error('ASR_INVALID_AUDIO')
  if(signal?.aborted)return Promise.reject(new Error('ASR_CANCELLED'))
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream', {
      headers: { ...auth, 'X-Api-Resource-Id': process.env.DOUBAO_ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration', 'X-Api-Request-Id': requestId, 'X-Api-Connect-Id': requestId, 'X-Api-Sequence': '-1' },
      handshakeTimeout: 12_000, maxPayload: 2_000_000,
    })
    let finished = false
    const finish = (error?: Error, text = '') => {
      if (finished) return
      finished = true; clearTimeout(timeout); signal?.removeEventListener('abort', aborted)
      socket.close(); error ? reject(error) : resolve(text)
    }
    const aborted = () => finish(new Error('ASR_CANCELLED'))
    const timeout = setTimeout(() => finish(new Error('ASR_TIMEOUT')), 90_000)
    socket.on('open', async () => {
      try {
        socket.send(encodeFrame(1, 0, true, Buffer.from(JSON.stringify({ user: { uid: randomUUID() }, audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 }, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, enable_ddc: false } }))))
        for (let offset = 0; offset < pcm.length && !finished; offset += 6400) {
          socket.send(encodeFrame(2, offset + 6400 >= pcm.length ? 2 : 0, false, pcm.subarray(offset, offset + 6400)))
          if (offset + 6400 < pcm.length) await delay(200)
        }
      } catch { finish(new Error('ASR_SEND_FAILED')) }
    })
    socket.on('message', raw => {
      try { const result = decodeFrame(Buffer.from(raw as Buffer)); if (result.final) finish(result.text.trim() ? undefined : new Error('ASR_EMPTY'), result.text.trim()) }
      catch (error) { finish(error instanceof Error ? error : new Error('ASR_FAILED')) }
    })
    socket.on('unexpected-response', (_request, response) => {
      const status=response.statusCode,logId=String(response.headers['x-tt-logid']||'').match(/^[A-Za-z0-9_-]{1,128}$/)?.[0]
      console.error('ASR handshake rejected',{status,requestId,...(logId?{logId}:{})})
      response.destroy()
      finish(new Error(status===401||status===403?'ASR_AUTH_FAILED':'ASR_CONNECTION_FAILED'))
    })
    socket.on('error', () => finish(new Error('ASR_CONNECTION_FAILED')))
    socket.on('close', () => { if (!finished) finish(new Error('ASR_CONNECTION_CLOSED')) })
    signal?.addEventListener('abort', aborted, { once: true })
    if(signal?.aborted)aborted()
  })
}

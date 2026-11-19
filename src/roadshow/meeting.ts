type Bridge = { postMessage: (message: string) => void; onmessage: ((event: { data: string }) => void) | null }
declare global { interface Window { ResoMeeting?: Bridge } }

export type Snapshot = {
  cursor: number
  motherTurn: boolean
  connected: boolean
  received: boolean
  ended: boolean
  accepted?: boolean
}

type Request =
  | { action: 'open'; cursor: number }
  | { action: 'publish'; cursor: number; motherTurn: boolean; ended: boolean }
  | { action: 'connect' | 'poll'; code: string }
  | { action: 'send'; code: string; cursor: number }
  | { action: 'close' }

let sequence = 0
const listeners = new Map<number, (reply: { error?: string }) => void>()

export function meeting<T>(request: Request): Promise<T> {
  const bridge = window.ResoMeeting
  if (!bridge) return Promise.reject(new Error('当前设备无法连接另一部手机'))
  bridge.onmessage = event => {
    try {
      const reply = JSON.parse(event.data)
      listeners.get(reply.id)?.(reply)
    } catch { /* The request timeout handles an unreadable response. */ }
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = window.setTimeout(() => {
      listeners.delete(id)
      reject(new Error('连接超时，请检查两台设备是否在同一 Wi-Fi'))
    }, request.action === 'open' || request.action === 'connect' ? 45_000 : 3_500)
    listeners.set(id, reply => {
      window.clearTimeout(timer)
      listeners.delete(id)
      if (reply.error) reject(new Error(reply.error))
      else resolve(reply as T)
    })
    try { bridge.postMessage(JSON.stringify({ ...request, id })) } catch {
      window.clearTimeout(timer)
      listeners.delete(id)
      reject(new Error('无法连接另一部手机'))
    }
  })
}

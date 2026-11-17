import { betterAuth } from 'better-auth'
import type { Pool } from 'pg'

export function createAuth(pool: Pool, secret: string) {
  const origins = new Set((process.env.TRUSTED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(origin=>origin.trim()).filter(Boolean))
  return betterAuth({ database: pool, secret, baseURL: process.env.PUBLIC_ORIGIN || 'http://localhost:5173', trustedOrigins: [...origins], emailAndPassword: { enabled: true, minPasswordLength: 10 }, advanced: { useSecureCookies: new URL(process.env.PUBLIC_ORIGIN||'http://localhost:5173').protocol==='https:', ipAddress: { ipAddressHeaders: ['x-reso-client-ip'] } }, rateLimit: { enabled: true, window: 60, max: 30 } })
}

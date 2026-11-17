import { existsSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'

if (!existsSync('.env')) {
  const password = randomBytes(24).toString('hex')
  const runtimePassword = randomBytes(24).toString('hex')
  const addresses = Object.values(networkInterfaces()).flat().filter(a => a?.family === 'IPv4' && !a.internal && !a.address.startsWith('198.18.')).map(a => `http://${a.address}:5173`)
  writeFileSync('.env', `POSTGRES_PASSWORD=${password}\nMIGRATION_DATABASE_URL=postgresql://reso:${password}@127.0.0.1:55436/reso\nDATABASE_URL=postgresql://reso_runtime:${runtimePassword}@127.0.0.1:55436/reso\nBETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}\nPUBLIC_ORIGIN=http://localhost:5173\nTRUSTED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,${addresses.join(',')}\nDEEPSEEK_API_KEY=\nDEEPSEEK_MODEL=deepseek-flash\nDOUBAO_ASR_API_KEY=\nDOUBAO_ASR_APP_ID=\nDOUBAO_ASR_ACCESS_TOKEN=\nDOUBAO_ASR_RESOURCE_ID=volc.seedasr.sauc.duration\n`, { mode: 0o600 })
  console.log('Created private .env with local database and session credentials. Add provider keys when available.')
} else console.log('Existing .env preserved.')

import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {parseEnv} from 'node:util'
import {isolatedTests,withIsolatedPostgres} from './verify-m1'

const app=process.argv.includes('--app'),live=process.argv.includes('--live')
assert(!live||app,'--live requires explicit App verification')
withIsolatedPostgres(async({env,url})=>{
  const scoped={...env,DATABASE_URL:url,MIGRATION_DATABASE_URL:url,PUBLIC_ORIGIN:'http://localhost:5173'}
  await isolatedTests(['server/agent.integration.test.ts','server/permissions.integration.test.ts'],scoped)
  if(!app)return
  const provider=live?parseEnv(await readFile('.env','utf8')):{}
  if(live)assert(provider.DEEPSEEK_API_KEY,'Live model credentials are not configured')
  await isolatedTests(['e2e/chat-experience.test.ts'],{...scoped,RESO_CHAT_APP:'1',...(live?{RESO_CHAT_LIVE:'1',DEEPSEEK_API_KEY:provider.DEEPSEEK_API_KEY,DEEPSEEK_MODEL:provider.DEEPSEEK_MODEL}:{})})
}).catch(error=>{console.error(error instanceof Error?error.message:'Chat verification failed');process.exitCode=1})

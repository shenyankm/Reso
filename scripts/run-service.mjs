import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'

const entry={api:'server/main.ts',worker:'server/worker-main.ts'}[process.argv[2]]
if(!entry)throw new Error('Usage: node scripts/run-service.mjs api|worker')
const config=await readFile('.env','utf8').then(parseEnv).catch(error=>{if(error.code==='ENOENT')return{};throw error})
const environment={...config,...process.env}
delete environment.MIGRATION_DATABASE_URL
delete environment.POSTGRES_PASSWORD
const child=spawn(process.execPath,['--import','tsx',entry],{env:environment,stdio:'inherit'})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
child.on('error',()=>{console.error('Service failed to start.');process.exitCode=1})
child.on('exit',(code)=>{process.exitCode=code??1})

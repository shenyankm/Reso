import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const label = 'app.reso.m1-verification'
const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export async function isolatedM1Target() {
  const run = process.env.RESO_M1_VERIFY_RUN, id = process.env.RESO_M1_VERIFY_CONTAINER
  const value = process.env.RESO_M1_VERIFY_URL
  assert(run && /^[a-f0-9]{16}$/.test(run) && id && /^[a-f0-9]{64}$/.test(id) && value, 'Run npm run test:m1:isolated; arbitrary database URLs are not accepted')
  const container = JSON.parse(docker(['inspect', id]))[0]
  const url = new URL(value), binding = container.NetworkSettings.Ports['5432/tcp']?.[0]
  assert.equal(container.Config.Labels[label], run)
  assert.equal(container.Name, `/reso-m1-verify-${run}`)
  assert.equal(container.State.Running, true)
  assert(container.HostConfig.Tmpfs?.['/var/lib/postgresql/data'] && container.Mounts.every((m: {Type:string}) => m.Type === 'tmpfs') && !container.HostConfig.Binds?.length && !container.HostConfig.VolumesFrom?.length, 'Persistent or shared volumes are forbidden')
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.username, 'm1_verify'); assert.equal(url.pathname, '/postgres')
  assert.equal(binding?.HostIp, '127.0.0.1'); assert.equal(binding?.HostPort, url.port)
  assert.notEqual(url.port, '55436', 'Do not occupy the existing business endpoint')
  const pool = new Pool({ connectionString: value })
  try { assert.equal((await pool.query('SELECT id FROM reso_verification.run')).rows[0]?.id, run) }
  finally { await pool.end() }
  return { run, containerId: id, url, evidenceDirectory: resolve('.data/m1-verification', run) }
}

export async function isolatedTests(files: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((done, reject) => {
    const process = spawn(globalThis.process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], { env, stdio: 'inherit' })
    process.once('error', reject)
    process.once('exit', code => code === 0 ? done() : reject(new Error(`Isolated database checks failed (${code})`)))
  })
}

export async function withIsolatedPostgres(check:(context:{run:string;directory:string;env:NodeJS.ProcessEnv;url:string})=>Promise<void>) {
  const run = randomBytes(8).toString('hex'), name = `reso-m1-verify-${run}`
  const directory = resolve('.data/m1-verification', run), envFile = resolve(directory, 'postgres.env')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const password = randomBytes(32).toString('hex')
  await writeFile(envFile, `POSTGRES_USER=m1_verify\nPOSTGRES_DB=postgres\nPOSTGRES_PASSWORD=${password}\n`, { mode: 0o600 })
  let id: string | undefined
  try {
    try { docker(['image', 'inspect', 'postgres:17-alpine']) }
    catch { execFileSync('docker', ['pull', 'postgres:17-alpine'], { stdio: 'inherit' }) }
    const image = docker(['image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}'])
    id = docker(['run', '--detach', '--name', name, '--label', `${label}=${run}`, '--env-file', envFile,
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m', image])
    const port = docker(['inspect', id, '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}'])
    assert.notEqual(port, '55436', 'Isolated verification refuses the business port')
    let ready = false
    for (let i = 0; i < 150; i++) {
      try { docker(['exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'm1_verify', '-d', 'postgres']); ready = true; break }
      catch { await new Promise(resolve => setTimeout(resolve, 200)) }
    }
    assert(ready, 'Temporary PostgreSQL did not become ready')
    const url = `postgresql://m1_verify:${password}@127.0.0.1:${port}/postgres`
    const admin = new Pool({ connectionString: url })
    try {
      await admin.query('CREATE SCHEMA reso_verification; CREATE TABLE reso_verification.run(id text PRIMARY KEY)')
      await admin.query('INSERT INTO reso_verification.run VALUES($1)', [run])
    } finally { await admin.end() }
    // Do not load .env or forward model, ASR, deployment or business database credentials.
    const env: NodeJS.ProcessEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
    Object.assign(env, { RESO_M1_VERIFY_RUN: run, RESO_M1_VERIFY_CONTAINER: id, RESO_M1_VERIFY_URL: url })
    console.log(`Verifying in disposable PostgreSQL container ${name}; no persistent volumes or business connections`)
    await check({run,directory,env,url})
  } finally {
    if (id) {
      const container = JSON.parse(docker(['inspect', id]))[0]
      assert.equal(container.Config.Labels[label], run)
      docker(['rm', '--force', id])
    }
    await unlink(envFile)
  }
}

async function main() {
  const started=Date.now()
  await withIsolatedPostgres(async({run,directory,env,url})=>{
    await isolatedTests(['server/m1.integration.test.ts'], env)
    execFileSync('uv', ['run', 'scripts/check-database-design.py', '--m1-imports', resolve(directory, 'imported-record-json.json')], { stdio: 'inherit' })
    const legacy = (await readdir('server')).filter(n => n.endsWith('.integration.test.ts') && n !== 'm1.integration.test.ts').map(n => 'server/' + n)
    await isolatedTests(legacy, { ...env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url, PUBLIC_ORIGIN: 'http://localhost:5173' })
    const result = JSON.parse(await readFile(resolve(directory, 'results.json'), 'utf8'))
    await writeFile(resolve(directory, 'results.json'), JSON.stringify({ ...result, run_id: run, imported_json_contracts: 'passed', legacy_integration_suite: 'passed', duration_ms: Date.now() - started, persistent_volumes: false, business_connections: 0 }, null, 2) + '\n', { mode: 0o600 })
    console.log(`M1 verification passed; redacted evidence: .data/m1-verification/${run}/results.json`)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'M1 verification failed'); process.exitCode = 1 })
}

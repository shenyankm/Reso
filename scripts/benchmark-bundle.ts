import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {build} from 'vite'

const result=await build({build:{write:false},logLevel:'silent'})
assert.ok('output' in result,'expected a single client build')
const chunks=result.output.filter(item=>item.type==='chunk')
const entry=chunks.find(chunk=>chunk.isEntry)
assert.ok(entry)
const initial=new Set<string>()
function include(name:string){
  if(initial.has(name))return
  const chunk=chunks.find(item=>item.fileName===name)
  assert.ok(chunk,`missing static dependency: ${name}`)
  initial.add(name);chunk.imports.forEach(include)
}
include(entry.fileName)
assert.ok(chunks.some(chunk=>Object.keys(chunk.modules).some(name=>name.endsWith('/src/App.tsx'))),'preview must remain available')
assert.ok(chunks.filter(chunk=>initial.has(chunk.fileName)).every(chunk=>Object.keys(chunk.modules).every(name=>!name.endsWith('/src/App.tsx'))),'preview must stay outside the normal entry dependency graph')
const assets=chunks.map(chunk=>({name:chunk.fileName,initial:initial.has(chunk.fileName),bytes:Buffer.byteLength(chunk.code),gzipBytes:gzipSync(chunk.code,{level:9}).byteLength}))
const report={assets,initialBytes:assets.filter(item=>item.initial).reduce((n,item)=>n+item.bytes,0),initialGzipBytes:assets.filter(item=>item.initial).reduce((n,item)=>n+item.gzipBytes,0),totalBytes:assets.reduce((n,item)=>n+item.bytes,0),totalGzipBytes:assets.reduce((n,item)=>n+item.gzipBytes,0)}
await mkdir('.data/performance',{recursive:true,mode:0o700})
await writeFile('.data/performance/bundle-after.json',JSON.stringify(report,null,2),{mode:0o600})
console.log(JSON.stringify(report,null,2))

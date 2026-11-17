import test from 'node:test'
import assert from 'node:assert/strict'
import {exportRecord} from './export'

test('Android export waits for actual save, handles cancel and failure, and releases its callback',async t=>{
  const bridge:{postMessage:(text:string)=>void;onmessage:((event:{data:string})=>void)|null}={postMessage:()=>{},onmessage:null}
  Object.defineProperty(globalThis,'window',{configurable:true,value:{ResoExport:bridge}})
  t.after(()=>{Reflect.deleteProperty(globalThis,'window')})
  let sent='';bridge.postMessage=text=>{sent=text}
  const pending=exportRecord({event:{id:'fixture'},private_messages:['saved content']})
  let done=false;void pending.then(()=>{done=true});await Promise.resolve();assert.equal(done,false);assert.deepEqual(JSON.parse(sent).private_messages,['saved content'])
  bridge.onmessage!({data:'{"status":"saved"}'});assert.equal(await pending,'saved');assert.equal(bridge.onmessage,null)
  const cancelled=exportRecord({});bridge.onmessage!({data:'{"status":"cancelled"}'});assert.equal(await cancelled,'cancelled')
  const failed=exportRecord({});bridge.onmessage!({data:'{"status":"error"}'});await assert.rejects(failed,/导出未完成/);assert.equal(bridge.onmessage,null)
  const large=exportRecord({});bridge.onmessage!({data:'{"status":"too_large"}'});await assert.rejects(large,/电脑端/)
  bridge.postMessage=()=>{throw Error('unavailable')};await assert.rejects(exportRecord({}),/无法打开/);assert.equal(bridge.onmessage,null)
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__TAURI_INTERNALS__:{}}});await assert.rejects(exportRecord({}),/更新 App/)
})

test('Web export uses a JSON download and releases its object URL',async t=>{
  let clicked=false,revoked=false
  const link={href:'',download:'',click(){clicked=true}}
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>link}})
  t.after(()=>{Reflect.deleteProperty(globalThis,'window');Reflect.deleteProperty(globalThis,'document')})
  t.mock.method(URL,'createObjectURL',(blob:Blob)=>{assert.equal(blob.type,'application/json');return 'blob:fixture'})
  t.mock.method(URL,'revokeObjectURL',(url:string)=>{assert.equal(url,'blob:fixture');revoked=true})
  t.mock.method(globalThis,'setTimeout',((fn:()=>void)=>{fn();return 1}) as unknown as typeof setTimeout)
  assert.equal(await exportRecord({event:{id:'fixture'}}),'downloaded');assert.equal(clicked,true);assert.equal(link.download,'reso-event.json');assert.equal(revoked,true)
})

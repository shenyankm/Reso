import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {writeFile} from 'node:fs/promises'
import {Android} from './android'
import {startRuntime} from './runtime'

test('Android export validates native messages, supports cancellation and saves actual JSON',{timeout:90000},async()=>{
  const artifacts=join('.data','e2e-export',new Date().toISOString().replace(/[:.]/g,'-')),ui=new Android(artifacts)
  let runtime:Awaited<ReturnType<typeof startRuntime>>|undefined
  try{
    await ui.connect();runtime=await startRuntime(artifacts);const r=runtime
    await r.account('owner');const event=await r.request('owner','/events',{title:'和妈妈商量休息时间'})
    await r.request('owner',`/events/${event.id}`,{title:event.title,summary:'我希望先把复习计划说完，再和妈妈商量完成任务后的休息安排。',version:0},'PATCH')
    await ui.call('Page.navigate',{url:'about:blank'});ui.shell('reverse','tcp:5189','tcp:'+r.webPort);await ui.identity(r.accounts.owner.cookie,`/#event/${event.id}/private`)
    await ui.wait('!!window.ResoExport')
    const invalid=await ui.eval(`new Promise(resolve=>{ResoExport.onmessage=e=>resolve(JSON.parse(e.data).status);ResoExport.postMessage('{"event":{"id":"invalid"}}')})`);assert.equal(invalid,'error')
    const large=await ui.eval(`new Promise(resolve=>{ResoExport.onmessage=e=>resolve(JSON.parse(e.data).status);ResoExport.postMessage('中'.repeat(3*1024*1024))})`);assert.equal(large,'too_large')
    await ui.click('.event-context-toggle');await ui.button('这件事的记录');await ui.button('导出记录')
    const until=Date.now()+10000;while(!/documentsui/.test(ui.foreground())){assert.ok(Date.now()<until,'Expected the native save picker');await new Promise(r=>setTimeout(r,100))}
    await ui.cancelPicker();await ui.text('已取消导出');assert.equal(await ui.eval('!!document.querySelector(".mvp-error")'),false)
    await ui.button('导出记录');const saved=await ui.saveExport('reso-e2e-'+randomUUID()+'.json')
    assert.equal(saved.event.id,event.id);assert.equal(saved.event.summary,'我希望先把复习计划说完，再和妈妈商量完成任务后的休息安排。');assert.ok(Array.isArray(saved.private_messages));await ui.shot('export-confirmed')
  }catch(error){await ui.shot('failure').catch(()=>{});await writeFile(join(artifacts,'failure.txt'),String(error));await writeFile(join(artifacts,'network.json'),JSON.stringify({network:ui.network,errors:ui.errors},null,2));throw error}finally{try{await ui.restore()}finally{try{await ui.close()}finally{await runtime?.close()}}console.log('Export E2E artifacts:',artifacts)}
})

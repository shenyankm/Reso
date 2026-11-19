import {execFileSync} from 'node:child_process'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {writeFile,mkdir,unlink} from 'node:fs/promises'
import WebSocket from 'ws'
import assert from 'node:assert/strict'

const originalOrigin=process.env.E2E_APP_ORIGIN||'http://localhost:5173'
const origin='http://127.0.0.1:5189'
const stable=(value:Record<string,string>)=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))))
export class Android {
  adb=join(process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||join(homedir(),'Library/Android/sdk'),'platform-tools/adb')
  serial=process.env.ANDROID_SERIAL||'emulator-5554'
  socket!:WebSocket
  forward=''
  next=0
  pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  errors:string[]=[]
  failures:{path:string;status:number}[]=[]
  expectedFailures=new Map<string,number>()
  network:{path:string;status:number;mime:string}[]=[]
  remaining=180
  resetAt=0
  sessionReads=0
  backup:any
  blankURL=''
  surfaceFocused=false
  activation=0
  reverse=''
  fault:{path:string;method:string}|null=null
  constructor(public artifacts:string){}
  shell(...args:string[]){return execFileSync(this.adb,['-s',this.serial,...args],{encoding:'utf8',maxBuffer:20_000_000}).trim()}
  async connect({roadshow=false}:{roadshow?:boolean}={}){
    await mkdir(this.artifacts,{recursive:true,mode:0o700})
    assert.equal(this.shell('get-state'),'device')
    if(!roadshow){
      this.reverse=this.shell('reverse','--list').split('\n').find(line=>line.includes('tcp:5189 '))?.trim().split(/\s+/).at(-1)||''
      assert.equal(this.reverse,'','E2E port 5189 is already in use; refusing to replace another mapping')
    }
    const pid=this.shell('shell','pidof',roadshow?'app.reso.local.roadshow':'app.reso.local').split(' ')[0]
    assert.ok(pid,'Install and launch the debug APK before running E2E')
    this.forward=this.shell('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`)
    let page:any
    const deadline=Date.now()+15000
    while(!page&&Date.now()<deadline){
      try{
        const pages=await(await fetch(`http://127.0.0.1:${this.forward}/json/list`,{signal:AbortSignal.timeout(1000)})).json()
        page=pages.find((p:any)=>p.type==='page'&&(roadshow?new URL(p.url).hostname==='tauri.localhost':new URL(p.url).origin===originalOrigin))
      }catch{/* The native process can start before WebView's debug socket is ready. */}
      if(!page)await new Promise(resolve=>setTimeout(resolve,200))
    }
    assert.ok(page,'Expected the configured Reso WebView; refusing to replace an unrelated page')
    this.socket=new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((resolve,reject)=>{this.socket.once('open',resolve);this.socket.once('error',reject)})
    this.socket.on('message',raw=>{
      const data=JSON.parse(String(raw)),pending=this.pending.get(data.id)
      if(pending){clearTimeout(pending.timer);this.pending.delete(data.id);data.error||data.result?.exceptionDetails?pending.reject(new Error(data.error?.message||data.result.exceptionDetails.exception?.description?.split('\n')[0]||data.result.exceptionDetails.text)):pending.resolve(data.result)}
      if(data.method==='Network.responseReceived'){
        const path=new URL(data.params.response.url).pathname
        this.network.push({path,status:data.params.response.status,mime:data.params.response.mimeType})
        if(data.params.response.status>=500){const expected=this.expectedFailures.get(path)||0;if(expected)this.expectedFailures.set(path,expected-1);else if(path.startsWith('/api/'))this.failures.push({path,status:data.params.response.status})}
        if(path==='/api/auth/get-session')this.sessionReads++
        const headers=Object.fromEntries(Object.entries(data.params.response.headers).map(([k,v])=>[k.toLowerCase(),v]))
        if(headers['x-ratelimit-remaining']!==undefined&&Number(headers['x-ratelimit-limit'])>=180){this.remaining=Number(headers['x-ratelimit-remaining']);this.resetAt=Date.now()+Number(headers['x-ratelimit-reset']||60)*1000}
      }
      if(data.method==='Runtime.exceptionThrown')this.errors.push(data.params.exceptionDetails.text)
      if(data.method==='Fetch.requestPaused'){
        if(data.params.request.url===this.blankURL){void this.call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from('<html><head><link rel="icon" href="data:,"></head><body data-e2e-blank="1"></body></html>').toString('base64')}).catch(()=>{});return}

        const request=data.params.request,path=new URL(request.url).pathname
        const fail=this.fault&&path===this.fault.path&&request.method===this.fault.method
        if(fail){this.fault=null;this.expectedFailures.set(path,(this.expectedFailures.get(path)||0)+1)}
        void this.call(fail?'Fetch.fulfillRequest':'Fetch.continueRequest',fail?{requestId:data.params.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'E2E：保存暂时失败，请重试'})).toString('base64')}:{requestId:data.params.requestId}).catch(()=>{})
      }
    })
    this.socket.on('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('WebView disconnected'))}this.pending.clear()})
    await this.call('Runtime.enable');await this.call('Network.enable');await this.call('Network.setCacheDisabled',{cacheDisabled:true})
    if(roadshow)return
    const state=await this.eval('({local:{...localStorage},session:{...sessionStorage},href:location.href})')
    const cookies=(await this.call('Network.getCookies',{urls:[originalOrigin]})).cookies
    this.backup={...state,cookies}
    await writeFile(join(this.artifacts,'session-backup.json'),JSON.stringify(this.backup),{mode:0o600})
    await this.blank()
    this.backup.alias={...await this.eval('({local:{...localStorage},session:{...sessionStorage}})'),cookies:(await this.call('Network.getCookies',{urls:[origin]})).cookies}
    await writeFile(join(this.artifacts,'session-backup.json'),JSON.stringify(this.backup),{mode:0o600})
    await this.eval('localStorage.clear();sessionStorage.clear()')
  }
  async blank(){
    this.blankURL=origin+'/_e2e_blank'
    await this.call('Fetch.enable',{patterns:[{urlPattern:'*/api/*',requestStage:'Request'},{urlPattern:this.blankURL,resourceType:'Document',requestStage:'Request'}]})
    await this.call('Page.navigate',{url:this.blankURL})
    await this.wait(`location.origin===${JSON.stringify(origin)}&&document.body?.dataset.e2eBlank==='1'`)
    this.blankURL=''
  }
  call(method:string,params:Record<string,unknown>={}):Promise<any>{
    const id=++this.next
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`CDP timeout: ${method}`))},15000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}))})
  }
  async eval(expression:string){return(await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value}
  async wait(expression:string,timeout=15000){const end=Date.now()+timeout;do{if(await this.eval(expression))return;await new Promise(r=>setTimeout(r,100))}while(Date.now()<end);throw Error(`UI condition timed out: ${expression.slice(0,140)}`)}
  async go(path='/'){await this.idle();await this.budget();await this.call('Page.navigate',{url:'about:blank'});await this.wait("location.href==='about:blank'");await this.call('Page.navigate',{url:origin+path});await this.wait('!!document.querySelector(".app:not(.loading-screen)")')}
  async identity(cookie='',path='/'){
    await this.idle()
    await this.call('Page.navigate',{url:'about:blank'})
    for(const c of(await this.call('Network.getCookies',{urls:[origin]})).cookies)await this.call('Network.deleteCookies',{name:c.name,domain:c.domain,path:c.path})
    for(const pair of cookie.split('; ').filter(Boolean)){const at=pair.indexOf('=');await this.call('Network.setCookie',{url:origin,name:pair.slice(0,at),value:pair.slice(at+1),path:'/',httpOnly:true,sameSite:'Lax'})}
    await this.go(path)
  }
  async budget(){
    // Repeated reloads also consume Better Auth's separate session-read limit.
    if(this.sessionReads>=20){await new Promise(r=>setTimeout(r,60000));this.sessionReads=0}
    if(this.remaining<15){await new Promise(r=>setTimeout(r,Math.min(60000,Math.max(0,this.resetAt-Date.now())+500)));this.remaining=180}
  }
  async activate(expression:string){
    const sequence=++this.activation
    const info=await this.eval(`(()=>{const e=${expression};e.scrollIntoView({block:'center'});e.addEventListener('click',()=>{window.__e2eClicked=${sequence}},{once:true});e.focus();return {label:e.getAttribute('aria-label')||e.textContent||e.closest('label')?.textContent||'',space:e.matches('input[type=radio],input[type=checkbox]')}})()`)
    if(!this.surfaceFocused){
      const normal=(text:string)=>text.replace(/\s+/g,'')
      await this.nativeTap(n=>n.clickable==='true'&&(normal(n.text||'')===normal(info.label)||normal(n['content-desc']||'')===normal(info.label)))
      this.surfaceFocused=true
    }else this.shell('shell','input','keyevent',info.space?'62':'66')
    await this.wait(`window.__e2eClicked===${sequence}`)
    // Saving through the OS picker stays busy until the subsequent native test action.
    if(info.label.trim()!=='导出记录'&&!info.label.startsWith('导出事件：'))await this.idle()
  }
  async click(selector:string){
    await this.budget()
    await this.wait(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`)
    await this.activate(`document.querySelector(${JSON.stringify(selector)})`)
  }
  async button(text:string,scope=''){
    await this.budget()
    const expression=`[...document.querySelectorAll(${JSON.stringify(scope?scope+' button':'button')})].filter(e=>e.getClientRects().length&&((e.textContent.trim()===${JSON.stringify(text)})||e.getAttribute('aria-label')===${JSON.stringify(text)}))`
    await this.wait(`(${expression}).length===1&&!(${expression})[0].disabled`)
    await this.activate(`(${expression})[0]`)
  }
  async fill(selector:string,value:string){
    await this.wait(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`)
    await this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.focus();e.select()})()`)
    if(value)await this.call('Input.insertText',{text:value})
    else{await this.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await this.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8})}
    await this.wait(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`).catch(()=>{throw Error(`Input did not update: ${selector}`)})
  }
  async value(selector:string,value:string){await this.wait(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);await this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
  async check(label:string,checked=true){
    const e=`[...document.querySelectorAll('label')].find(e=>e.textContent.includes(${JSON.stringify(label)}))?.querySelector('input[type=checkbox]')`
    await this.wait(`!!(${e})&&!(${e}).disabled`)
    if(await this.eval(`(${e}).checked===${checked}`))return
    await this.eval(`(${e}).focus()`);this.shell('shell','input','keyevent','62')
    await this.wait(`(${e}).checked===${checked}`)
  }
  async text(text:string){await this.wait(`document.body.innerText.includes(${JSON.stringify(text)})`)}
  async idle(){await this.wait('!document.querySelector("[aria-busy=true]")&&![...document.querySelectorAll(".app-header button")].some(b=>b.disabled)')}
  async tool(group:string,label:string){await this.button('打开聊天工具');await this.wait('!!document.querySelector("dialog")');const expanded=await this.eval(`[...document.querySelectorAll('.tool-group-toggle')].find(e=>e.textContent.trim()===${JSON.stringify(group)})?.getAttribute('aria-expanded')==='true'`);if(!expanded&&await this.eval("!!document.querySelector('.tool-group-toggle')"))await this.button(group,'dialog');await this.button(label,'dialog');await this.wait('!document.querySelector("dialog")');await this.idle()}
  async cookie(){return(await this.call('Network.getCookies',{urls:[origin]})).cookies.map((c:any)=>c.name+'='+c.value).join('; ')}
  async shot(name:string){
    // The native WebView compositor can paint after the DOM assertions resolve.
    await new Promise(resolve=>setTimeout(resolve,250))
    await writeFile(join(this.artifacts,name+'.png'),execFileSync(this.adb,['-s',this.serial,'exec-out','screencap','-p'],{maxBuffer:20_000_000}))
  }
  async failNext(path:string,method:string){this.fault={path,method};await this.call('Fetch.enable',{patterns:[{urlPattern:'*/api/*',requestStage:'Request'}]})}
  async nativeTree(){
    for(let i=0;;i++){try{this.shell('shell','uiautomator','dump','/sdcard/reso-e2e-ui.xml');break}catch(error){if(i===2)throw error;await new Promise(r=>setTimeout(r,150))}}
    const xml=this.shell('shell','cat','/sdcard/reso-e2e-ui.xml')
    return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2].replaceAll('&amp;','&').replaceAll('&quot;','"')])))
  }
  async nativeTap(find:(node:Record<string,string>)=>boolean){
    let matches=(await this.nativeTree()).filter(find)
    const deadline=Date.now()+5000
    while(!matches.length&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,200));matches=(await this.nativeTree()).filter(find)}
    if(!matches.length)await writeFile(join(this.artifacts,`native-missing-${this.activation}.json`),JSON.stringify({nodes:await this.nativeTree(),focused:await this.eval('({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute("aria-label")})')}),{mode:0o600})
    assert.equal(matches.length,1,'Expected one native control')
    const bounds=matches[0].bounds.match(/\d+/g)!.map(Number)
    assert.ok(bounds[2]>bounds[0]&&bounds[3]>bounds[1])
    this.shell('shell','input','tap',String(Math.floor((bounds[0]+bounds[2])/2)),String(Math.floor((bounds[1]+bounds[3])/2)))
  }
  foreground(){return this.shell('shell','dumpsys','window').split('\n').find(line=>line.includes('mCurrentFocus'))||''}
  async saveExport(filename:string){
    assert.match(filename,/^reso-e2e-[a-z0-9-]+\.json$/)
    const deadline=Date.now()+10000
    while(!/documentsui/.test(this.foreground())){assert.ok(Date.now()<deadline,'Android save surface did not open');await new Promise(r=>setTimeout(r,100))}
    await this.shot('save-picker')
    let nodes=await this.nativeTree()
    const roots=nodes.find(n=>/Show roots|显示根目录/.test(n['content-desc']))
    if(roots){await this.nativeTap(n=>n['content-desc']===roots['content-desc']);await this.nativeTap(n=>/^(Downloads|下载)$/.test(n.text)&&n['resource-id']==='android:id/title')}
    await this.nativeTap(n=>n.class==='android.widget.EditText')
    this.shell('shell','input','keycombination','113','29');this.shell('shell','input','text',filename);this.shell('shell','input','keyevent','4')
    await this.nativeTap(n=>/^(SAVE|Save|保存)$/.test(n.text)&&n.enabled==='true')
    await this.text('记录已导出')
    this.surfaceFocused=false
    try{return JSON.parse(this.shell('shell','cat','/sdcard/Download/'+filename))}finally{this.shell('shell','rm','-f','/sdcard/Download/'+filename)}
  }
  async cancelPicker(){const open=/documentsui/.test(this.foreground());for(let i=0;i<3&&/documentsui/.test(this.foreground());i++){this.shell('shell','input','keyevent','4');await new Promise(r=>setTimeout(r,200))}if(open)this.surfaceFocused=false}
  async restore(){
    if(!this.backup)return
    await this.cancelPicker()
    if(this.backup.alias){
      await this.blank()
      for(const c of(await this.call('Network.getCookies',{urls:[origin]})).cookies)await this.call('Network.deleteCookies',{name:c.name,domain:c.domain,path:c.path})
      for(const{name,value,domain,path,secure,httpOnly,sameSite,expires}of this.backup.alias.cookies)await this.call('Network.setCookie',{name,value,domain,path,secure,httpOnly,sameSite,...(expires>0?{expires}:{})})
      await this.eval(`localStorage.clear();sessionStorage.clear();Object.entries(${JSON.stringify(this.backup.alias.local)}).forEach(([k,v])=>localStorage.setItem(k,v));Object.entries(${JSON.stringify(this.backup.alias.session)}).forEach(([k,v])=>sessionStorage.setItem(k,v))`)
      const alias=await this.eval('({local:{...localStorage},session:{...sessionStorage}})');assert.ok(stable(alias.local)===stable(this.backup.alias.local)&&stable(alias.session)===stable(this.backup.alias.session),'E2E-origin storage restoration failed; recovery backup retained')
    }
    await this.call('Fetch.disable')
    await this.call('Page.navigate',{url:'about:blank'})
    if(this.reverse)this.shell('reverse','tcp:5189',this.reverse);else if(this.shell('reverse','--list').split('\n').some(line=>line.split(/\s+/).includes('tcp:5189')))this.shell('reverse','--remove','tcp:5189')
    const source=`if(location.origin===${JSON.stringify(originalOrigin)}){localStorage.clear();sessionStorage.clear();Object.entries(${JSON.stringify(this.backup.local)}).forEach(([k,v])=>localStorage.setItem(k,v));Object.entries(${JSON.stringify(this.backup.session)}).forEach(([k,v])=>sessionStorage.setItem(k,v))}`
    const {identifier}=await this.call('Page.addScriptToEvaluateOnNewDocument',{source})
    try{await this.call('Page.navigate',{url:this.backup.href});await this.wait('!!document.querySelector(".app:not(.loading-screen)")')}finally{await this.call('Page.removeScriptToEvaluateOnNewDocument',{identifier})}
    const current=await this.eval('({local:{...localStorage},session:{...sessionStorage}})'),cookies=(await this.call('Network.getCookies',{urls:[originalOrigin]})).cookies
    assert.ok(stable(current.local)===stable(this.backup.local)&&stable(current.session)===stable(this.backup.session),'Original storage restoration failed; recovery backup retained')
    assert.ok(this.backup.cookies.every((c:any)=>cookies.some((n:any)=>n.name===c.name&&n.value===c.value&&n.domain===c.domain&&n.path===c.path)))
    await writeFile(join(this.artifacts,'restoration.json'),JSON.stringify({cookies:true,localStorage:true,sessionStorage:true,aliasStorage:true,reverse:true},null,2))
    await unlink(join(this.artifacts,'session-backup.json'))
  }
  async close(){this.socket?.close();if(this.forward)this.shell('forward','--remove','tcp:'+this.forward)}
}

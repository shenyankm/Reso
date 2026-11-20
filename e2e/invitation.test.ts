import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { toDataURL } from 'qrcode'
import { Android } from './android'
import { startRuntime } from './runtime'

test('Android imports a same-origin invitation QR and moves the ended room to history', {timeout:120000}, async()=>{
  const artifacts='.data/invitation-parity'
  await mkdir(artifacts,{recursive:true,mode:0o700})
  const ui=new Android(artifacts)
  let runtime:Awaited<ReturnType<typeof startRuntime>>|undefined
  try{
    await ui.connect()
    const r=runtime=await startRuntime(artifacts)
    const owner=await r.account('owner'),guest=await r.account('guest')
    const {id}=await r.request('owner','/events',{title:'周末一起读书'})
    const room=`/#event/${id}/room`
    await ui.call('Page.navigate',{url:'about:blank'})
    ui.shell('reverse','tcp:5189','tcp:'+r.webPort)
    await ui.identity(owner.cookie,`/#event/${id}/private`)
    await ui.click('.event-context-toggle')
    await ui.button('邀请与分享管理')
    await ui.button('生成邀请链接')
    await ui.button('显示邀请二维码')
    await ui.wait('document.querySelector(".invitation-qr img")?.naturalWidth>0')
    const invitation=await ui.eval('document.querySelector(".invitation-qr img").src')
    await ui.shot('invitation-qr')

    await ui.identity(guest.cookie)
    await ui.button('打开邀请')
    async function importQr(image:string) {
      await ui.eval(`(async()=>{
        const input=document.querySelector('.invite-scanner input[type=file]')
        const blob=await fetch(${JSON.stringify(image)}).then(response=>response.blob())
        const transfer=new DataTransfer()
        transfer.items.add(new File([blob],'invitation.png',{type:'image/png'}))
        input.files=transfer.files
        input.dispatchEvent(new Event('change',{bubbles:true}))
      })()`)
    }
    await importQr(await toDataURL('https://example.invalid/#invite/'+ 'A'.repeat(43)))
    await ui.text('没有找到当前 Reso 服务的邀请二维码')
    await importQr(invitation)
    await ui.text('有人邀请你聊一件事')
    await ui.button('接受并加入')
    await ui.wait(`location.hash===${JSON.stringify(room.slice(1))}`)

    await ui.identity(owner.cookie,room)
    await ui.click('.event-context-toggle')
    await ui.button('结束本次会谈')
    await ui.button('确认结束会谈')
    await ui.text('历史记录仍可查看')
    assert.equal(await ui.eval('!!document.querySelector(".composer")'),false)
    await ui.click('.event-context-toggle')
    await ui.button('查看会谈时间线')
    await ui.text('会谈时间线')
    await ui.text('有成员加入会谈')
    await ui.text('会谈已结束')
    await ui.shot('room-timeline')
    await ui.identity(guest.cookie)
    await ui.text('之前一起聊过')
    assert.equal(await ui.eval('!!document.querySelector("#relationship-rooms-title")'),false)
    await ui.button('打开房间聊天：周末一起读书')
    await ui.text('历史记录仍可查看')
    assert.equal(await ui.eval('!!document.querySelector(".composer")'),false)
    assert.deepEqual(r.errors,[])
    assert.deepEqual(ui.errors,[])
  }catch(error){await ui.shot('failure').catch(()=>{});throw error}
  finally{try{await ui.restore()}finally{try{await ui.close()}finally{await runtime?.close()}}}
})

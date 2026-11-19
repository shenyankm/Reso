import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Android } from './android'
import script from '../src/roadshow/script.json'
import { stages, turns } from '../src/roadshow/flow'

test('the bundled Android demo runs STEP 01–32 with the scripted dialogue and cards', { timeout: 240_000 }, async () => {
  const ui = new Android('.data/android/roadshow-e2e')
  const mother = process.env.RESO_MOTHER_SERIAL ? new Android('.data/android/roadshow-e2e/mother') : null
  if (mother) mother.serial = process.env.RESO_MOTHER_SERIAL!
  let roomForward = ''
  const stepSelector = 'document.querySelector(".roadshow")?.dataset.roadshowStep'
  const example = '我最近很焦虑，越觉得自己浪费了时间，学不进去。'
  const seen = new Set<string>()
  const record = async () => { seen.add(await ui.eval(stepSelector)) }
  const waitForStep = async (step: string) => {
    await ui.wait(`${stepSelector}===${JSON.stringify(step)}`)
    await record()
  }
  const cardTitles = { ...script.cards, SCQA: 'SCQA · 演示问卷', DISCOVERY: '一个小发现', NVC: script.nvc.heading, EXPERTS: '为你初步挑选 · 3 位老师' }
  async function verifyTurn(turn: (typeof turns)[number]) {
    await ui.wait('!document.querySelector(".roadshow[aria-busy=true]")')
    assert.equal(await ui.eval('!!document.querySelector(\'.roadshow header [aria-label="暂停"]\')'), false)
    if (!turn.effects.length) return
    const data = await ui.eval(`(() => {
      const group = [...document.querySelectorAll('[data-script-step]')].at(-1)
      return {
        step: group?.dataset.scriptStep,
        effects: [...(group?.children ?? [])].map(element => {
          if (element.classList.contains('bubble')) {
            const role = element.classList.contains('user') ? 'child' : element.classList.contains('mom') ? 'mother' : 'reso'
            const reply = element.querySelector('.reply-visible')
            const copy = element.cloneNode(true)
            copy.querySelector('.speaker')?.remove()
            return {kind:'message', role, text:(reply ?? copy).textContent}
          }
          if (element.matches('.roadshow-summary')) {
            return {kind:'summary', fields:[...element.querySelectorAll('dl > div')].map(row =>
              [row.querySelector('dt').textContent, row.querySelector('dd').textContent])}
          }
          if (element.matches('.roadshow-status')) return {kind:'status', text:element.textContent}
          return {kind:'card', title:element.querySelector('.mini-row strong,h2')?.textContent}
        })
      }
    })()`)
    assert.deepEqual(data, {
      step: turn.step,
      effects: turn.effects.map(effect => {
        switch (effect.kind) {
          case 'message': return effect
          case 'reply': return { kind: 'message', role: 'reso', text: stages[turn.step].reply }
          case 'summary': return { kind: 'summary', fields: Object.entries(stages[turn.step].summary) }
          case 'card': return { kind: 'card', title: cardTitles[effect.card_id] }
          case 'status': return { kind: 'status', text: effect.text + ' · 未分享聊天内容' }
        }
      }),
    }, `rendered effects for STEP ${turn.step}`)
  }
  async function finishReview() {
    const shouldReview = await ui.eval(`[...document.querySelectorAll('.roadshow-locate button')]
      .some(button => ['查看 Reso 回复','收起决策摘要'].includes(button.textContent.trim()))`)
    if (!shouldReview) return
    assert.equal(await ui.eval('!!document.querySelector(".roadshow-composer textarea")'), false)
    assert.equal(await ui.eval('!![...document.querySelectorAll("[data-script-step]")].at(-1)?.querySelector(".roadshow-summary[open]")'), true)
    await ui.eval('document.querySelector(".roadshow main").scrollTo({top:1e7,behavior:"instant"})')
    await ui.button('收起决策摘要')
    assert.equal(await ui.eval('!![...document.querySelectorAll("[data-script-step]")].at(-1)?.querySelector(".roadshow-summary[open]")'), false)
  }
  const labels: Record<string, string> = {
    'discovery.like': '有点像我',
    'narrative.focus': '叙事小练习',
    'narrative.start': '开始看看',
    'act1.confirm': '有点像当时的我',
    'act2.confirm': '有点像我',
    'act3.confirm': '这确实是我做的',
    'story.save': '保存我的故事',
    'demo.revisit': '下次再聊',
    'memory.continue': '继续聊这件事',
    'invite.select_method': '选用「生成链接」',
    'invite.confirm_name': '确认名称，继续邀请',
    'demo.continue': '双方愿意继续',
    'nvc.start': script.nvc.button,
    'demo.private_followup': '回到孩子私聊',
    'experts.select_lin': '了解林老师的服务',
    'booking.no_share': '不分享聊天内容',
    'booking.submit': '确认不分享并提交预约',
  }

  ui.shell('shell', 'am', 'force-stop', 'app.reso.local.roadshow')
  ui.shell('shell', 'am', 'start', '-W', '-n', 'app.reso.local.roadshow/app.reso.local.MainActivity')
  try {
    await ui.connect({ roadshow: true })
    await waitForStep('01')
    assert.equal(await ui.eval('document.querySelector(".roadshow-welcome-actions .button").disabled'), true)
    assert.equal(await ui.eval('!!document.querySelector(".roadshow > header")'), false)
    await ui.shot('step-01-welcome')
    for (const [label, title] of [['《用户协议》', '用户协议'], ['《隐私政策》', '隐私政策'], ['未满18岁？了解监护人协助', '监护人协助']]) {
      await ui.button(label)
      assert.equal(await ui.eval('document.querySelector("dialog h2")?.textContent'), title)
      ui.shell('shell', 'input', 'keyevent', '4')
      await ui.wait('!document.querySelector("dialog")')
    }
    await ui.button('加入三方会谈')
    await ui.wait('document.querySelector("header h1")?.textContent === "加入三方会谈"')
    await ui.button('返回', 'header')
    assert.equal(await ui.eval('document.querySelector(".roadshow-welcome-actions .button").disabled'), true)
    await ui.click('.roadshow-agreement input')
    await ui.shot('step-01-welcome-agreed')
    await ui.button('开始聊聊')
    await ui.text(script.steps['01'].reply)
    await verifyTurn(turns[0])
    assert.equal(await ui.eval(`document.querySelector('.roadshow header h1').textContent`), 'Reso')
    assert.equal(await ui.eval(`document.querySelector('.roadshow header').innerText.includes('STEP')`), false)
    await finishReview()
    const draft = '切换时保留这条草稿'
    await ui.value('.roadshow-input-row textarea', draft)
    assert.deepEqual(await ui.eval(`[...document.querySelectorAll('.roadshow-app-nav button')].map(button => button.textContent.trim())`), ['Reso', '我的关系'])
    await ui.button('我的关系', '.roadshow-app-nav')
    await ui.text('正在一起聊')
    await ui.button('查看全部 5 个事件')
    await ui.text('我想自己做决定')
    await ui.value('.relations-search input', '小卖部')
    assert.deepEqual(await ui.eval(`[...document.querySelectorAll('.roadshow-relations .relations-row strong')].map(e=>e.textContent)`), ['去小卖部，他们没叫我'])
    await ui.value('.relations-search input', '')
    await ui.button('重要的人', '.relations-switch')
    assert.deepEqual(await ui.eval(`[...document.querySelectorAll('.relations-recent strong')].map(e=>e.textContent)`), ['妈妈','爸爸','小林'])
    await ui.click('.relations-person-group:first-child summary')
    await ui.wait('document.querySelector(".relations-person-group").open')
    await ui.click('.relations-person-group:first-child summary')
    await ui.button('看看玩法')
    await ui.text('最近哪件小事让你开心了一下？')
    ui.shell('shell', 'input', 'keyevent', '4')
    await ui.wait('!document.querySelector("dialog") && document.querySelector(".roadshow").dataset.roadshowResult === "people"')
    await ui.button('Reso', '.roadshow-app-nav')
    assert.equal(await ui.eval(stepSelector), '01')
    assert.equal(await ui.eval('document.querySelector(".roadshow-input-row textarea").value'), draft)
    await ui.fill('.roadshow-input-row textarea', '这不是当前台词。')
    await ui.button('发送消息')
    await ui.text('已暂停')
    assert.equal(await ui.eval(stepSelector), '01')
    ui.shell('shell', 'input', 'keyevent', '4')
    await ui.wait('!document.querySelector("dialog")')

    for (const turn of turns.slice(1)) {
      const action = turn.action
      await ui.wait(`document.querySelector(".roadshow")?.dataset.roadshowAction===${JSON.stringify(action)}`)
      switch (action) {
        case 'chat.send':
          const message = turn.effects.find(effect => effect.kind === 'message')
          assert.ok(message && message.role !== 'reso')
          await finishReview()
          if (message.role === 'mother') {
            await ui.text('等待妈妈发言')
            assert.equal(await ui.eval('!!document.querySelector(".roadshow-composer textarea")'), false)
            if (mother) {
              assert.equal(await ui.eval("document.body.innerText.includes('预览妈妈的消息')"), false)
              await mother.wait(`Number(document.querySelector(".roadshow")?.dataset.companionCursor)===${turns.indexOf(turn)} &&
                !!document.querySelector(".roadshow-composer textarea")`)
              await mother.fill('.roadshow-input-row textarea', message.text)
              if (turn.step === '23') {
                await ui.shot('child-waiting-for-mother')
                await mother.shot('mother-writing')
              }
              await mother.button('发送消息')
              await ui.wait(`document.querySelector(".roadshow")?.dataset.roadshowStep===${JSON.stringify(turn.step)} &&
                [...document.querySelectorAll(".bubble.mom")].at(-1)?.textContent.includes(${JSON.stringify(message.text)})`)
              if (turn.step === '23') await ui.shot('child-received-mother')
            } else await ui.button('预览妈妈的消息')
            break
          }
          await ui.fill('.roadshow-input-row textarea', turn.step === '02' ? message.text.replace(/[，。]/g, '') : message.text)
          if (turn.step === '02') await ui.eval(`(() => {
            window.replyLengths = new Set()
            const observer = new MutationObserver(() => {
              const reply = document.querySelector('[data-script-step="02"] .progressive-reply')
              if (reply?.dataset.revealing === 'true') window.replyLengths.add(reply.querySelector('.reply-visible').textContent.length)
              else if (reply) observer.disconnect()
            })
            observer.observe(document.querySelector('main'), {subtree:true,childList:true,characterData:true,attributes:true})
          })()`)
          if (turn.step === '22') {
            assert.ok(await ui.eval('document.querySelector(".roadshow-input-row textarea").clientHeight > 48'))
            await ui.shot('step-22-composer')
          }
          await ui.button('发送消息')
          break
        case 'scqa.complete':
          await ui.button('查看问卷')
          assert.equal(await ui.eval('document.activeElement?.classList.contains("roadshow-action-target")'), true)
          assert.equal(await ui.eval('document.querySelector(".roadshow-header").getBoundingClientRect().top >= 0'), true)
          assert.equal(await ui.eval(`(() => {
            const target = document.activeElement.getBoundingClientRect()
            const viewport = document.querySelector('.roadshow main').getBoundingClientRect()
            return target.top >= viewport.top && target.top + 48 < viewport.bottom
          })()`), true)
          await ui.shot('step-04a-questionnaire')
          for (let index = 1; index <= 24; index++) {
            await ui.text(`${index} / 24`)
            await ui.click(`.roadshow .answer-grid label:nth-of-type(${index === 2 ? 5 : 4}) input`)
            if (index === 2) {
              await ui.text(script.example)
              await ui.button('上一题')
              assert.equal(await ui.eval('document.querySelector(".answer-grid input:checked + .answer-number").textContent'), '4')
              await ui.button('下一题')
              assert.equal(await ui.eval('document.querySelector(".answer-grid input:checked + .answer-number").textContent'), '5')
            }
            await ui.button(index < 24 ? '下一题' : '完成问卷')
          }
          break
        case 'demo.shared_room_open':
          if (mother) {
            await ui.button('连接妈妈的手机')
            await ui.wait('!!document.querySelector(".roadshow-pairing input")')
            const [address, token] = (await ui.eval('document.querySelector(".roadshow-pairing input").value') as string).split('/')
            const port = address.split(':')[1]
            roomForward = ui.shell('forward', 'tcp:0', 'tcp:' + port)
            mother.shell('shell', 'am', 'force-stop', 'app.reso.local.roadshow')
            mother.shell('shell', 'am', 'start', '-W', '-n', 'app.reso.local.roadshow/app.reso.local.MainActivity')
            await mother.connect({ roadshow: true })
            await mother.button('加入三方会谈')
            await mother.fill('.field-label input', `10.0.2.2:${roomForward}/${token}`)
            await mother.button('确认加入')
            await ui.text('妈妈已加入')
          }
          const consents = ['孩子同意邀请妈妈', '妈妈同意参与会谈', '确认分享本次事件摘要']
          if (!mother) consents.push('模拟妈妈接受邀请')
          for (const label of consents) {
            await ui.check(label)
          }
          await ui.button('进入三方会谈')
          assert.equal(await ui.eval(`document.querySelector("main").innerText.includes(${JSON.stringify(example)})`), false)
          if (mother) assert.equal(await mother.eval(`document.querySelector("main").innerText.includes(${JSON.stringify(example)})`), false)
          break
        case 'story.save':
          await ui.button('我想修改')
          await ui.fill('.roadshow .story-body textarea', '妈妈的话可以让我难过。那份进步和开心都是真的。')
          await ui.button('预览修改')
          await ui.button(labels[action])
          break
        case 'experts.select_lin': {
          await ui.button('查看咨询师推荐')
          const profile = `document.querySelector('.expert-slide[data-state="current"]')`
          const center = `${profile}.querySelector('h3').textContent`
          const sizes = `[...document.querySelector('.roadshow-expert-carousel').children].map(card => {
            const { width, height } = card.getBoundingClientRect()
            return [width, height]
          })`
          assert.equal(await ui.eval(center), '林老师')
          const initialSizes = await ui.eval(sizes)
          await ui.text('现在不优先')
          await ui.text('最终匹配仍需资质核验与专业评估')
          for (const teacher of ['林老师', '周老师', '张老师', '林老师']) {
            if (await ui.eval(center) !== teacher) await ui.button(`查看${teacher}`)
            await ui.wait(`!${profile}.getAnimations().some(animation=>animation.playState==='running')`)
            assert.equal(await ui.eval(center), teacher)
            assert.deepEqual(await ui.eval(sizes), initialSizes)
            assert.deepEqual(await ui.eval(`(() => {
              const card = ${profile}
              return {badge:card.querySelector('.expert-photo span').textContent, tag:!!card.querySelector('.expert-name span'),
                points:card.querySelectorAll('.expert-reasons li').length,
                cta:card.querySelector('.button').textContent.trim(),
                bottom:Math.round(card.getBoundingClientRect().bottom-card.querySelector('.button').getBoundingClientRect().bottom)}
            })()`), { badge: '公益', tag: true, points: 3, cta: `了解${teacher}的服务`, bottom: 10 })
            if (teacher !== '林老师') {
              await ui.button(`了解${teacher}的服务`, '.expert-slide[data-state=current]')
              await ui.wait(`document.querySelector('dialog h2')?.textContent===${JSON.stringify(`${teacher}的服务`)}`)
              ui.shell('shell', 'input', 'keyevent', '4')
              await ui.wait('!document.querySelector("dialog")')
              assert.equal(await ui.eval('document.querySelector(".roadshow").dataset.roadshowAction'), action)
            }
            await ui.eval(`document.activeElement?.blur(); document.querySelector('.roadshow-expert-section').scrollIntoView({block:'start',behavior:'instant'})`)
            await ui.shot(`expert-${teacher}`)
          }
          await ui.eval(`document.querySelector('.roadshow-expert-section').scrollIntoView({block:'start',behavior:'instant'})`)
          await ui.wait(`document.querySelector('.roadshow-expert-carousel').getBoundingClientRect().top < document.querySelector('main').getBoundingClientRect().bottom - 100`)
          await ui.shot('three-expert-cards')
          await ui.button(labels[action])
          break
        }
        default:
          assert.ok(labels[action], `Missing UI action for ${action}`)
          await ui.button(labels[action])
      }
      await waitForStep(turn.step)
      await verifyTurn(turn)
      if (turn.step === '02') {
        assert.ok(await ui.eval('window.replyLengths.size > 2'))
        await ui.shot('step-02-decision')
      }
      if (turn.step === '03') {
        const previous = '[data-script-step="02"] details'
        assert.equal(await ui.eval(`document.querySelector(${JSON.stringify(previous)}).open`), false)
        await ui.click(previous + ' > summary')
        assert.equal(await ui.eval(`document.querySelector(${JSON.stringify(previous)}).open`), true)
      }
      if (action === 'demo.private_followup') {
        await ui.text(example)
        assert.equal(await ui.eval('!!document.querySelector(".bubble.mom")'), false)
      }
      if (action === 'story.save') await ui.text('故事已保存')
      if (turn.step === '18' && action === 'chat.send') {
        await ui.text('开始思考怎样表达需要')
        assert.equal(await ui.eval('document.querySelector("main").innerText.includes("妈妈表达自己的懊恼")'), false)
      }
    }
    await ui.text('预约申请已模拟提交')
    await ui.button('打开「我的关系」')
    await waitForStep('29')
    await ui.shot('step-29-relations-events')
    await ui.click('.relations-exam')
    await waitForStep('30')
    await ui.text('新的尝试 · 换一种方式沟通')
    await ui.shot('step-30-event')
    await ui.button('继续聊这件事')
    assert.equal(await ui.eval('!!document.querySelector(".bubble.mom")'), true)
    assert.equal(await ui.eval(`document.querySelector("main").innerText.includes(${JSON.stringify(example)})`), false)
    await ui.button('返回')
    await ui.button('返回')
    await ui.button('重要的人')
    await ui.shot('step-31-relations-people')
    await ui.button('妈妈', '.relations-recent')
    await waitForStep('31')
    await ui.text('我对这段关系的新理解')
    await ui.button('返回')
    await ui.button('一件小事')
    await ui.button('查看已保存的故事')
    await waitForStep('32')
    await ui.text('已保存 · 仅自己可见')
    await ui.text('妈妈的话可以让我难过。那份进步和开心都是真的。')
    await ui.button('返回')
    await ui.button('重要的人')
    await ui.click('.relations-private-row')
    await ui.text('不分享聊天内容 · 仅自己可见')
    await ui.shot('step-32-support')
    await ui.button('返回我的关系')
    await ui.text('我的成长卡片')
    assert.equal(await ui.eval("document.body.innerText.includes('已走完 32 步')"), false)

    assert.deepEqual([...seen].filter(step => !step.includes('-')), Array.from({ length: 32 }, (_, index) => String(index + 1).padStart(2, '0')))
    assert.ok(seen.has('04-A') && seen.has('25-A'))
    assert.equal(await ui.eval("performance.getEntriesByType('resource').every(entry=>new URL(entry.name).origin===location.origin&&!new URL(entry.name).pathname.startsWith('/api/'))"), true)
    assert.deepEqual(ui.errors, [])
    if (mother) {
      await mother.text('本次会谈已结束')
      assert.deepEqual(mother.errors, [])
    }
  } finally {
    await mother?.close()
    if (roomForward) ui.shell('forward', '--remove', 'tcp:' + roomForward)
    await ui.close()
  }
})

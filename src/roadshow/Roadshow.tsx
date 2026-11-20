import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, HandHeart, LocateFixed, MessageSquare, Send, ShieldCheck, Sparkles, UserRound, UsersRound } from 'lucide-react'
import { Bubble, Button, Card, Dialog } from '../components'
import { PrimaryNavigation } from '../PrimaryNavigation'
import { ProgressiveReply } from '../ProgressiveReply'
import { examName, RoadshowCard, storyText } from './Cards'
import { MotherRoom } from './MotherRoom'
import { RelationsHome } from './RelationsHome'
import { resultLabels, RoadshowResults } from './Results'
import type { ResultPage } from './Results'
import { comparableLine, dialogueInput, sharedEnd, sharedStart, sharedTurn, stages, turns } from './flow'
import { meeting } from './meeting'
import type { Snapshot } from './meeting'
import script from './script.json'
import './roadshow.css'
import './relations.css'

const inviteMethods = ['生成链接', '微信邀请', '我的二维码']
const sharedSummary = '关于那次考试，想一起聊聊听到「就差几分」时各自的感受，以及以后希望怎样沟通。'
const inviteConfirmations = [
  '孩子同意邀请妈妈',
  '妈妈同意参与会谈',
  '确认分享本次事件摘要',
  '模拟妈妈接受邀请',
]
const restartPrompt = '可以继续聊天，或从头开始体验。'
const storySaveIndex = turns.findIndex(turn => turn.action === 'story.save')
const welcomePromises = [
  { icon: UserRound, color: 'purple', title: '分享内容由你决定', text: '你可以选择是否分享这次事件的摘要。' },
  { icon: HandHeart, color: 'green', title: '聊什么、说多少，按你的节奏来', text: '你可以慢慢来，也可以随时离开。' },
  { icon: MessageSquare, color: 'pink', title: '有些事，也可以和咨询师聊聊', text: '如果你愿意，我可以帮你找到合适的专业咨询师。' },
]
const welcomeInfo = {
  用户协议: '请使用示例文字体验固定对话。咨询师资料和申请结果用于体验，提交申请不会联系咨询师。',
  隐私政策: '本体验的私聊留在当前页面，页面重新载入后清除。通过配对码加入会谈时，另一部手机可以查看经确认分享的事件摘要及会谈消息。',
  监护人协助: '如果聊到让你担心的事，可以找信任的监护人一起商量。你可以自行决定是否邀请家长参与会谈，以及是否分享事件摘要。',
}
const cardTargets: Partial<Record<string, [keyof typeof script.cards, string]>> = {
  'scqa.complete': ['SCQA', '查看问卷'],
  'discovery.like': ['DISCOVERY', '查看发现卡'],
  'narrative.focus': ['NARRATIVE_OPTIONS', '查看练习选项'],
  'narrative.start': ['NARRATIVE_OFFER', '查看叙事练习'],
  'act1.confirm': ['ACT_1', '查看第一幕'],
  'act2.confirm': ['ACT_2', '查看第二幕'],
  'act3.confirm': ['ACT_3', '查看第三幕'],
  'story.save': ['ACT_4', '查看故事卡'],
  'memory.continue': ['EVENT_MEMORY', '查看事件记忆'],
  'nvc.start': ['NVC', '查看沟通练习'],
  'experts.select_lin': ['EXPERTS', '查看咨询师推荐'],
}

function showInConversation(conversation: HTMLElement | null, target: HTMLElement) {
  if (!conversation) return
  const top = conversation.scrollTop + target.getBoundingClientRect().top - conversation.getBoundingClientRect().top - 12
  conversation.scrollTo({ top, behavior: 'instant' })
}

export default function Roadshow({ standalone = false }: { standalone?: boolean }) {
  const [session, setSession] = useState(0)
  const [joining, setJoining] = useState(false)
  return joining ? <MotherRoom leave={() => setJoining(false)}/> :
    <RoadshowSession key={session} standalone={standalone} restart={() => setSession(value => value + 1)} join={() => setJoining(true)}/>
}

function RoadshowSession({ restart, standalone, join }: { restart: () => void; standalone: boolean; join: () => void }) {
  const [cursor, setCursor] = useState(0)
  const [agreed, setAgreed] = useState(false)
  const [welcomeSheet, setWelcomeSheet] = useState<keyof typeof welcomeInfo>()
  const [draft, setDraft] = useState('')
  const [story, setStory] = useState(storyText)
  const [paused, setPaused] = useState('')
  const [revealed, setRevealed] = useState(0)
  const [replying, setReplying] = useState(false)
  const [replySeen, setReplySeen] = useState(false)
  const [summaryClosed, setSummaryClosed] = useState(false)
  const [code, setCode] = useState('')
  const [peerConnected, setPeerConnected] = useState(false)
  const [opening, setOpening] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [roomName, setRoomName] = useState(examName)
  const [method, setMethod] = useState(inviteMethods[0])
  const [consent, setConsent] = useState<string[]>([])
  const [resultPath, setResultPath] = useState<ResultPage[]>([])
  const viewport = useRef<HTMLElement>(null)
  const latest = useRef<HTMLDivElement>(null)
  const activeControl = useRef<HTMLDivElement>(null)
  const next = turns[cursor]
  const action = next?.action ?? ''
  const current = turns[Math.max(0, cursor - 1)]
  const busy = cursor > 0 && (revealed < current.effects.length || replying)
  const firstResoEffect = current.effects.findIndex(effect => effect.kind === 'summary' || effect.kind === 'reply' ||
    (effect.kind === 'message' && effect.role === 'reso'))
  const waitingForReso = busy && !replying && revealed === firstResoEffect
  const result = resultPath.at(-1)
  const relationsPage = result === 'events' || result === 'people' ? result : undefined
  const shared = sharedTurn(cursor - 1)
  const step = result ? String(resultLabels[result][0]) : current.step
  const fixed = dialogueInput(cursor)
  const motherTurn = !!fixed && shared && fixed.role === 'mother'
  const requiresReview = !!fixed && current.effects.some(effect => effect.kind === 'summary')
  const held = requiresReview && (!replySeen || !summaryClosed)
  const requiredConsents = code ? inviteConfirmations.slice(0, 3) : inviteConfirmations

  function advance(expected: string) {
    if (action !== expected || paused || busy || (expected === 'chat.send' && held)) return
    setRevealed(0)
    setReplySeen(false)
    setSummaryClosed(false)
    setCursor(position => position === cursor ? position + 1 : position)
    setDraft('')
  }

  function lastReply() {
    return Array.from(latest.current?.querySelectorAll<HTMLElement>('.bubble.reso') ?? []).at(-1)
  }

  function showReply() {
    const reply = lastReply()
    if (reply) showInConversation(viewport.current, reply)
  }

  useEffect(() => {
    if (result || !requiresReview || busy || replySeen || !viewport.current) return
    const reply = lastReply()
    if (!reply) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio >= .9) setReplySeen(true)
    }, { root: viewport.current, threshold: .9 })
    observer.observe(reply)
    return () => observer.disconnect()
  }, [result, requiresReview, busy, replySeen, cursor])

  useEffect(() => {
    if (!code) return
    let stopped = false
    let timer = 0
    async function publish() {
      try {
        const state = await meeting<Snapshot>({
          action: 'publish', cursor: Math.max(sharedStart, Math.min(sharedEnd, busy ? cursor - 1 : cursor)),
          motherTurn: motherTurn && !busy && !held && !paused, ended: cursor >= sharedEnd && !busy,
        })
        if (stopped) return
        setPeerConnected(state.connected)
        setLinkError('')
        if (state.received && motherTurn && !busy && !held && !paused) {
          advance('chat.send')
          return
        }
        if (state.ended) return
      } catch (error) {
        if (stopped) return
        setLinkError(error instanceof Error ? error.message : '会谈连接中断')
      }
      timer = window.setTimeout(publish, 450)
    }
    void publish()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [code, cursor, motherTurn, busy, held, paused])

  useEffect(() => {
    if (code) return () => { void meeting({ action: 'close' }).catch(() => {}) }
  }, [code])

  async function createCode() {
    setOpening(true)
    setLinkError('')
    try {
      const result = await meeting<{ code: string }>({ action: 'open', cursor: sharedStart })
      setCode(result.code)
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : '无法创建配对码')
    } finally { setOpening(false) }
  }

  function openResult(page: ResultPage) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setResultPath(path => page === path.at(-1) ? path : page === 'events' || page === 'people' ? [page] : [...path, page])
  }

  function resumeChat() {
    if (!result) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setResultPath([])
  }

  function back() {
    const closeDialog = document.querySelector<HTMLButtonElement>('.roadshow dialog[open] button[aria-label="关闭"]')
    if (welcomeSheet) setWelcomeSheet(undefined)
    else if (paused) setPaused('')
    else if (closeDialog) closeDialog.click()
    else if (resultPath.length > 1) setResultPath(path => path.slice(0, -1))
    else if (result) setResultPath([])
    else if (!standalone) setPaused(restartPrompt)
    else return false
    return true
  }

  useEffect(() => {
    function onBack(event: Event) {
      if (back()) event.preventDefault()
    }
    window.addEventListener('reso-back', onBack)
    return () => window.removeEventListener('reso-back', onBack)
  })

  useEffect(() => {
    const effect = current.effects[revealed]
    if (!cursor || !effect || replying) return
    const spokenByReso = effect.kind === 'reply' || (effect.kind === 'message' && effect.role === 'reso')
    const humanMessage = effect.kind === 'message' && effect.role !== 'reso'
    const afterSummary = current.effects[revealed - 1]?.kind === 'summary'
    const delay = humanMessage ? 0 : waitingForReso ? 1450 : spokenByReso && !afterSummary ? 450 : 190
    const timer = window.setTimeout(() => {
      if (spokenByReso) setReplying(true)
      setRevealed(count => count + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [current, cursor, revealed, replying, waitingForReso])

  useLayoutEffect(() => {
    if (!cursor) viewport.current?.scrollTo({ top: 0, behavior: 'instant' })
    else if (latest.current) showInConversation(viewport.current, latest.current)
    else viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'instant' })
  }, [cursor])

  useLayoutEffect(() => {
    if (revealed === 1 && latest.current) showInConversation(viewport.current, latest.current)
  }, [revealed])

  function followReply() {
    const conversation = viewport.current
    if (conversation && conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 120) {
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: 'instant' })
    }
  }

  function response(text: string, latestEffect: boolean) {
    return <ProgressiveReply text={text} animate={latestEffect} onStart={followReply} onChunk={followReply}
      onComplete={latestEffect ? () => setReplying(false) : undefined}/>
  }
  function actionButton(label: string, expected = action) {
    return <Button onClick={() => advance(expected)}>{label}<ArrowRight/></Button>
  }

  function inlineControls() {
    switch (action) {
      case 'demo.revisit':
        return <Card title="故事已保存"><p className="roadshow-private">仅自己可见 · 已授权在本次演示中回看</p>
          {actionButton('下次再聊')}</Card>
      case 'invite.select_method':
        return <Card title="选择邀请方式"><fieldset className="roadshow-choices"><legend className="sr-only">邀请方式</legend>
          {inviteMethods.map(value => <label key={value}><input type="radio" name="invite-method" checked={method === value} onChange={() => setMethod(value)}/>{value}</label>)}
          </fieldset><Button onClick={() => advance(action)}>选用「{method}」<ArrowRight/></Button></Card>
      case 'invite.confirm_name':
        return <Card title="核对事件房名称"><label className="field-label">事件房名称<input value={roomName} maxLength={40} onChange={event => setRoomName(event.target.value)}/></label>
          <div className="two-actions"><Button secondary onClick={() => setPaused('你选择暂缓邀请。')}>先不邀请</Button>
            <Button disabled={!roomName.trim()} onClick={() => { setRoomName(roomName.trim()); advance(action) }}>确认名称，继续邀请<ArrowRight/></Button>
          </div></Card>
      case 'demo.shared_room_open':
        return <Card title="确认模拟邀请和分享范围">
          <p><strong>将分享的事件摘要</strong></p>
          <p>{sharedSummary}</p>
          <p className="muted">私人聊天、问卷和故事仅自己可见。</p>
          <fieldset className="roadshow-choices"><legend className="sr-only">模拟同意和加入</legend>
          {requiredConsents.map(item => <label key={item}><input type="checkbox" checked={consent.includes(item)} onChange={event => {
            const checked = event.target.checked
            setConsent(previous => checked ? [...previous, item] : previous.filter(value => value !== item))
          }}/>{item}</label>)}</fieldset>
          {!!window.ResoMeeting && (code ? <div className="roadshow-pairing">
            <label className="field-label">妈妈端配对码<input readOnly value={code} onFocus={event => event.target.select()}/></label>
            <p className="muted">{peerConnected ? '妈妈已加入' : '请在另一部手机打开 Reso，选择「加入三方会谈」。两部手机需连接同一 Wi-Fi。'}</p>
          </div> : <Button secondary disabled={opening} onClick={() => void createCode()}>
            {opening ? '正在生成配对码…' : '连接妈妈的手机'}
          </Button>)}
          {linkError && <p role="alert" className="muted">{linkError}</p>}
          <Button disabled={opening || !requiredConsents.every(item => consent.includes(item)) || (!!code && !peerConnected)}
            onClick={() => advance(action)}>进入三方会谈<ArrowRight/></Button>
        </Card>
      case 'demo.continue':
        return <div className="roadshow-cue">{actionButton('双方愿意继续')}</div>
      case 'demo.private_followup':
        return <Card title="本次会谈结束"><p>会谈记录已保留。接下来回到孩子和 Reso 的私聊。</p>{actionButton('回到孩子私聊')}</Card>
      case 'booking.no_share':
        return <Card title="选择资料分享范围"><div className="two-actions">
          <Button secondary onClick={() => setPaused('你选择分享摘要。固定路演的预约流程暂停在这里。')}>仅分享事件摘要</Button>
          <Button onClick={() => advance(action)}>不分享聊天内容<ArrowRight/></Button>
        </div></Card>
      case 'booking.submit':
        return <Card title="确认模拟预约"><p>林老师 · 不分享聊天内容</p>{actionButton('确认不分享并提交预约')}</Card>
      default:
        if (cursor === turns.length) return <div className="roadshow-cue"><Button onClick={() => openResult('events')}>打开「我的关系」<ArrowRight/></Button></div>
        if (cursor && current.action === 'experts.select_lin') return <Card title="林老师的服务"><p>青少年 CBT · 亲子沟通</p><p>演示资料。可以先了解服务，再决定是否申请。</p></Card>
        if (action === 'chat.send' && current.action === 'booking.no_share') return <p className="roadshow-status"><CircleCheck size={18}/> 已选择不分享聊天内容</p>
        return null
    }
  }

  const activeCard = cardTargets[action]
  const panel = cursor && !busy ? inlineControls() : null
  const actionLabel = busy ? '' : activeCard?.[1] ?? (panel && !fixed ? '查看当前操作' : '')

  function renderTurn(turn: (typeof turns)[number], index: number, archive = false) {
    if (!turn.effects.length) return null
    const isLatest = !archive && index === cursor - 1
    const effects = index === cursor - 1 ? turn.effects.slice(0, revealed) : turn.effects
    return <div key={index} className="roadshow-turn" data-script-step={turn.step} ref={isLatest ? latest : undefined}>
      {effects.map((effect, order) => {
        const animate = isLatest && order === revealed - 1 && replying
        switch (effect.kind) {
          case 'message':
            return <Bubble key={order} role={effect.role === 'child' ? 'user' : effect.role === 'mother' ? 'mom' : 'reso'}>
              {effect.role === 'reso' ? response(effect.text, animate) : effect.text}
            </Bubble>
          case 'summary':
            return <DecisionSummary key={order} step={turn.step} open={isLatest && !summaryClosed}
              review={isLatest && requiresReview ? () => {
                if (replySeen) setSummaryClosed(value => !value)
                else showReply()
              } : undefined}/>
          case 'reply':
            return <Bubble key={order}>{response(stages[turn.step].reply, animate)}</Bubble>
          case 'card': {
            const active = !archive && activeCard?.[0] === effect.card_id
            return <div key={order} ref={active ? activeControl : undefined} tabIndex={active ? -1 : undefined}
              className={active ? 'roadshow-action-target' : undefined} inert={busy && active}>
              <RoadshowCard id={effect.card_id} action={archive ? '' : action} advance={advance} pause={setPaused}
                roomName={roomName} story={story} onStoryChange={setStory}/>
            </div>
          }
          case 'status':
            return <p key={order} className="roadshow-status" role="status"><CircleCheck size={18}/>{effect.text} · 未分享聊天内容</p>
        }
      })}
    </div>
  }

  return <div className="app roadshow" data-roadshow-step={step} data-roadshow-action={busy ? '' : action}
    data-roadshow-speaker={fixed?.role} data-roadshow-result={result} aria-busy={busy && !result || undefined}>
    {!cursor ? <main className="welcome-scroll roadshow-welcome" aria-label="Reso 开始页">
      <section className="welcome-hero">
        <div className="welcome-copy">
          <p className="roadshow-youth">青少年版</p>
          <h1>你好，<br/>我是 Reso</h1>
          <h2>AI 关系理解与沟通引导者</h2>
          <p>我们可以从一件让你在意的小事开始，慢慢理清发生了什么。</p>
        </div>
        <img src="/assets/reso-welcome.webp" width="356" height="525" alt="Reso 抱着爱心向你招手"/>
        <Sparkles className="roadshow-welcome-sparkle" aria-hidden="true"/>
      </section>
      <section className="privacy-highlight">
        <div className="feature-icon blue" aria-hidden="true"><ShieldCheck/></div>
        <div><p>先让你安心</p><h2>你的对话默认私密</h2><span>你的信息会被严格保护，<br/>只在获得授权的范围内使用。</span></div>
        <Sparkles className="tiny-sparkle" aria-hidden="true"/>
      </section>
      <section className="welcome-promises">
        {welcomePromises.map(({ icon: Icon, color, title, text }) => <div className="promise" key={title}>
          <div className={`feature-icon ${color}`} aria-hidden="true"><Icon/></div>
          <div><h2>{title}</h2><p>{text}</p></div>
        </div>)}
      </section>
      <footer className="welcome-actions roadshow-welcome-actions">
        <div className="roadshow-agreement">
          <label className="check-row">
            <span className="roadshow-check"><input type="checkbox" aria-label="同意用户协议和隐私政策" checked={agreed}
              onChange={event => setAgreed(event.target.checked)}/><Check aria-hidden="true"/></span>
            我已阅读并同意
          </label>
          <span><button type="button" className="inline-link" onClick={() => setWelcomeSheet('用户协议')}>《用户协议》</button>和<button type="button"
            className="inline-link" onClick={() => setWelcomeSheet('隐私政策')}>《隐私政策》</button></span>
        </div>
        <Button disabled={!agreed} onClick={() => advance('welcome.start')}>开始聊聊<ArrowRight aria-hidden="true"/></Button>
        <button type="button" className="guardian-link" onClick={() => setWelcomeSheet('监护人协助')}>未满18岁？了解监护人协助<ChevronRight aria-hidden="true"/></button>
        {!!window.ResoMeeting && <button type="button" className="text-button centered" onClick={join}>加入三方会谈</button>}
        {!standalone && <a className="text-button centered" href="/">返回 Reso</a>}
      </footer>
    </main> : <>
    <div className="roadshow-panels">
      <RelationsHome page={relationsPage} roomName={roomName} roomStarted={cursor > sharedStart}
        storySaved={cursor > storySaveIndex} applied={cursor === turns.length && !busy} open={openResult} resume={resumeChat}/>
      {result && !relationsPage && <div className="roadshow-result-view">
        <header className="app-header roadshow-header">
          <button type="button" className="icon-button back" aria-label="返回" onClick={back}><ChevronLeft/></button>
          <div className="roadshow-heading"><h1>{resultLabels[result][1]}</h1></div>
        </header>
        <main key={result} className="conversation" aria-label={resultLabels[result][1]}>
          <div className="conversation-content roadshow-stream">
            {result === 'room' ? <>
              <div className="roadshow-room">{roomName} · 孩子、妈妈、Reso</div>
              <details className="shared-preview"><summary>本次会谈获授权的事件摘要</summary><p>{sharedSummary}</p></details>
              {turns.slice(sharedStart, Math.min(cursor, sharedEnd)).map((turn, index) => renderTurn(turn, sharedStart + index, true))}
            </> : result !== 'events' && result !== 'people' &&
              <RoadshowResults page={result} roomName={roomName} story={story} open={openResult}
                roomFinished={cursor >= sharedEnd} resume={resumeChat}/>}
          </div>
        </main>
      </div>}
    <div className="roadshow-chat-view" data-covered={!!result} inert={!!result}>
    <header className="app-header roadshow-header">
      {!standalone && <button type="button" className="icon-button back" aria-label="退出路演" onClick={back}><ChevronLeft/></button>}
      <img className="header-mascot" src="/assets/reso-avatar.webp" alt="" width="47" height="57"/>
      <div className="roadshow-heading"><h1>{shared ? '三方会谈' : 'Reso'}</h1></div>
    </header>
    {shared && <div className="roadshow-room">{roomName} · 孩子、妈妈、Reso</div>}
    <main ref={viewport} className="conversation" aria-label={shared ? '模拟三方会谈' : '模拟私人聊天'}>
      <div className="conversation-content roadshow-stream">
        {shared && <details className="shared-preview"><summary>本次会谈获授权的事件摘要</summary><p>{sharedSummary}</p></details>}
        {turns.slice(0, cursor).map((turn, index) => sharedTurn(index) === shared && renderTurn(turn, index))}
        {panel && <div ref={!activeCard && !fixed ? activeControl : undefined} tabIndex={!fixed ? -1 : undefined}
          className="roadshow-action-target">{panel}</div>}
        {waitingForReso &&
          <p className="typing" role="status">Reso 正在组织回复<span aria-hidden="true">···</span></p>}
      </div>
    </main>
    {actionLabel && <footer className="roadshow-locate">
      <Button secondary onClick={() => {
        const target = activeControl.current
        if (!target) return
        showInConversation(viewport.current, target)
        target.focus({ preventScroll: true })
      }}><LocateFixed/>{actionLabel}</Button>
    </footer>}
    {held && !busy && <footer className="roadshow-locate">
      <Button secondary onClick={() => replySeen ? setSummaryClosed(true) : showReply()}>
        {replySeen ? '收起决策摘要' : '查看 Reso 回复'}
      </Button>
    </footer>}
    {motherTurn && !held && !busy && <footer className="roadshow-locate">
      <p className="muted" role="status">{linkError || '等待妈妈发言…'}</p>
      {!code && <Button secondary onClick={() => advance('chat.send')}>预览妈妈的消息</Button>}
    </footer>}
    {fixed && !motherTurn && !held && !busy && <form className="roadshow-composer" onSubmit={event => {
      event.preventDefault()
      if (!draft.trim()) return
      if (comparableLine(draft) === comparableLine(fixed.text)) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        advance('chat.send')
      } else setPaused('这句话暂时无法接续当前对话。可以修改后再发送。')
    }}>
      <div className="roadshow-input-row">
        <textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={500} rows={1}
          aria-label="消息" placeholder="也可以直接告诉我…" autoComplete="off" enterKeyHint="send"
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}/>
        <button type="submit" className="icon-button send-button" aria-label="发送消息" disabled={!draft.trim()}><Send/></button>
      </div>
    </form>}
    </div>
    </div>
    {standalone && <PrimaryNavigation className="roadshow-app-nav" relationships={!!result}
      onReso={resumeChat} onRelationships={() => { if (!result) openResult('events') }}/>}
    </>}
    {welcomeSheet && <Dialog title={welcomeSheet} onClose={() => setWelcomeSheet(undefined)}>
      <p className="dialog-description">{welcomeInfo[welcomeSheet]}</p>
    </Dialog>}
    {paused && <Dialog title="已暂停" onClose={() => setPaused('')}><p>{paused}</p>
      <div className="two-actions"><Button secondary onClick={restart}>从头开始</Button><Button onClick={() => setPaused('')}>继续</Button></div>
      {!standalone && <a className="text-button centered" href="/">退出到 Reso</a>}
    </Dialog>}
  </div>
}

function DecisionSummary({ step, open, review }: { step: string; open: boolean; review?: () => void }) {
  const fields = Object.entries(stages[step].summary)
  if (!fields.length) return null
  const groups = [
    fields.filter(([label]) => ['当前状态', '匹配情境', '参考策略', '执行方式'].includes(label)),
    fields.filter(([label]) => ['决策数据', '决策依据', '候选心理机制', '心理学理论', '心理学方法'].includes(label)),
    fields.filter(([label]) => ['动态路由', 'Skill', 'Tool'].includes(label)),
  ]
  return <details className="roadshow-summary" open={open}>
    <summary onClick={review ? event => { event.preventDefault(); review() } : undefined}>
      Reso 决策摘要<ChevronDown aria-hidden="true"/>
    </summary>
    <div className="roadshow-summary-body">
      {groups.filter(group => group.length > 0).map(group => <dl key={group[0][0]}>
        {group.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
      </dl>)}
    </div>
  </details>
}

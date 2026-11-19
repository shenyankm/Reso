import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Send } from 'lucide-react'
import { Bubble, Button, Card } from '../components'
import { comparableLine, dialogueInput, sharedEnd, sharedStart, stages, turns } from './flow'
import { meeting } from './meeting'
import type { Snapshot } from './meeting'

export function MotherRoom({ leave }: { leave: () => void }) {
  const [code, setCode] = useState('')
  const [joinedCode, setJoinedCode] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [inputError, setInputError] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(-1)
  const scroll = useRef<HTMLElement>(null)
  const cursor = snapshot?.cursor ?? sharedStart
  const line = dialogueInput(cursor)
  const canSend = snapshot?.motherTurn && line?.role === 'mother' && sent !== cursor

  useEffect(() => {
    if (!joinedCode) return
    let cancelled = false
    let timer = 0
    async function poll() {
      try {
        const state = await meeting<Snapshot>({ action: 'poll', code: joinedCode })
        if (cancelled) return
        if (state.cursor < sharedStart || state.cursor > sharedEnd) throw new Error('对话进度无效')
        setSnapshot(state)
        setError('')
        if (state.ended) return
      } catch (failure) {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : '连接中断，正在重连')
      }
      timer = window.setTimeout(poll, 550)
    }
    void poll()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [joinedCode])

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'instant' })
  }, [cursor])

  useEffect(() => {
    function back(event: Event) { event.preventDefault(); leave() }
    window.addEventListener('reso-back', back)
    return () => window.removeEventListener('reso-back', back)
  }, [leave])

  async function connect() {
    setPending(true)
    setError('')
    try {
      const entered = code.trim()
      const state = await meeting<Snapshot>({ action: 'connect', code: entered })
      if (state.cursor < sharedStart || state.cursor > sharedEnd) throw new Error('对话进度无效')
      setSnapshot(state)
      setJoinedCode(entered)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法加入')
    } finally { setPending(false) }
  }

  async function send() {
    if (!canSend || error || pending || !draft.trim()) return
    if (!line || comparableLine(draft) !== comparableLine(line.text)) {
      setInputError('这句话暂时无法接续当前对话，请修改后再发送。')
      return
    }
    setPending(true)
    try {
      const reply = await meeting<Snapshot>({ action: 'send', code: joinedCode, cursor })
      if (!reply.accepted) throw new Error('这一轮已经结束，请等待下一轮发言。')
      setSent(cursor)
      setDraft('')
      setInputError('')
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    } catch (failure) {
      setInputError(failure instanceof Error ? failure.message : '暂时无法发送，请重试')
    } finally { setPending(false) }
  }

  return <div className="app roadshow" data-companion-cursor={cursor}>
    <header className="app-header roadshow-header">
      <button type="button" className="icon-button back" aria-label="返回" onClick={leave}><ChevronLeft/></button>
      <div className="roadshow-heading"><h1>{joinedCode ? '三方会谈' : '加入三方会谈'}</h1></div>
    </header>
    <main ref={scroll} className="conversation">
      <div className="conversation-content roadshow-stream">
        {!joinedCode ? <Card title="输入孩子发来的配对码">
          <p className="muted">请先将两部手机连到同一个 Wi-Fi。</p>
          <form onSubmit={event => { event.preventDefault(); if (code.trim() && !pending) void connect() }}>
            <label className="field-label">配对码<input value={code} onChange={event => setCode(event.target.value)} maxLength={46} autoComplete="off" autoCapitalize="none" spellCheck={false}/></label>
            <button type="submit" className="button primary" disabled={!code.trim() || pending}>{pending ? '连接中…' : '确认加入'}</button>
          </form>
        </Card> : <>
          <p className="roadshow-room">妈妈 · 孩子 · Reso</p>
          {turns.slice(sharedStart, cursor).flatMap((turn, index) => turn.effects.map((effect, order) => {
            if (effect.kind === 'reply') return <Bubble key={`${index}:${order}`}>{stages[turn.step].reply}</Bubble>
            if (effect.kind !== 'message') return null
            const speaker = effect.role === 'child' ? '孩子' : effect.role === 'mother' ? '妈妈' : 'Reso'
            return <Bubble key={`${index}:${order}`} role={effect.role === 'mother' ? 'user' : 'reso'}>
              <span className="speaker">{speaker}</span>{effect.text}
            </Bubble>
          }))}
          {snapshot?.ended && <p className="roadshow-room" role="status">本次会谈已结束</p>}
        </>}
        {error && <p className="roadshow-room" role="alert">{error}</p>}
      </div>
    </main>
    {canSend ? <form className="roadshow-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      {inputError && <p className="muted" role="alert">{inputError}</p>}
      <div className="roadshow-input-row">
        <textarea aria-label="消息" placeholder="输入消息…" rows={1} value={draft} maxLength={500}
          onChange={event => { setDraft(event.target.value); setInputError('') }} autoComplete="off" enterKeyHint="send"
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
            }
          }}/>
        <button type="submit" className="icon-button send-button" aria-label="发送消息" disabled={!!error || !draft.trim() || pending}><Send/></button>
      </div>
    </form> : joinedCode && !snapshot?.ended && <footer className="roadshow-locate"><p className="muted">等待会谈继续…</p></footer>}
  </div>
}

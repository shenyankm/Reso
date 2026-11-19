import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, CircleCheck, Cloud, Copy, FileText, HandHeart, Heart, Info, Link, LockKeyhole, MessageCircle, Mic, MoreHorizontal, Pause, Pencil, Plus, Search, Send, Shield, ShieldCheck, Sparkles, Sun, UsersRound, X } from 'lucide-react'
import { acts, answerLabels, chatMessages, parseScene, questions, scenes, teachers } from './demo'
import type { Message, Scene } from './demo'

const asset = (name: string) => `/assets/${name}.webp`
import {Button,Bubble,Dialog,Card} from './components'

export default function App() {
  const [scene, setScene] = useState<Scene>(() => parseScene(window.location.hash))
  const [sheet, setSheet] = useState<'scenes' | 'actions' | 'info' | 'voice' | 'privacy' | 'guardian' | 'edit' | 'resources' | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState<Partial<Record<Scene, Message[]>>>({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>(questions.map(() => null))
  const [finding, setFinding] = useState<'accepted' | 'rejected' | null>(null)
  const [act, setAct] = useState(0)
  const [paused, setPaused] = useState(false)
  const [storySaved, setStorySaved] = useState(false)
  const [corrections, setCorrections] = useState<Partial<Record<Scene, string>>>({})
  const [actCorrections, setActCorrections] = useState<Partial<Record<number, string>>>({})
  const [story, setStory] = useState('我不是那个“还差几分”的人，也是那个落下很多课，却始终没有放弃、一直点亮自己的小孩。妈妈的话可以让我难过，却不必决定我怎么看自己。\n\n现在，我也想对这样的自己说一句：“你做得不错。”')
  const [edit, setEdit] = useState('')
  const [eventName, setEventName] = useState('关于那次考试，我们聊聊')
  const [invited, setInvited] = useState(false)
  const [shareInvite, setShareInvite] = useState(false)
  const [joined, setJoined] = useState(false)
  const [confirmed, setConfirmed] = useState({ child: false, mom: false })
  const [teacherIndex, setTeacherIndex] = useState(1)
  const [bookingShare, setBookingShare] = useState<'none' | 'summary'>('none')
  const [booked, setBooked] = useState(false)
  const [tab, setTab] = useState<'events' | 'people'>('events')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [pending, setPending] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const currentScene = useRef(scene)
  currentScene.current = scene

  useEffect(() => { const fn = () => setScene(parseScene(window.location.hash)); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn) }, [])
  useEffect(() => { scroll.current?.scrollTo(0, 0); setDraft(''); setSheet(null) }, [scene])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function go(next: Scene) { if (next === scene) { setSheet(null); scroll.current?.scrollTo(0, 0) } else window.location.hash = next }
  function notify(text: string) { setToast(text) }
  function send(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || pending) return
    const target = scene
    setSent(prev => ({ ...prev, [target]: [...(prev[target] ?? []), { role: 'user', text }] }))
    setDraft(''); setPending(true)
    requestAnimationFrame(() => scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }))
    timer.current = setTimeout(() => {
      setSent(prev => ({ ...prev, [target]: [...(prev[target] ?? []), { role: 'reso', text: '我听到了。你愿意说说，这件事里最希望被理解的是什么吗？' }] }))
      setPending(false)
      if (currentScene.current === target) requestAnimationFrame(() => scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }))
    }, 700)
  }
  function editCurrent() { setEdit(scene === 'exercise' ? act === 5 ? story : actCorrections[act] ?? acts[act].caption : corrections[scene] ?? '我希望自己的努力能先被看见。'); setSheet('edit') }
  const isRoom = scene === 'room' || scene === 'perspectives'
  const isWelcome = scene === 'welcome'
  const isRelations = scene === 'relationships'
  const teacher = teachers[teacherIndex]
  const activeAct = acts[act]
  const status = isRoom ? `孩子 · 妈妈 · Reso　${joined ? '三人已加入' : '会谈预览'}` : scene === 'question' ? `初步了解 · 体验题 ${questionIndex + 1}/${questions.length}` : scene === 'exercise' ? `叙事小练习 · ${activeAct.chapter}` : scene === 'discovery' ? '初步了解 · 一个小发现' : scene === 'memory' ? '学习压力 · 事件记忆' : scene === 'safety' ? '你可以随时寻求支持' : '慢慢来，我在听'
  const backScene: Partial<Record<Scene, Scene>> = { chat: 'welcome', question: 'chat', discovery: 'question', tools: 'chat', exercise: 'tools', memory: storySaved ? 'relationships' : 'chat', invite: 'memory', room: 'invite', perspectives: 'room', music: 'chat', experts: 'chat', booking: 'experts', safety: 'chat' }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/#room`); notify('演示房间地址已复制，不包含私人聊天') }
    catch { notify('无法自动复制，请从浏览器地址栏复制房间地址') }
  }

  function content() {
    switch (scene) {
      case 'chat': return <>
        <p className="time-label">今天 · 从一件小事开始</p>
        {chatMessages.map((m, i) => <Bubble key={i} role={m.role}>{m.text}</Bubble>)}
        <img className="hug-sticker" src={asset('reso-hug')} alt="Reso 抱着爱心：抱抱你" />
        <div className="suggestions"><button onClick={() => go('question')}>想更了解自己 <Sparkles /></button>{act > 0 && <button onClick={() => { setPaused(false); go('exercise') }}>接着上次的小练习 <ArrowRight /></button>}<button onClick={() => go('tools')}>试试一个小练习 <ArrowRight /></button></div>
      </>
      case 'question': return <>
        <Bubble>我们可以用几个小问题，慢慢了解你。没有标准答案，选最接近你感受的就好。</Bubble>
        <Bubble role="user">好，那就试试看。</Bubble>
        <Card className="question-card">
          <div className="mini-row"><span>初步了解 · 体验题</span><span>{questionIndex + 1} / {questions.length}</span></div>
          <div className="progress"><span style={{ width: `${(questionIndex + 1) / questions.length * 100}%` }} /></div>
          <h2>{questions[questionIndex]}</h2>
          <fieldset className="answer-grid"><legend className="sr-only">选择最接近的感受</legend>{answerLabels.map((answer, i) => <label key={answer} className={answers[questionIndex] === i ? 'selected answer' : 'answer'}><input type="radio" name={`question-${questionIndex}`} checked={answers[questionIndex] === i} onChange={() => setAnswers(prev => prev.map((v, n) => n === questionIndex ? i : v))} /><span className="answer-number">{i + 1}</span><span>{answer}</span>{answers[questionIndex] === i && <Check size={15} />}</label>)}</fieldset>
          <div className="two-actions"><Button secondary disabled={questionIndex === 0} onClick={() => setQuestionIndex(i => i - 1)}>上一题</Button><Button disabled={answers[questionIndex] === null} onClick={() => questionIndex < questions.length - 1 ? setQuestionIndex(i => i + 1) : go('discovery')}>{questionIndex === questions.length - 1 ? '看看小发现' : '下一题'} <ArrowRight /></Button></div>
          <p className="fineprint">示例题卡，不计分</p>
        </Card>
        <button className="text-button centered" onClick={() => go('chat')}>先不回答，继续聊聊</button>
      </>
      case 'discovery': return <>
        <Bubble>看了你的回答，我有一个小发现，想和你一起看看，像不像你。</Bubble><Bubble role="user">嗯，你说说看。</Bubble>
        <Card className="discovery-card"><div className="discovery-head"><Sparkles /><h2>一个小发现<br /><span>学习上的两种感受</span></h2><p>来自你的回答，我们一起核对看看。</p></div>
          <div className="discovery-body"><div className="feeling"><span><Cloud />学习没做好时</span><strong>容易觉得自己不够好</strong></div><div className="feeling"><span><Sparkles />学习做得不错时</span><strong>开心和肯定却留不久</strong></div>
            <p className="tinted-note">你似乎更容易记住哪里没做好，<br />却不容易留住“我已经做到了”的感觉。</p>
            <div className="two-actions"><Button secondary onClick={() => { setFinding('rejected'); notify('已记录：这个发现不太像你') }}>不太像我</Button><Button onClick={() => setFinding('accepted')}>有点像我 <ArrowRight /></Button></div>
          </div>
        </Card>
        {finding && <><Bubble>{finding === 'accepted' ? '原来做错的那一点，会在你心里停留很久。最近有哪件事，让你又有了这种感觉？' : '谢谢你告诉我。我会放下这个猜测。你愿意用自己的话，说说更接近你的感受吗？'}</Bubble><Button secondary onClick={() => go('chat')}>回到聊天，慢慢说 <ArrowRight /></Button></>}
      </>
      case 'tools': return <>
        <Bubble>除了陪你聊天，我也可以陪你做一些小练习。不用急着解决什么，我们一次只看一点。</Bubble><Bubble role="user">那有哪些练习呢？</Bubble>
        <Bubble>想把心里的话说清楚、换个角度看那一幕，或重新看见自己的努力，都可以。什么时候开始、什么时候停下，由你决定。</Bubble>
        <div className="section-heading"><h2>选一个感兴趣的小练习</h2><span>左右滑动</span></div>
        <div className="exercise-carousel">
          {[{ title: '把这段经历画出来', sub: '叙事小练习', image: 'story-5' }, { title: '把那一幕演出来', sub: '情境小剧场', image: 'story-1' }, { title: '说出感受，听见需要', sub: '非暴力沟通', image: 'story-2' }].map((item, i) => <article className={`exercise-preview variant-${i}`} key={item.title}><img src={asset(item.image)} alt="原稿中的温暖手绘练习插画" /><div className="exercise-preview-body"><span className="muted">{item.sub}</span><h3>{item.title}</h3><p>一次只看一点，随时可以停下。</p><Button onClick={() => { if (i !== 0) { notify('这项练习暂为卡片预览，可体验左侧的叙事五幕'); return } setPaused(false); go('exercise') }}>{i === 0 ? act > 0 ? '接着上次的练习' : '开始看看' : '查看练习说明'} <ArrowRight /></Button></div></article>)}
        </div><Button secondary onClick={() => go('chat')}>先继续聊聊</Button>
      </>
      case 'exercise': return <>
        <div className="act-progress" aria-label={`练习进度：${activeAct.chapter}`}>{acts.slice(1).map((item, i) => <button key={item.title} className={i + 1 === act ? 'current' : i + 1 < act ? 'done' : ''} aria-label={`查看${item.chapter}：${item.title}`} aria-current={i + 1 === act ? 'step' : undefined} onClick={() => { setAct(i + 1); setPaused(false) }}>{i + 1}</button>)}</div>
        <Bubble>{activeAct.prompt}</Bubble>
        {act === 1 && <Bubble role="user">其实挺开心的。落下那么多功课，这次终于有进步了。</Bubble>}
        <section className="story-card"><div className="story-title"><span>{activeAct.chapter}</span><h2>{activeAct.title}</h2></div><img className="story-art" src={asset(activeAct.image)} alt={activeAct.caption} /><div className="story-body"><p>{actCorrections[act] ?? activeAct.caption}</p>{act === 5 && <p className="saved-story">{story}</p>}<p className="muted">{activeAct.question}</p>
          {paused ? <><p className="pause-notice"><Pause /> 已暂停，这一幕会为你保留。</p><Button onClick={() => setPaused(false)}>接着看看 <ArrowRight /></Button></> : <div className="two-actions"><Button secondary onClick={editCurrent}>我想修改</Button><Button onClick={() => { if (act < 5) { setAct(a => a + 1); scroll.current?.scrollTo(0, 0) } else { setStorySaved(true); notify('故事已保存在本次演示中，仅自己可见'); go('memory') } }}>{act === 0 ? '开始第一幕' : act === 5 ? '保存我的故事' : '有点像我，继续'} <ArrowRight /></Button></div>}
        </div></section>
        <div className="practice-controls"><button onClick={() => setAct(a => Math.max(0, a - 1))} disabled={act === 0}><ChevronLeft /> 上一幕</button><button onClick={() => setPaused(true)} disabled={paused}><Pause /> 暂停一下</button><button onClick={() => { setPaused(true); go('chat') }}>下次接着聊</button></div>
      </>
      case 'memory': return <>
        <Bubble>你之前说过，妈妈那句“就差几分”，让你觉得自己的努力没有被看见。我整理了这件事，想和你一起核对一下。</Bubble><Bubble role="user">好，我想看看有什么变化。</Bubble>
        <Card title="事件记忆 · 与妈妈的沟通" icon={<FileText />} className="memory-card"><div className="mini-row"><span>持续记录中</span><span className="private-tag"><LockKeyhole /> 仅自己可见</span></div><h3>我们记住的这件事</h3><dl className="memory-facts"><div><dt>发生了什么</dt><dd>妈妈说“就差几分”。</dd></div><div><dt>我真正希望</dt><dd>{corrections.memory ?? '自己的努力能够被看见。'}</dd></div></dl><h3>这件事的进展</h3><ol className="timeline"><li><CircleCheck /><span>说清了为什么会委屈</span></li><li><CircleCheck /><span>区分妈妈的话和自己的理解</span></li><li><span className="timeline-dot" /><span>{storySaved ? '保存了属于自己的故事' : '开始思考怎样表达需要'}</span></li></ol>
          <div className="understanding"><h3><Sparkles /> 一个正在发生的变化</h3><div><p><Cloud /> 之前的理解<strong>“她完全不认可我”</strong></p><ArrowRight /><p><Sun /> 现在开始想到<strong>“我的努力也值得被看见”</strong></p></div></div>
          {storySaved && <details className="story-details"><summary>看看我的故事</summary><p>{story}</p></details>}
          <div className="two-actions"><Button secondary onClick={editCurrent}><Pencil /> 纠正记录</Button><Button onClick={() => go('invite')}>试着表达 <ArrowRight /></Button></div>
        </Card><Bubble>即使有了新的理解，也不代表委屈会立刻消失。我们可以慢慢来。</Bubble>
      </>
      case 'invite': return <>
        <Bubble>如果妈妈愿意认真听你说，你最想让她知道什么？</Bubble><Bubble role="user">我只是希望她能先看看我已经努力了多少。</Bubble><Bubble>这句话很重要。邀请之前，我们先确认你想分享的内容。</Bubble>
        <Card title="邀请妈妈，一起聊聊" icon={<UsersRound />}><label className="field-label" htmlFor="event-name">想聊的这件事</label><div className="editable-input"><input id="event-name" value={eventName} maxLength={40} onChange={e => setEventName(e.target.value)} /><Pencil /></div><label className="check-row share-checkbox"><input type="checkbox" checked={shareInvite} onChange={e => setShareInvite(e.target.checked)} /><span>分享这件事的摘要<small>“我希望在谈成绩前，先看见我的努力。”</small></span></label>
          {invited ? <div className="invitation-state"><CircleCheck /><strong>演示邀请已生成 · 等待加入</strong><p>尚未向任何人发送。你可以预览妈妈加入后的界面。</p><div className="two-actions"><Button secondary onClick={() => { setInvited(false); notify('演示邀请已取消') }}>取消邀请</Button><Button onClick={() => { setJoined(true); go('room') }}>预览三人会谈 <ArrowRight /></Button></div></div> : <><div className="invite-methods"><button onClick={() => notify('确认名称与分享范围后，即可生成演示链接')}><Link /> 生成链接</button><button onClick={() => { setSheet('info') }}><MessageCircle /> 微信邀请</button></div><div className="two-actions"><Button secondary onClick={() => go('chat')}>先不邀请</Button><Button disabled={!eventName.trim()} onClick={() => setInvited(true)}>确认并生成邀请 <ArrowRight /></Button></div></>}
          {invited && <button className="text-button centered" onClick={copyInvite}><Copy /> 复制演示房间地址</button>}
        </Card>
      </>
      case 'room': return <>
        <div className="room-notice"><UsersRound /> 三方会谈界面预览 · 自由发言</div><Bubble>你们都来了。今天我们先不急着判断谁对谁错，先说说各自当时的感受，好吗？</Bubble><Bubble role="user">好。</Bubble><Bubble>那你先和妈妈说说，听到“就差几分”的时候，你心里发生了什么？</Bubble><Bubble role="user">妈妈，那天其实我挺开心。我努力补了那么多课，好不容易才有一点进步。可你那句话一出来，我一下觉得之前的努力都不算数了。</Bubble><Bubble>你希望她知道的，不只是那几分，是你真的有在努力。妈妈，你听到孩子这样说，会想到什么？</Bubble><Bubble role="mom">我只顾着看那几分，忘了先问问你那天是什么心情。</Bubble><Bubble>我们可以分别核对一下：彼此听见的，和真正想表达的，是不是同一件事。</Bubble><Button onClick={() => go('perspectives')}>看看两种感受 <ArrowRight /></Button>
      </>
      case 'perspectives': return <>
        <Bubble>同一件事，心里的感受可能很不一样。我们把它们放在一起看看，不急着得出同一个答案。</Bubble>
        <Card title="同一件事，两种感受" icon={<UsersRound />}><div className="perspective-columns"><div className="child-perspective"><span>孩子这边</span><h3>{corrections.perspectives ?? '“希望先看见我的努力”'}</h3><p>分数之外，也想让认真和坚持被认可。</p><button className="confirm-button" aria-pressed={confirmed.child} onClick={() => setConfirmed(p => ({ ...p, child: !p.child }))}>{confirmed.child ? <><Check /> 孩子已确认</> : '确认我的感受'}</button></div><div className="mom-perspective"><span>妈妈这边</span><h3>“我可能太关注结果了”</h3><p>这是示例中的一种理解，仍需妈妈本人核对。</p><button className="confirm-button" aria-pressed={confirmed.mom} onClick={() => setConfirmed(p => ({ ...p, mom: !p.mom }))}>{confirmed.mom ? <><Check /> 妈妈已确认</> : '预览妈妈确认'}</button></div></div><div className="consensus"><Heart /><p>{confirmed.child && confirmed.mom ? '双方均已核对各自感受。是否形成共同约定，还可以接着聊。' : '可以各自确认，也可以不同意。单方确认不会显示为双方共识。'}</p></div><Button secondary onClick={editCurrent}>我想修改这份理解</Button></Card><Button onClick={() => go('experts')}>了解更多支持 <ArrowRight /></Button>
      </>
      case 'music': return <>
        <Bubble role="user">最近有点疲惫，想听一首熟悉的歌。</Bubble><Bubble>那我们先停一停。听歌的时候，不用急着想出一个答案。</Bubble><Card className="music-card"><div className="album-art"><Sun /><span>晴天</span><span className="album-small">陪你慢一点</span></div><div className="music-details"><div><h2>晴天</h2><p>周杰伦</p></div><button className={`icon-button ${favorite ? 'favorited' : ''}`} aria-label={favorite ? '取消收藏' : '收藏歌曲'} aria-pressed={favorite} onClick={() => setFavorite(v => !v)}><Heart fill={favorite ? 'currentColor' : 'none'} /></button></div><a className="button primary" href="https://y.qq.com/" target="_blank" rel="noreferrer">去 QQ 音乐听听 <ArrowRight /></a><p className="fineprint">在外部音乐平台搜索播放</p></Card><Button secondary onClick={() => go('chat')}>听完再聊聊</Button>
      </>
      case 'experts': return <>
        <Bubble>如果你愿意，也可以和真人咨询师聊聊。你可以先了解不同的支持方式，再决定下一步。</Bubble><Bubble role="user">我现在更适合哪一种？</Bubble><div className="section-heading"><h2>看看不同的支持方式</h2><span>演示资料</span></div>
        <div className="teacher-switch"><button className="icon-button" aria-label="上一位老师" onClick={() => setTeacherIndex(i => (i + teachers.length - 1) % teachers.length)}><ChevronLeft /></button><span>{teacherIndex + 1} / {teachers.length}</span><button className="icon-button" aria-label="下一位老师" onClick={() => setTeacherIndex(i => (i + 1) % teachers.length)}><ChevronRight /></button></div><article className="teacher-card"><div className="teacher-photo"><img src={asset(teacher.image)} alt={`${teacher.name}的原稿示例头像`} /><span>示例人物</span></div><div className="teacher-body"><div className="teacher-name"><h2>{teacher.name}</h2><span>{teacher.tag}</span></div><p className="teacher-method">{teacher.method}</p><h3>可以怎样陪你？</h3><p>{teacher.reason}</p><Button onClick={() => { setBooked(false); go('booking') }}>了解{teacher.name}的服务 <ArrowRight /></Button></div></article><p className="fineprint">示例资料，非真实咨询服务</p>
      </>
      case 'booking': return <>
        <Bubble>联系老师前，你可以选择要不要分享这件事。即使不分享聊天内容，也可以提出咨询申请。</Bubble><Card title="确认分享与咨询申请" icon={<ShieldCheck />}><div className="booking-teacher"><img src={asset(teacher.image)} alt="示例老师头像" /><div><strong>{teacher.name}</strong><span>{teacher.method} · 演示资料</span></div></div><fieldset className="share-options" disabled={booked}><legend>你愿意分享什么？</legend><label className={bookingShare === 'none' ? 'selected' : ''}><input type="radio" name="share" checked={bookingShare === 'none'} onChange={() => setBookingShare('none')} /><span>不分享聊天内容<small>由我亲自和老师说</small></span></label><label className={bookingShare === 'summary' ? 'selected' : ''}><input type="radio" name="share" checked={bookingShare === 'summary'} onChange={() => setBookingShare('summary')} /><span>只分享这件事的摘要<small>与妈妈的沟通 · 不含私人聊天原文</small></span></label></fieldset>{booked ? <div className="invitation-state"><CircleCheck /><h3>演示申请已记录</h3><p>等待处理，不代表已接单或预约成功。未向真人老师提交申请。</p><Button secondary onClick={() => { setBooked(false); notify('演示申请已取消') }}>取消演示申请</Button></div> : <Button onClick={() => setBooked(true)}>确认并预览申请状态 <ArrowRight /></Button>}<p className="fineprint"><LockKeyhole /> 仅分享选中摘要</p></Card>
      </>
      case 'safety': return <>
        <Bubble>有些时候，你可能很难受，也不知道该从哪里说起。我们可以先不急着梳理，先让你得到合适的支持。</Bubble><Card title="先让自己安全下来" icon={<Shield />} className="safety-card"><p>找一个让你感觉更安全的地方，尽量让可信任的人陪在身边。</p><div className="safety-notice">如果正处于即时危险，请优先联系当地紧急服务或身边可信任的成年人。</div><h3>你可以找谁一起面对？</h3><button className="support-row" onClick={() => setSheet('resources')}><UsersRound /><span>家人、老师或校园心理老师</span><ChevronRight /></button><button className="support-row" onClick={() => go('experts')}><HandHeart /><span>专业咨询与人工支持</span><ChevronRight /></button><p className="fineprint">Reso 提供支持与沟通辅助，不能替代紧急救助。</p><div className="two-actions"><Button secondary onClick={() => go('chat')}>暂时继续聊</Button><Button onClick={() => setSheet('resources')}>查看求助方式 <ArrowRight /></Button></div></Card>
      </>
      default: return null
    }
  }

  return <>
    <div className={`app ${isWelcome ? 'welcome-app' : ''}`}>
      {isWelcome ? <main className="welcome-scroll">
        <div className="preview-entry"><a className="text-button" href="/?roadshow=1">体验 Reso</a><button className="preview-label" onClick={() => setSheet('scenes')}>界面预览 <MoreHorizontal size={16} /></button></div>
        <section className="welcome-hero"><div className="welcome-copy"><h1>你好，<br />我是 Reso</h1><h2>AI 关系理解与沟通引导者</h2><p>我们可以从一件你在意的小事开始，<br />慢慢理清发生了什么。</p></div><img src={asset('reso-welcome')} alt="Reso 抱着爱心，向你招手" /></section>
        <section className="privacy-highlight"><div className="feature-icon blue"><ShieldCheck /></div><div><p>先让你安心</p><h2>你的对话默认私密</h2><span>你的信息只在获得授权的范围内使用。</span></div><Sparkles className="tiny-sparkle" /></section>
        <section className="welcome-promises">{[{ icon: <UsersRound />, title: '分享内容由你决定', text: '你可以选择分享什么，也可以随时停止。', color: 'purple' }, { icon: <HandHeart />, title: '聊什么、说多少，按你的节奏来', text: '慢慢来，随时都可以暂停。', color: 'green' }, { icon: <MessageCircle />, title: '有些事，也可以和咨询师聊聊', text: '如果你愿意，我们可以一起了解专业支持。', color: 'pink' }].map(item => <div className="promise" key={item.title}><div className={`feature-icon ${item.color}`}>{item.icon}</div><div><h2>{item.title}</h2><p>{item.text}</p></div></div>)}</section>
        <div className="welcome-actions"><label className="check-row"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} /><span>我已阅读并了解 <button className="inline-link" type="button" onClick={() => setSheet('privacy')}>用户协议与隐私说明</button></span></label><Button disabled={!agreed} onClick={() => go('chat')}>开始聊聊 <ArrowRight /></Button><button className="guardian-link" onClick={() => setSheet('guardian')}>未满18岁？了解监护人协助 <ChevronRight /></button><p className="fineprint">UI 体验版 · 对话与操作仅作演示</p></div>
      </main> : <>
        <header className={`app-header ${isRelations ? 'relations-header' : ''}`}>
          {!isRelations && <button className="icon-button back" aria-label="返回" onClick={() => go(backScene[scene] ?? 'chat')}><ChevronLeft /></button>}
          <img className="header-mascot" src={asset('reso-avatar')} alt="" />
          <div className="header-name">{isRelations ? <h1>我的关系</h1> : isRoom ? <h1>{eventName}</h1> : <h1>Reso</h1>}{!isRelations && <span><i /> {isRoom ? '自由沟通 · 界面预览' : '陪你聊聊 · 界面预览'}</span>}</div>
          <button className="icon-button more" aria-label={isRelations ? '记录一件小事' : '打开预览场景'} onClick={() => isRelations ? go('chat') : setSheet('scenes')}>{isRelations ? <Plus /> : <MoreHorizontal />}</button>
        </header>
        {isRelations ? <main className="relations-screen">
          <div className="search-field"><Search /><input aria-label="搜索重要的人、聊过的事" placeholder="搜索重要的人、聊过的事" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="tabs" role="tablist" aria-label="关系分类"><button role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>一件小事</button><button role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>重要的人</button></div>
          {storySaved && (tab === 'events' ? `与妈妈的沟通${story}` : '妈妈').includes(search) ? <button className="saved-event" onClick={() => go('memory')}><FileText /><div><strong>{tab === 'events' ? '与妈妈的沟通' : '妈妈'}</strong><p>{tab === 'events' ? '希望我的努力先被看见' : '相关事件 · 与妈妈的沟通'}</p><span><LockKeyhole /> 仅自己可见</span></div><ChevronRight /></button> : <section className="empty-state"><img src={asset('reso-empty')} alt="Reso 安静地抱着一颗心" /><h2>{search ? '暂时没有找到' : tab === 'events' ? '还没有记录的小事' : '重要的人，会慢慢出现'}</h2><p>{search ? '试试其它关键词，或从聊天开始。' : <>有些事，可以先从聊一聊开始。<br />说多少、什么时候说，都由你决定。</>}</p><Button onClick={() => go('chat')}>和 Reso 聊聊 <ArrowRight /></Button><span>以后聊过的事，会在这里慢慢出现。</span></section>}
        </main> : <>
          <div className="conversation-status"><i />{status}{scene === 'question' && <div className="status-progress"><span style={{ width: `${(questionIndex + 1) / questions.length * 100}%` }} /></div>}</div>
          <main ref={scroll} className="conversation" id="conversation"><div className="conversation-content">{content()}{corrections[scene] && !['exercise', 'memory', 'perspectives'].includes(scene) && <Card title="以你的表达为准" icon={<Pencil />}><p>{corrections[scene]}</p></Card>}{(sent[scene] ?? []).map((m, i) => <Bubble key={`sent-${i}`} role={m.role}>{m.text}</Bubble>)}{pending && <div className="typing" role="status">Reso 正在回应<span>···</span></div>}</div></main>
          <form className="composer" onSubmit={send}><div className="composer-field"><input aria-label="发送给 Reso 的消息" placeholder="也可以直接告诉我…" value={draft} maxLength={2000} onChange={e => setDraft(e.target.value)} /><button type={draft.trim() ? 'submit' : 'button'} className={`icon-button ${draft.trim() ? 'send-button' : ''}`} aria-label={draft.trim() ? '发送消息' : '打开聊天工具'} disabled={pending && !!draft.trim()} onClick={() => { if (!draft.trim()) setSheet('actions') }}>{draft.trim() ? <Send /> : <Plus />}</button></div><button type="button" className="icon-button mic-button" aria-label="语音输入预览" onClick={() => setSheet('voice')}><Mic /></button></form>
        </>}
        <nav className="bottom-nav" aria-label="主导航"><button className={!isRelations ? 'active' : ''} aria-current={!isRelations ? 'page' : undefined} onClick={() => go('chat')}><Sparkles /><span>Reso</span></button><button className={isRelations ? 'active' : ''} aria-current={isRelations ? 'page' : undefined} onClick={() => go('relationships')}><UsersRound /><span>我的关系</span></button></nav>
      </>}
      {toast && <div className="toast" role="status"><CircleCheck />{toast}</div>}
    </div>
    {sheet && <Dialog title={sheet === 'scenes' ? '预览场景' : sheet === 'actions' ? '想从哪里开始？' : sheet === 'edit' ? '用你的话修改' : sheet === 'voice' ? '语音输入' : sheet === 'privacy' ? '用户协议与隐私说明' : sheet === 'guardian' ? '关于监护人协助' : sheet === 'resources' ? '找一个人，陪你一起面对' : '关于这次界面预览'} onClose={() => setSheet(null)}>
      {sheet === 'scenes' && <><p className="dialog-description">切换查看主要页面与卡片状态。</p><div className="scene-list">{scenes.map(item => <button key={item.id} aria-current={scene === item.id ? 'page' : undefined} onClick={() => go(item.id)}><span>{item.label}</span>{scene === item.id ? <Check /> : <ChevronRight />}</button>)}</div><button className="text-button centered" onClick={() => setSheet('info')}><Info /> 关于这次预览</button></>}
      {sheet === 'actions' && <div className="tools-grid">{[{ id: 'question' as Scene, title: '初步了解', icon: <Sparkles /> }, { id: 'tools' as Scene, title: '心理学练习', icon: <Heart /> }, { id: 'memory' as Scene, title: '事件记忆', icon: <FileText /> }, { id: 'invite' as Scene, title: '邀请一起聊', icon: <UsersRound /> }, { id: 'experts' as Scene, title: '真人支持', icon: <HandHeart /> }, { id: 'safety' as Scene, title: '安全与求助', icon: <ShieldCheck /> }].map(item => <button key={item.id} onClick={() => go(item.id)}>{item.icon}<span>{item.title}</span></button>)}</div>}
      {sheet === 'edit' && <><label className="field-label" htmlFor="correction">你想怎样描述？</label><textarea id="correction" rows={6} value={edit} maxLength={2000} onChange={e => setEdit(e.target.value)} /><Button disabled={!edit.trim()} onClick={() => { if (scene === 'exercise') { if (act === 5) setStory(edit.trim()); else setActCorrections(prev => ({ ...prev, [act]: edit.trim() })) } else { setCorrections(prev => ({ ...prev, [scene]: edit.trim() })); if (scene === 'perspectives') setConfirmed({ child: false, mom: false }) } setSheet(null); notify('已保留你的修改，后续以你的表达为准') }}>确认修改 <Check /></Button></>}
      {sheet === 'voice' && <div className="voice-preview"><Mic /><h3>把想说的话，慢慢说出来</h3><p>此版本仅预览录音入口。正式接入豆包语音转写后，你可以修改识别文字，再确认发送。</p><Button onClick={() => { setDraft('我想慢慢说说最近发生的事。'); setSheet(null); notify('已填入演示文字，请确认后发送') }}>试试转写文字预览</Button><p className="fineprint">语音流程演示，不录音</p></div>}
      {sheet === 'privacy' && <div className="prose"><p>这是界面演示说明，不是正式法律协议。</p><p>本次体验使用预设示例，不接入模型或业务服务。输入内容仅保存在当前页面内存，刷新后清除；请使用演示文字。</p><p>正式产品的年龄、监护同意、数据删除与保留政策需要另行审核和上线。</p><Button onClick={() => { setAgreed(true); setSheet(null) }}>了解，返回体验</Button></div>}
      {sheet === 'guardian' && <div className="prose"><p>你可以选择是否与家长分享某件事，私人对话不会因为邀请而自动共享。</p><p>未成年人使用所需的监护同意与具体规则，将依据上线地区和专业审核确定。</p><Button onClick={() => setSheet(null)}>我知道了</Button></div>}
      {sheet === 'resources' && <div className="prose"><p>可以先联系一位你信任的家人、老师或校园心理老师，让对方陪着你。</p><p>你可以这样开口：“我现在有点难受，不想一个人待着。你能陪我一会儿吗？”</p><p>如果正处于即时危险，请联系当地紧急服务。本演示没有真实人工值守，不显示未经核实的求助电话。</p><Button onClick={() => setSheet(null)}>回到对话</Button></div>}
      {sheet === 'info' && <div className="prose"><p>Reso 移动端 UI 体验版，按现有 V2.1 原稿复刻。</p><p>对话为预设演示，问卷不计分；邀请、分享及咨询申请不会向任何人实际发送。当前页面中的修改刷新后清除。</p><p>尚未接入 DeepSeek、豆包语音、登录和服务端。视频不在当前范围内。</p><Button onClick={() => setSheet(null)}>继续体验</Button></div>}
    </Dialog>}
  </>
}

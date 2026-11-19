import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Check, FileText, Heart, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { Button, Card, Dialog } from '../components'
import { acts, teachers } from '../demo'
import { scqaItems } from '../../shared/scqa'
import script from './script.json'

export const examName = '关于那次考试，我们聊聊'
export const storyText = '妈妈的话可以让我难过，却不必决定我怎么看自己。\n我不只是那个“还差几分”的人，也是那个落下很多、却始终没有放弃，一点点追上来的人。\n那份进步和开心都是真的。\n现在，我也想对这样的自己说一句：“你做得不错。”'
export const storyImage = '/assets/story-5.webp'

const storyCards = {
  ACT_1: { image: acts[1].image, copy: '看到成绩时，我其实挺开心。可听到「就差几分」后，我一下觉得之前的努力都不算数了。', confirm: '有点像当时的我', action: 'act1.confirm' },
  ACT_2: { image: acts[2].image, copy: '妈妈说的是「就差几分」。我心里听到的是「我怎么努力都不够好」。这两句话可以分开看。', confirm: '有点像我', action: 'act2.confirm' },
  ACT_3: { image: acts[3].image, copy: '每天晚上补以前的题，有些题做三四遍才会。没有放弃的时刻，也是故事的一部分。', confirm: '这确实是我做的', action: 'act3.confirm' },
  ACT_4: { image: acts[5].image, confirm: '保存我的故事', action: 'story.save' },
}

const earlierRecords = [
  ['第一次', '说清了当时为什么委屈'],
  ['第二次', '区分妈妈的话和自己的理解'],
  ['今天', '开始思考怎样表达需要'],
]

export const examTimeline = [
  ['第一次 · 理解自己的委屈', '努力没有被看见。', '私有记录'],
  ['第二次 · 重新理解自己', '一次成绩无法决定个人价值。', '私有记录'],
  ['第三次 · 理解彼此', '孩子表达委屈，妈妈表达自己的懊恼。', '授权共享内容'],
  ['新的尝试 · 换一种方式沟通', '妈妈先表达关心，孩子说希望先看见自己的努力。', '授权共享内容'],
]

export function ExamTimeline() {
  return <ol className="timeline roadshow-timeline">{examTimeline.map(([title, text, scope]) =>
    <li key={title}><span className="timeline-dot"/><div><strong>{title}</strong><p>{text}</p><small>{scope}</small></div></li>
  )}</ol>
}

export function TwoViews() {
  return <div className="perspective-columns">
    <div className="child-perspective"><strong>孩子</strong><p>我希望妈妈先看见我的努力。</p></div>
    <div className="mom-perspective"><strong>妈妈</strong><p>我其实是在怪自己。</p></div>
  </div>
}

export function Questionnaire({ active, onComplete }: { active: boolean; onComplete: () => void }) {
  const [question, setQuestion] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [about, setAbout] = useState(false)
  const count = scqaItems.length
  return <Card className="question-card">
    <div className="mini-row"><strong>SCQA · 演示问卷</strong><span>{active ? question + 1 : count} / {count}</span></div>
    <progress className="roadshow-progress" max={count} value={active ? question + 1 : count} aria-label="问卷进度"/>
    {active ? <>
      <h2>{question === 1 ? script.example : scqaItems[question]}</h2>
      <fieldset className="answer-grid"><legend className="sr-only">选择符合程度</legend>{script.options.map((option, index) =>
        <label key={option} className={answers[question] === index + 1 ? 'answer selected' : 'answer'}>
          <input type="radio" name="roadshow-answer" checked={answers[question] === index + 1}
            onChange={() => setAnswers(current => {
              const revised = [...current]
              revised[question] = index + 1
              return revised
            })}/>
          <span className="answer-number">{index + 1}</span><span>{option}</span>
        </label>
      )}</fieldset>
      <div className="two-actions">
        <Button secondary disabled={question === 0} onClick={() => setQuestion(question - 1)}>上一题</Button>
        <Button disabled={!answers[question]} onClick={() => question < count - 1 ? setQuestion(question + 1) : onComplete()}>
          {question < count - 1 ? '下一题' : '完成问卷'} <ArrowRight/>
        </Button>
      </div>
      <button type="button" className="text-button" aria-expanded={about} onClick={() => setAbout(!about)}>了解问卷</button>
      {about && <p className="muted">问卷使用研究参考题本，发现卡采用预设结果。本次回答仅用于演示。</p>}
    </> : <p className="roadshow-status"><Check size={18}/> 问卷已完成 · {count} / {count}</p>}
  </Card>
}

export function RoadshowCard({ id, action, advance, pause, roomName, story, onStoryChange }: {
  id: keyof typeof script.cards
  action: string
  advance: (action: string) => void
  pause: (reason: string) => void
  roomName: string
  story: string
  onStoryChange: (story: string) => void
}) {
  const [editingStory, setEditingStory] = useState(false)
  const carousel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const strip = carousel.current
    const selected = strip?.querySelector<HTMLButtonElement>('button')
    if (strip && selected) strip.scrollLeft = selected.offsetLeft - (strip.clientWidth - selected.clientWidth) / 2
  }, [])

  if (id in storyCards) {
    const item = storyCards[id as keyof typeof storyCards]
    const isFinal = !('copy' in item)
    return <section className="story-card"><div className="story-title"><h2>{script.cards[id]}</h2></div>
      <img className="story-art" src={`/assets/${item.image}.webp`} alt={script.cards[id]}/>
      <div className="story-body">{editingStory
        ? <label className="field-label">修改故事<textarea className="mvp-textarea" value={story} maxLength={1200}
            onChange={event => onStoryChange(event.target.value)}/></label>
        : <p className="roadshow-story">{isFinal ? story : item.copy}</p>}
        {action === item.action && <div className="two-actions">
        <Button secondary onClick={() => isFinal ? setEditingStory(!editingStory) : pause('你选择先核对这张卡。恢复后可从这里继续。')}>
          {editingStory ? '预览修改' : '我想修改'}
        </Button>
        <Button disabled={editingStory || (isFinal && !story.trim())} onClick={() => advance(item.action)}>{item.confirm}<ArrowRight/></Button>
      </div>}</div></section>
  }
  switch (id) {
    case 'SCQA':
      return <Questionnaire active={action === 'scqa.complete'} onComplete={() => advance('scqa.complete')}/>
    case 'DISCOVERY':
      return <Card title="一个小发现" icon={<Sparkles/>} className="discovery-card">
        <h3>学习上的两种感受</h3>
        <div className="feeling"><span>学习没做好时</span><strong>容易觉得自己不够好</strong></div>
        <div className="feeling"><span>学习做得不错时</span><strong>开心和肯定却留不久</strong></div>
        {action === 'discovery.like' && <div className="two-actions">
          <Button secondary onClick={() => pause('你选择「不太像我」。这次演示停在发现卡。')}>不太像我</Button>
          <Button onClick={() => advance('discovery.like')}>有点像我<ArrowRight/></Button>
        </div>}
      </Card>
    case 'NARRATIVE_OPTIONS':
      return <Card title={script.cards[id]} icon={<Heart/>}><div className="roadshow-methods" ref={carousel} aria-label="左右浏览练习">
        <div><img src="/assets/story-1.webp" alt=""/><p>情境小剧场</p></div>
        <button type="button" disabled={action !== 'narrative.focus'} onClick={() => advance('narrative.focus')}>
          <img src={storyImage} alt=""/><strong>叙事小练习</strong>
        </button>
        <div><img src="/assets/story-2.webp" alt=""/><p>非暴力沟通</p></div>
      </div></Card>
    case 'NARRATIVE_OFFER':
      return <Card title={script.cards[id]} icon={<Heart/>}>
        <img className="story-art" src={storyImage} alt="把这段经历画出来"/>
        <p>一次只看一点，随时可以停下。</p>
        {action === 'narrative.start' && <div className="two-actions">
          <Button secondary onClick={() => pause('你选择稍后开始叙事练习。')}>暂时不做</Button>
          <Button onClick={() => advance('narrative.start')}>开始看看<ArrowRight/></Button>
        </div>}
      </Card>
    case 'EVENT_MEMORY':
      return <Card title={script.cards[id]} icon={<FileText/>}><p className="roadshow-private">仅自己可见</p>
        <p>我们聊过 3 次 · 演示记录</p>
        <dl className="roadshow-facts">
          <div><dt>发生了什么</dt><dd>妈妈说「就差几分」。</dd></div>
          <div><dt>我真正希望</dt><dd>自己的努力能够被看见。</dd></div>
        </dl>
        <h3>这件事的进展</h3>
        <ol className="timeline roadshow-timeline">{earlierRecords.map(([title, copy]) =>
          <li key={title}><span className="timeline-dot"/><div><strong>{title}</strong><p>{copy}</p></div></li>
        )}</ol>
        <div className="understanding"><h3>一个正在发生的变化</h3><div>
          <p>之前的理解<strong>“她完全不认可我”</strong></p><ArrowRight/>
          <p>现在开始想到<strong>“她可能在担心成绩，但我也需要被看见”</strong></p>
        </div></div>
        <p>仍想探索：怎样让妈妈听见我的感受和需要？</p>
        {action === 'memory.continue' && <div className="two-actions">
          <Button secondary onClick={() => pause('你选择先纠正事件记录。')}>纠正记录</Button>
          <Button onClick={() => advance('memory.continue')}>继续聊这件事<ArrowRight/></Button>
        </div>}
      </Card>
    case 'INVITE_MOM':
      return <Card title={script.cards[id]} icon={<UsersRound/>}><p>{roomName}</p><p className="muted">本次邀请、加入与分享均为模拟。</p></Card>
    case 'DUAL_VIEW':
      return <Card title={script.cards[id]} icon={<UsersRound/>}><p>「就差一点，太可惜了。」</p><TwoViews/></Card>
    case 'NVC':
      return <Card title={script.nvc.heading} icon={<Heart/>}><h3>{script.nvc.title}</h3>
        <p>原来的表达　{script.nvc.original}</p>
        <dl className="roadshow-facts">{(['观察', '感受', '需要', '请求'] as const).map(label =>
          <div key={label}><dt>{label}</dt><dd>{script.nvc[label]}</dd></div>
        )}</dl>
        {action === 'nvc.start' && <Button onClick={() => advance('nvc.start')}>{script.nvc.button}<ArrowRight/></Button>}
      </Card>
    case 'EXPERTS':
      return <ExpertCards active={action === 'experts.select_lin'} select={() => advance('experts.select_lin')}/>
    case 'BOOKING':
      return <Card title={script.cards[id]} icon={<ShieldCheck/>}><p>林老师 · CBT 为主，兼顾亲子沟通</p></Card>
    default:
      return null
  }
}

const expertProfiles = [
  {
    image: 'teacher-zhou-profile', tag: '情绪支持', title: '什么时候更适合你？',
    points: [['情绪很满时，', '先被听见，再慢慢表达。'], ['通过支持性倾听，', '梳理感受和需要。'], ['自责反复出现时，', '也可以进一步梳理想法和行动。']],
  },
  {
    image: 'teacher-lin', tag: '优先了解', title: '为什么更适合你现在？',
    points: [['先接住“努力没被看见”的委屈，', '不急着纠正感受。'], ['用 CBT 分清：', '妈妈的话、事实与自我评价。'], ['再练习告诉妈妈：', '“希望你先看到我的努力。”']],
  },
  {
    image: 'teacher-zhang-profile', tag: '学习行动', title: '什么时候更适合你？',
    points: [['情绪较稳定时，', '聚焦具体学习问题。'], ['用短程 CBT，', '拆开困难，定一个小目标。'], ['亲子之间的委屈还很强烈时，', '可以先聊感受，再谈提分。']],
  },
] as const

function ExpertCards({ active, select }: { active: boolean; select: () => void }) {
  const [{ selected, leaving, direction }, setCarousel] = useState({ selected: 1, leaving: -1, direction: 0 })
  const [serviceIndex, setServiceIndex] = useState<number>()
  const service = serviceIndex === undefined ? undefined : teachers[serviceIndex]
  const touch = useRef<{ x: number; y: number }>(null)
  const count = script.experts.length
  const previous = (selected + count - 1) % count
  const next = (selected + 1) % count

  function switchExpert(step: -1 | 1) {
    setCarousel(({ selected }) => ({ selected: (selected + count + step) % count, leaving: selected, direction: step }))
  }

  function side(index: number, step: -1 | 1) {
    return <button type="button" className="roadshow-expert-side" onClick={() => switchExpert(step)}
      aria-label={`查看${script.experts[index].name}`}>
      {script.experts.map((expert, position) => <span key={expert.id} className="expert-preview" aria-hidden="true" data-visible={position === index}>
        <span className="expert-photo"><img src={`/assets/${expertProfiles[position].image}.webp`} alt="" width="92" height="108"/><span>公益</span></span>
        <strong>{expert.name}</strong>
        <span>{expert.style}</span>
        <span className="expert-tag">{expertProfiles[position].tag}</span>
      </span>)}
    </button>
  }
  return <section className="roadshow-expert-section" aria-label={script.cards.EXPERTS}>
    <div className="expert-heading"><h2>为你初步挑选 · 3 位老师</h2><span>不同工作方式</span></div>
    <div className="roadshow-expert-carousel" data-direction={direction || undefined} onTouchStart={event => {
      const point = event.touches[0]
      touch.current = { x: point.clientX, y: point.clientY }
    }} onTouchCancel={() => {
      touch.current = null
    }} onTouchEnd={event => {
      if (!touch.current) return
      const dx = event.changedTouches[0].clientX - touch.current.x
      const dy = event.changedTouches[0].clientY - touch.current.y
      touch.current = null
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) switchExpert(dx < 0 ? 1 : -1)
    }}>
      {side(previous, -1)}
      <section className="roadshow-expert-main" aria-live="polite">
        {script.experts.map((expert, index) => {
          const recommended = expert.id === 'lin_demo'
          const current = index === selected
          const profile = expertProfiles[index]
          return <div key={expert.id} className="expert-slide" inert={!current} aria-hidden={!current || undefined}
            data-state={current ? 'current' : index === leaving ? 'leaving' : undefined}>
            <div className="expert-photo"><img src={`/assets/${profile.image}.webp`} alt="" width="136" height="124"/><span>公益</span></div>
            <div className="expert-body"><div className="expert-name"><h3>{expert.name}</h3><span>{profile.tag}</span></div>
              <p className="roadshow-expert-style">{expert.style}</p>
              <div className="expert-reasons"><h4>{profile.title}</h4><ol>
                {profile.points.map(([intro, emphasis]) => <li key={intro}>{intro}<strong>{emphasis}</strong></li>)}
              </ol></div>
              <div className={active ? undefined : 'expert-service-inactive'}>
                <Button disabled={!active || !current} onClick={recommended ? select : () => setServiceIndex(index)}>
                  了解{expert.name}的服务<ArrowRight/>
                </Button>
              </div>
            </div>
          </div>
        })}
      </section>
      {side(next, 1)}
    </div>
    <div className="expert-carousel-status"><span aria-label={`第 ${selected + 1} 位老师，共 3 位`}>
      {script.experts.map((item, index) => <i key={item.id} className={index === selected ? 'selected' : undefined}/>)}
    </span><p>左右滑动查看其他老师</p></div>
    <section className="expert-comparison"><h3>其他方式：什么时候适合，为什么现在不优先？</h3>
      <article><h4>周老师 <span>支持性倾听</span></h4>
        <p><span className="expert-suitable">更适合</span>情绪很满时，先被安全地听见、慢慢表达。</p>
        <p><span className="expert-deferred">现在不优先</span>自责反复出现，还需要结构化梳理想法与行动。</p>
      </article>
      <article><h4>张老师 <span>考试技巧导向 · 短程 CBT</span></h4>
        <p><span className="expert-suitable">更适合</span>情绪较稳定，主要想解决具体学习策略问题。</p>
        <p><span className="expert-deferred">现在不优先</span>太快讨论提分技巧，可能跳过亲子关系里的委屈。</p>
      </article>
    </section>
    <p className="expert-footnote">仅为初步建议，最终匹配仍需资质核验与专业评估。</p>
    {service && <Dialog title={`${service.name}的服务`} onClose={() => setServiceIndex(undefined)}>
      <div className="prose"><p><strong>{service.method}</strong></p><p>{service.reason}</p><p className="muted">服务资料仅供体验。</p></div>
    </Dialog>}
  </section>
}

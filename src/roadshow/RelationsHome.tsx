import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Clock3, LockKeyhole, MessageCircleMore, Plus, Search, Sparkles, UsersRound } from 'lucide-react'
import { Button, Dialog } from '../components'
import { TopicCards } from '../PeopleOverview'
import type { ResultPage } from './Results'

const asset = '/assets/roadshow-relations/'
const groups = ['家人', '朋友', '同学'] as const
type Group = typeof groups[number]
type Person = { name: string; group: Group; image?: string }
type EventPreview = { title: string; participants: string; portraits?: string[]; exam?: boolean }

const samplePeople: Person[] = [
  { name: '妈妈', group: '家人', image: 'mother' }, { name: '爸爸', group: '家人', image: 'father' },
  { name: '姐姐', group: '家人' }, { name: '奶奶', group: '家人' }, { name: '安安', group: '朋友' },
  { name: '小林', group: '同学', image: 'xiaolin' }, { name: '阿杰', group: '同学' }, { name: '班长', group: '同学' },
]
const activeExamples: EventPreview[] = [
  { title: '小组作业没人选我', participants: '孩子 · 小林 · 安安 · Reso', portraits: ['child', 'xiaolin'] },
  { title: '关于周末的安排', participants: '孩子 · 爸爸 · Reso', portraits: ['child', 'father'] },
  { title: '想和姐姐聊聊最近的学习', participants: '孩子 · 姐姐 · Reso', portraits: ['child'] },
]
const earlierExamples: EventPreview[] = [
  { title: '关于我的选择，想听听爸爸的想法', participants: '孩子 · 爸爸 · Reso' },
  { title: '去小卖部，他们没叫我', participants: '孩子 · 小林 · Reso' },
  { title: '今天上课，老师多看了我一眼', participants: '孩子 · Reso' },
  { title: '和朋友有一点误会', participants: '孩子 · 安安 · Reso' },
  { title: '我想自己做决定', participants: '孩子 · Reso' },
]

export function RelationsHome({ page, roomName, roomStarted, storySaved, applied, open, resume }: {
  page?: 'events' | 'people'
  roomName: string
  roomStarted: boolean
  storySaved: boolean
  applied: boolean
  open: (page: ResultPage) => void
  resume: () => void
}) {
  const [search, setSearch] = useState('')
  const [allActive, setAllActive] = useState(false)
  const [allEarlier, setAllEarlier] = useState(false)
  const [people, setPeople] = useState(samplePeople)
  const [sheet, setSheet] = useState<'topics' | 'add' | { title: string; description: string }>()
  const [name, setName] = useState('')
  const [group, setGroup] = useState<Group>('家人')
  const viewport = useRef<HTMLElement>(null)
  const searchField = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    viewport.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [page])

  if (!page) return null

  const query = search.trim().toLowerCase()
  const matches = (...values: string[]) => values.some(value => value.toLowerCase().includes(query))
  const active = (roomStarted ? [{ title: roomName, participants: '孩子 · 妈妈 · Reso', portraits: ['child', 'mother'], exam: true }, ...activeExamples] : activeExamples)
    .filter(event => matches(event.title, event.participants))
  const earlier = earlierExamples.filter(event => matches(event.title, event.participants))
  const matchedPeople = people.filter(person => matches(person.name, person.group))
  const recent = query ? matchedPeople.slice(0, 3) : ['妈妈', '爸爸', '小林'].flatMap(name => people.filter(person => person.name === name))
  const showStory = storySaved && matches('一点点新的理解', '就差几分', '我的成长卡片')
  const showSupport = applied && matches('林老师', '青少年 CBT', '亲子沟通', '我的专业支持')

  function openPerson(person: Person) {
    if (person.name === '妈妈' && roomStarted) open('mother')
    else setSheet({ title: person.name, description: person.group })
  }

  function eventList(events: EventPreview[], ongoing: boolean, expanded: boolean, toggle: () => void) {
    const limit = ongoing ? 2 : 3
    const title = ongoing ? '正在一起聊' : '之前一起聊过'
    return <section className="relations-section">
      <div className="relations-section-title"><h2>{ongoing ? null : <Clock3 aria-hidden="true"/>}{title}</h2><span>{events.length} 个事件</span></div>
      <div className="relations-card">
        {events.slice(0, expanded || query ? events.length : limit).map(event => <button type="button" key={event.title}
          className={`relations-row${event.exam ? ' relations-exam' : ''}`} onClick={() => event.exam ? open('event') :
            setSheet({ title: event.title, description: event.participants + (ongoing ? ' · 示例事件' : ' · 已结束') })}>
          {event.portraits ? <span className="relations-portrait-stack">{event.portraits.map(image => <img key={image} src={asset + image + '.webp'} alt=""/>)}</span> :
            <span className="relations-row-icon"><MessageCircleMore aria-hidden="true"/></span>}
          <span className="relations-row-copy"><strong>{event.title}</strong>{ongoing && <small>{event.participants}</small>}
            {event.exam && applied && <small className="relations-event-note"><LockKeyhole aria-hidden="true"/>咨询申请已提交 · 仅你可见</small>}</span>
          {ongoing ? <span className="relations-live-dot" aria-label="正在聊"/> : <span className="relations-row-state">已结束</span>}
          <ChevronRight aria-hidden="true"/>
        </button>)}
        {!events.length && <p className="relations-empty" role="status">没有匹配的事件。</p>}
        {!query && events.length > limit && <button className="relations-expand" type="button" aria-expanded={expanded} onClick={toggle}>
          {expanded ? '收起' : ongoing ? `查看全部 ${events.length} 个正在聊` : `查看全部 ${events.length} 个事件`}<ChevronDown aria-hidden="true"/>
        </button>}
      </div>
    </section>
  }

  return <main className="roadshow-relations" ref={viewport} aria-label="我的关系">
    <header className="relations-overview-header">
      <img src={asset + 'mascot.webp'} alt="" width="55" height="64"/>
      <h1>我的关系</h1>
      <button className="icon-button" type="button" aria-label="搜索" onClick={() => searchField.current?.focus()}><Search/></button>
      <button className="icon-button" type="button" aria-label="添加重要的人" onClick={() => setSheet('add')}><Plus/></button>
    </header>
    <label className="relations-search"><Search aria-hidden="true"/><input type="search" ref={searchField} value={search}
      onChange={event => setSearch(event.target.value)} placeholder="搜索重要的人、聊过的事" aria-label="搜索重要的人、聊过的事"/></label>
    <div className="relations-switch" role="group" aria-label="我的关系分类">
      <button type="button" aria-pressed={page === 'events'} onClick={() => open('events')}><MessageCircleMore aria-hidden="true"/>一件小事</button>
      <button type="button" aria-pressed={page === 'people'} onClick={() => open('people')}><UsersRound aria-hidden="true"/>重要的人</button>
    </div>
    {page === 'events' ? <>
      {eventList(active, true, allActive, () => setAllActive(value => !value))}
      {eventList(earlier, false, allEarlier, () => setAllEarlier(value => !value))}
      {!query && <section className="relations-banner relations-chat-banner">
        <img src={asset + 'chat.webp'} alt=""/><div><h2>还有一件事，想慢慢说吗？</h2><p>从你在意的那一刻，慢慢理清。</p>
          <Button onClick={resume}>和 Reso 聊聊<ChevronRight aria-hidden="true"/></Button></div>
      </section>}
      {(!query || showStory) && <section className="relations-card relations-private-card">
        <div className="relations-section-title"><h2>我的成长卡片</h2><span><LockKeyhole aria-hidden="true"/>仅自己可见</span></div>
        {showStory ? <button type="button" className="relations-row relations-private-row" onClick={() => open('story')} aria-label="查看已保存的故事">
          <span className="relations-row-icon"><Sparkles aria-hidden="true"/></span><span className="relations-row-copy"><strong>一点点新的理解</strong><small>关于「就差几分」 · 新记录</small></span>
          <span className="relations-pill">查看</span><ChevronRight aria-hidden="true"/>
        </button> : <p className="relations-empty">保存的故事会显示在这里。</p>}
      </section>}
    </> : <>
      <section className="relations-section">
        <div className="relations-section-title"><h2>{query ? '找到的重要的人' : '最近聊到的人'}</h2></div>
        {recent.length ? <div className="relations-recent">{recent.map(person => <button type="button" key={person.name} onClick={() => openPerson(person)}>
          <Portrait person={person}/><strong>{person.name}</strong>
        </button>)}</div> : <p className="relations-empty" role="status">没有匹配的人。</p>}
      </section>
      {!query && <section className="relations-banner relations-topic-banner">
        <img src={asset + 'topics.webp'} alt=""/><div><h2>今天想聊点轻松的？</h2><p>抽一张话题卡，看看彼此会怎么回答。</p>
          <Button onClick={() => setSheet('topics')}>看看玩法<ChevronRight aria-hidden="true"/></Button></div>
      </section>}
      <section className="relations-section">
        <div className="relations-section-title"><h2>重要的人</h2><span>共 {matchedPeople.length} 人</span></div>
        <div className="relations-card">{groups.map(category => {
          const members = matchedPeople.filter(person => person.group === category)
          if (!members.length) return null
          return <details className="relations-person-group" key={category}>
            <summary><span><strong>{category}</strong><small>{members.map(person => person.name).join('、')}</small></span>
              <span>{members.length} 人<ChevronDown aria-hidden="true"/></span></summary>
            {members.map(person => <button type="button" className="relations-row" key={person.name} onClick={() => openPerson(person)}>
              <Portrait person={person}/><span className="relations-row-copy"><strong>{person.name}</strong></span><ChevronRight aria-hidden="true"/>
            </button>)}
          </details>
        })}{!matchedPeople.length && <p className="relations-empty">没有匹配的分组。</p>}</div>
      </section>
      {(!query || showSupport) && <section className="relations-card relations-private-card">
        <div className="relations-section-title"><h2>我的专业支持</h2><span><LockKeyhole aria-hidden="true"/>仅自己可见</span></div>
        {showSupport ? <button type="button" className="relations-row relations-private-row" onClick={() => open('support')}>
          <img className="relations-portrait" src="/assets/teacher-lin.webp" alt=""/>
          <span className="relations-row-copy"><strong>林老师</strong><small>青少年 CBT · 亲子沟通</small></span>
          <span className="relations-pill relations-support-state">申请已提交</span><ChevronRight aria-hidden="true"/>
        </button> : <p className="relations-empty">咨询申请会显示在这里。</p>}
      </section>}
    </>}
    {sheet === 'topics' && <Dialog title="轻松聊一聊" onClose={() => setSheet(undefined)}><TopicCards/></Dialog>}
    {sheet === 'add' && <Dialog title="添加重要的人" onClose={() => setSheet(undefined)}>
      <form className="relations-add" onSubmit={event => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed || people.some(person => person.name === trimmed)) return
        setPeople(previous => [...previous, { name: trimmed, group }])
        setName('')
        setSearch(trimmed)
        setSheet(undefined)
        open('people')
      }}>
        <label className="field-label">称呼<input maxLength={20} value={name} onChange={event => setName(event.target.value)}/></label>
        <label className="field-label">关系<select value={group} onChange={event => setGroup(groups.find(item => item === event.target.value) ?? '家人')}>
          {groups.map(item => <option key={item}>{item}</option>)}
        </select></label>
        {people.some(person => person.name === name.trim()) && <p className="muted" role="status">这个称呼已在名单里。</p>}
        <button className="button primary" type="submit" disabled={!name.trim() || people.some(person => person.name === name.trim())}>添加</button>
      </form>
    </Dialog>}
    {sheet && typeof sheet === 'object' && <Dialog title={sheet.title} onClose={() => setSheet(undefined)}><p>{sheet.description}</p></Dialog>}
  </main>
}

function Portrait({ person }: { person: Person }) {
  return person.image ? <img className="relations-portrait" src={asset + person.image + '.webp'} alt=""/> :
    <span className="relations-portrait relations-initial" aria-hidden="true">{Array.from(person.name)[0]}</span>
}

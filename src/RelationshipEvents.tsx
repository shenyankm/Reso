import { useEffect, useState } from 'react'
import { ArrowRight, ChevronRight, LockKeyhole, MessageCircle, Sparkles, UsersRound } from 'lucide-react'
import type { Domain, EventRecord, PersonConnection, SavedRecord, SavedRecordPage } from '../shared/types'
import { api } from './api'
import { Button } from './components'

export function RelationshipEvents({
  events, connections, search, busy, onEvent, onChat, onRecords, onStory, onClearSearch,
}: {
  events: EventRecord[]
  connections: PersonConnection[]
  search: string
  busy: boolean
  onEvent: (id: string, domain: Domain) => void
  onChat: () => void
  onRecords: () => void
  onStory: (record: SavedRecord) => void
  onClearSearch: () => void
}) {
  const query = search.trim().toLowerCase()
  const matches = (value: string) => value.toLowerCase().includes(query)
  const participants = new Map<string, PersonConnection[]>()
  for (const connection of connections) {
    const group = participants.get(connection.event_id)
    if (group) group.push(connection)
    else participants.set(connection.event_id, [connection])
  }
  const rooms = events.flatMap(event => {
    const members = participants.get(event.id) ?? []
    if (event.is_owner && !members.length && !event.room_closed_at) return []
    const title = event.room_title || members[0]?.event_title || event.title
    if (!matches(title) && !members.some(member => matches(member.name))) return []
    return [{ id: event.id, title, names: members.map(member => member.name).join(' · '), closed: !!event.room_closed_at }]
  })
  const privateEvents = events.filter(event => event.is_owner && matches(event.title))
  const groups = [
    { id: 'relationship-rooms-title', title: '正在一起聊', rooms: rooms.filter(room=>!room.closed) },
    { id: 'relationship-closed-rooms-title', title: '之前一起聊过', rooms: rooms.filter(room=>room.closed) },
  ]

  return <div className="relationship-events">
    {groups.filter(group=>group.rooms.length).map(group=><section key={group.id} aria-labelledby={group.id}>
      <div className="people-section-title">
        <h2 id={group.id}>{group.title}</h2>
        <span>{group.rooms.length} 个房间</span>
      </div>
      <div className="relationship-event-list">
        {group.rooms.map(room => <button className="saved-event" key={room.id} disabled={busy}
          aria-label={`打开房间聊天：${room.title}`} onClick={() => onEvent(room.id, 'room')}>
          <span className="relationship-event-icon"><UsersRound aria-hidden="true"/></span>
          <div><strong>{room.title}</strong><p>{[room.names, room.closed ? '已结束' : '房间成员可见'].filter(Boolean).join(' · ')}</p></div>
          <ChevronRight aria-hidden="true"/>
        </button>)}
      </div>
    </section>)}
    {(privateEvents.length > 0 || !rooms.length) && <section aria-labelledby="relationship-events-title">
      <div className="people-section-title">
        <h2 id="relationship-events-title">聊过的小事</h2>
        <span>{privateEvents.length} 件事</span>
      </div>
      {privateEvents.length ? <div className="relationship-event-list">
        {privateEvents.map(event => <button className="saved-event" key={event.id} disabled={busy} onClick={() => onEvent(event.id, 'private')}>
          <span className="relationship-event-icon"><MessageCircle aria-hidden="true"/></span>
          <div><strong>{event.title}</strong><p>仅自己可见 · {new Date(event.updated_at).toLocaleDateString('zh-CN')}</p></div>
          <ChevronRight aria-hidden="true"/>
        </button>)}
      </div> : <div className="relationship-event-list relationship-event-empty" role="status">
        <p>{query ? '没有找到相关的小事' : '聊过的小事会留在这里，方便你回来接着说。'}</p>
        {query && <button className="text-button" onClick={onClearSearch}>清除搜索</button>}
      </div>}
    </section>}
    {!query && <>
      <section className="topic-banner relationship-chat-banner">
        <div><h2>还有一件事，想慢慢说吗？</h2><p>从你在意的那一刻，慢慢理清。</p>
          <Button disabled={busy} onClick={onChat}>和 Reso 聊聊 <ArrowRight aria-hidden="true"/></Button></div>
        <img src="/assets/roadshow-relations/chat.webp" alt=""/>
      </section>
      <GrowthStory busy={busy} onStory={onStory} onRecords={onRecords}/>
    </>}
  </div>
}

function GrowthStory({ busy, onStory, onRecords }: {
  busy: boolean
  onStory: (record: SavedRecord) => void
  onRecords: () => void
}) {
  const [story, setStory] = useState<SavedRecord | null | 'loading' | 'unavailable'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<SavedRecordPage>('/me/records?kind=story', undefined, 'GET', controller.signal)
      .then(page => { if (!controller.signal.aborted) setStory(page.records[0] ?? null) })
      .catch(() => { if (!controller.signal.aborted) setStory('unavailable') })
    return () => controller.abort()
  }, [attempt])

  return <section className="relationship-event-list relationship-growth">
    <div className="people-section-title"><h2>我的成长卡片</h2><span><LockKeyhole aria-hidden="true"/>仅自己可见</span></div>
    {story === 'loading' ? <p className="growth-story-status" role="status">正在读取故事…</p>
      : story === 'unavailable' ? <button className="text-button" onClick={() => { setStory('loading'); setAttempt(value => value + 1) }}>重新读取故事</button>
      : story ? <button className="saved-event growth-story-link" aria-label={`查看故事：${story.event_title}`}
          disabled={busy} onClick={() => onStory(story)}>
          <span className="relationship-event-icon"><Sparkles aria-hidden="true"/></span>
          <div><strong>一点点新的理解</strong><p>{story.event_title}</p></div>
          <ChevronRight aria-hidden="true"/>
        </button> : <p className="growth-story-status">你的故事保存后，会出现在这里。</p>}
    <button className="text-button growth-records-link" disabled={busy} onClick={onRecords}>查看全部记录 <ChevronRight aria-hidden="true"/></button>
  </section>
}

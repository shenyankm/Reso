import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { TimelineEntry } from '../shared/relationships'
import type { Domain } from '../shared/types'
import { api } from './api'
import { Button, Card } from './components'

const labels: Record<TimelineEntry['kind'], string> = {
  event_created: '记录了一件小事',
  discovery_confirmed: '确认了一个小发现',
  story_saved: '保存了我的故事',
  followup_saved: '记下了一次回访',
  invite_accepted: '有成员加入会谈',
  perspective_confirmed: '有成员确认了自己的感受',
  room_closed: '会谈已结束',
}

export function EventTimeline({ eventId, domain, version }: { eventId: string; domain: Domain; version: number }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<TimelineEntry[]>(`/events/${eventId}/timeline?domain=${domain}`, undefined, 'GET', controller.signal)
      .then(data => {
        if (!controller.signal.aborted) { setEntries(data); setError('') }
      })
      .catch(error => {
        if (!controller.signal.aborted) { setEntries(null); setError(error.message) }
      })
    return () => controller.abort()
  }, [eventId, domain, version, attempt])

  return <Card title={domain === 'private' ? '这件事的时间线' : '会谈时间线'} icon={<Clock3 aria-hidden="true"/>}>
    <p className="supporting-copy">{domain === 'private' ? '仅自己可见' : '房间成员可见'}</p>
    {error ? <><p role="alert">{error}</p><Button secondary onClick={()=>setAttempt(value=>value+1)}>重新读取时间线</Button></>
      : !entries ? <p role="status">正在读取时间线…</p>
      : !entries.length ? <p>还没有会谈记录。</p>
      : <ol className="timeline event-timeline">{entries.map(entry => <li key={entry.id}>
        <span className="timeline-dot" aria-hidden="true"/>
        <div><strong>{labels[entry.kind]}</strong><br/><time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString('zh-CN')}</time></div>
      </li>)}</ol>}
  </Card>
}

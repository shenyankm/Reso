import { ArrowRight, FileText, Heart, UsersRound } from 'lucide-react'
import { Button, Card } from '../components'
import { ExamTimeline, storyImage, TwoViews } from './Cards'

export type ResultPage = 'events' | 'people' | 'event' | 'mother' | 'story' | 'support' | 'room'

export const resultLabels: Record<ResultPage, [number, string]> = {
  events: [29, '我的关系'],
  people: [31, '我的关系'],
  event: [30, '事件详情'],
  mother: [31, '我和妈妈'],
  story: [32, '已保存的故事'],
  support: [32, '我的专业支持'],
  room: [30, '三方会谈记录'],
}

export function RoadshowResults({ page, open, resume, roomName, roomFinished, story }: {
  page: Exclude<ResultPage, 'events' | 'people' | 'room'>
  open: (page: ResultPage) => void
  roomName: string
  story: string
  roomFinished: boolean
  resume: () => void
}) {
  switch (page) {
    case 'event':
      return <>
        <Card title={roomName} icon={<FileText/>}><p>孩子、妈妈、Reso · 正在一起聊</p><p>考试后，妈妈说「就差几分」，孩子感到此前的努力不算数了。</p>
          {!roomFinished && <Button onClick={resume}>继续聊这件事<ArrowRight/></Button>}</Card>
        {roomFinished && <>
        <Card title="我们聊到了哪里"><ExamTimeline/></Card>
        <Card title="双方已经表达的感受"><TwoViews/></Card>
        <Card title="接下来可以继续探索"><p>新的沟通方式能否在平时持续？孩子的学业焦虑是否仍然存在？</p>
          <Button onClick={() => open('room')}>继续聊这件事<ArrowRight/></Button>
        </Card>
        </>}
      </>
    case 'mother':
      return <>
        <Card title="我和妈妈" icon={<UsersRound/>}><p className="roadshow-private">我在 Reso 中保存的关系理解 · 仅自己可见</p>
          <button type="button" className="saved-event" onClick={() => open('event')}><FileText/><div><strong>{roomName}</strong><p>{roomFinished ? '已完成一次三方会谈' : '三方会谈进行中'}</p></div><ArrowRight/></button>
        </Card>
        {roomFinished && <Card title="我对这段关系的新理解">
          <dl className="roadshow-facts">
            <div><dt>之前的理解</dt><dd>妈妈好像总觉得我不够好。</dd></div>
            <div><dt>现在开始想到</dt><dd>有时妈妈也在责怪自己，但她仍然需要为伤害我的表达负责。</dd></div>
            <div><dt>我真正希望的</dt><dd>希望妈妈先看见我的努力，再和我讨论没有做好的地方。</dd></div>
            <div><dt>我们尝试过的新方式</dt><dd>先表达感受，再讨论问题。区分自己的情绪与对对方的评价。学习用更清楚的方式表达关心与需要。</dd></div>
          </dl>
        </Card>}
      </>
    case 'story':
      return <section className="story-card"><div className="story-title"><h2>一点点新的理解</h2></div>
        <img className="story-art" src={storyImage} alt="我的故事插画"/>
        <div className="story-body"><p className="roadshow-private">已保存 · 仅自己可见</p><p className="roadshow-story">{story}</p></div>
      </section>
    case 'support':
      return <Card title="林老师" icon={<Heart/>}><p>青少年 CBT · 亲子沟通</p>
        <dl className="roadshow-facts">
          <div><dt>预约状态</dt><dd>预约申请已提交（模拟）</dd></div>
          <div><dt>资料分享</dt><dd>不分享聊天内容 · 仅自己可见</dd></div>
          <div><dt>后续服务</dt><dd>等待确认</dd></div>
        </dl>
        <Button secondary onClick={() => open('events')}>返回我的关系</Button>
      </Card>
  }
}

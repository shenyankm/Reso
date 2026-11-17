import {useEffect,useState} from 'react'
import {ChevronDown,ChevronRight,HandHeart,LockKeyhole,UsersRound} from 'lucide-react'
import {api} from './api'
import {Button} from './components'
import {applicationLabel} from './WorkflowCards'
import type {PersonConnection,SupportOverview} from '../shared/types'

function Avatar({name}:{name:string}){return <span className="person-avatar" aria-hidden="true">{Array.from(name.trim())[0]||<UsersRound/>}</span>}

export function PeopleOverview({connections,search,busy,onPerson,onTopic,onSupport,onApplication}:{connections:PersonConnection[];search:string;busy:boolean;onPerson:(person:{id:string;name:string})=>void;onTopic:()=>void;onSupport:()=>void;onApplication:(eventId:string)=>void}){
  const [support,setSupport]=useState<SupportOverview[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[expanded,setExpanded]=useState(false)
  useEffect(()=>{const controller=new AbortController();setError('');setSupport(null);api<SupportOverview[]>('/me/applications',undefined,'GET',controller.signal).then(value=>{if(!controller.signal.aborted)setSupport(value)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[retry])
  const sorted=[...connections].sort((a,b)=>(Date.parse(b.last_interaction_at||'')||0)-(Date.parse(a.last_interaction_at||'')||0)),all=[...new Map(sorted.map(p=>[p.user_id,p])).values()]
  const matchingIds=new Set(connections.filter(p=>p.name.includes(search.trim())||p.event_title.includes(search.trim())).map(p=>p.user_id)),people=all.filter(p=>matchingIds.has(p.user_id))
  const grouped=new Map<string,{id:string;title:string;members:Map<string,PersonConnection>}>()
  for(const p of sorted){
    if(!matchingIds.has(p.user_id))continue
    if(!grouped.has(p.event_id))grouped.set(p.event_id,{id:p.event_id,title:p.event_title||'一起聊过的人',members:new Map()})
    grouped.get(p.event_id)!.members.set(p.user_id,p)
  }
  const groups=[...grouped.values()].map(g=>({...g,people:[...g.members.values()]}))
  const open=(person:PersonConnection)=>onPerson({id:person.user_id,name:person.name})
  return <div className="people-overview">
    <section className="recent-people" aria-labelledby="recent-people-title"><h2 id="recent-people-title">{search.trim()?'找到的重要的人':'最近聊到的人'}</h2>{people.length?<div className="recent-people-row">{people.slice(0,3).map(p=><button key={p.user_id} aria-label={p.name} disabled={busy} onClick={()=>open(p)}><Avatar name={p.name}/><strong>{p.name}</strong></button>)}</div>:<p className="people-empty" role="status">{search.trim()?'没有找到相关的人，换个关键词试试。':'一起聊过的人会出现在这里。可以点右上角的加号邀请。'}</p>}</section>
    <section className="topic-banner"><div><h2>今天想聊点轻松的？</h2><p>抽一张话题卡，看看彼此会怎么回答。</p><Button onClick={onTopic}>看看玩法 <ChevronRight/></Button></div><img src="/assets/reso-welcome.webp" width="356" height="525" alt=""/></section>
    <section aria-labelledby="people-groups-title"><div className="people-section-title"><h2 id="people-groups-title">重要的人</h2><span>共 {all.length} 人</span></div>{groups.length?<div className="people-groups">{groups.map(group=><details key={group.id} className="people-group"><summary><div><h3>{group.title}</h3><p>{group.people.map(p=>p.name).join('、')}</p></div><span>{group.people.length} 人 <ChevronDown/></span></summary><div className="people-group-members">{group.people.map(p=><button key={p.user_id} aria-label={p.name} disabled={busy} onClick={()=>open(p)}><Avatar name={p.name}/><span>{p.name}</span><ChevronRight/></button>)}</div></details>)}</div>:<p className="people-empty">{search.trim()?'没有匹配的分组。':'邀请的人加入后，会按共同聊过的事显示在这里。'}</p>}</section>
    <section className="people-support" aria-labelledby="people-support-title"><div className="people-section-title"><h2 id="people-support-title">我的专业支持</h2><span><LockKeyhole/>仅自己可见</span></div>{error?<div role="alert"><p>{error}</p><button className="text-button" onClick={()=>setRetry(n=>n+1)}>重新读取支持记录</button></div>:support===null?<p className="people-empty" role="status">正在读取支持记录…</p>:support.length?<><div className="people-support-list">{support.slice(0,expanded?20:3).map(a=><button key={a.id} disabled={busy} onClick={()=>onApplication(a.event_id)}><span className="support-avatar"><HandHeart/></span><div><strong>{a.consultant_name}</strong><p>{a.test_only?'体验资料 · ':''}{a.event_title}</p></div><span className={a.status==='scheduled'?'support-state scheduled':'support-state'}>{applicationLabel(a.status)}</span><ChevronRight/></button>)}</div>{support.length>3&&<button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':'查看最近的支持申请'}</button>}</>:<button className="people-support-empty" disabled={busy} onClick={onSupport}><span className="support-avatar"><HandHeart/></span><div><strong>了解适合自己的支持</strong><p>还没有咨询申请，可以先看看支持方式。</p></div><ChevronRight/></button>}</section>
  </div>
}

const topics=['最近哪件小事让你开心了一下？','如果明天有一整天空闲，你想怎么过？','最近有没有一首想推荐给对方的歌？','小时候喜欢、现在还喜欢的东西是什么？']
export function TopicCards(){
  const[index,setIndex]=useState(0),[notice,setNotice]=useState('')
  return <div className="topic-cards"><p className="dialog-description">轮流回答，也可以跳过不想聊的话题。话题不会自动发送。</p><div className="topic-question" aria-live="polite">{topics[index]}</div><div className="two-actions"><Button secondary onClick={()=>{setIndex((index+1)%topics.length);setNotice('')}}>换个话题</Button><Button onClick={async()=>{try{await navigator.clipboard.writeText(topics[index]);setNotice('已复制，可以在聊天中粘贴后发送。')}catch{setNotice('未能复制，可以长按上方话题选择文字。')}}}>复制话题</Button></div>{notice&&<p className="fineprint" role="status">{notice}</p>}</div>
}

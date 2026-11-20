import {useEffect,useState} from 'react'
import {ChevronRight,HandHeart,LockKeyhole,UsersRound} from 'lucide-react'
import {api,ApiError} from './api'
import {Button,DisclosureSummary} from './components'
import {AppointmentStatus} from './WorkflowCards'
import type {PersonConnection,RoomTopic,SupportOverview} from '../shared/types'
import {contactCategories,contactCategoryLabels} from '../shared/relationships'

function Avatar({name}:{name:string}){return <span className="person-avatar" aria-hidden="true">{Array.from(name.trim())[0]||<UsersRound/>}</span>}

export function PeopleOverview({connections,search,busy,onPerson,onTopic,onSupport,onApplication}:{connections:PersonConnection[];search:string;busy:boolean;onPerson:(person:{id:string;name:string})=>void;onTopic:()=>void;onSupport:()=>void;onApplication:(eventId:string)=>void}){
  const [support,setSupport]=useState<SupportOverview[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[expanded,setExpanded]=useState(false)
  useEffect(()=>{const controller=new AbortController();api<SupportOverview[]>('/me/applications',undefined,'GET',controller.signal).then(value=>{if(!controller.signal.aborted){setSupport(value);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[connections,retry])
  const sorted=[...connections].sort((a,b)=>(Date.parse(b.last_interaction_at||'')||0)-(Date.parse(a.last_interaction_at||'')||0)),all=[...new Map(sorted.map(p=>[p.user_id,p])).values()]
  const term=search.trim()
  const matchingIds=new Set(connections.filter(p=>[p.name,p.event_title,contactCategoryLabels[p.category??'uncategorized']].some(value=>value.includes(term))).map(p=>p.user_id))
  const people=all.filter(p=>matchingIds.has(p.user_id))
  const groups=contactCategories.map(category=>({
    id:category,title:contactCategoryLabels[category],people:people.filter(person=>(person.category??'uncategorized')===category),
  })).filter(group=>group.people.length>0)
  const open=(person:PersonConnection)=>onPerson({id:person.user_id,name:person.name})
  return <div className="people-overview">
    <section className="recent-people" aria-labelledby="recent-people-title"><h2 id="recent-people-title">{search.trim()?'找到的重要的人':'最近聊到的人'}</h2>{people.length?<div className="recent-people-row">{people.slice(0,3).map(p=><button key={p.user_id} aria-label={p.name} disabled={busy} onClick={()=>open(p)}><Avatar name={p.name}/><strong>{p.name}</strong></button>)}</div>:<p className="people-empty" role="status">{search.trim()?'没有找到相关的人，换个关键词试试。':'一起聊过的人会出现在这里。可以点右上角的加号邀请。'}</p>}</section>
    <section className="topic-banner"><div><h2>今天想聊点轻松的？</h2><p>抽一张话题卡，看看彼此会怎么回答。</p><Button onClick={onTopic}>看看玩法 <ChevronRight/></Button></div><img src="/assets/roadshow-relations/topics.webp" alt=""/></section>
    <section aria-labelledby="people-groups-title"><div className="people-section-title"><h2 id="people-groups-title">重要的人</h2><span>共 {all.length} 人</span></div>{groups.length?<div className="people-groups">{groups.map(group=><details key={group.id} className="people-group"><DisclosureSummary><div><h3>{group.title}</h3><p>{group.people.map(p=>p.name).join('、')}</p></div><span className="people-group-count">{group.people.length} 人</span></DisclosureSummary><div className="people-group-members">{group.people.map(p=><button key={p.user_id} aria-label={p.name} disabled={busy} onClick={()=>open(p)}><Avatar name={p.name}/><span>{p.name}</span><ChevronRight/></button>)}</div></details>)}</div>:<p className="people-empty">{search.trim()?'没有匹配的分组。':'邀请的人加入后，可以在人物详情里为他们分类。'}</p>}</section>
    <section className="people-support" aria-labelledby="people-support-title"><div className="people-section-title"><h2 id="people-support-title">我的专业支持</h2><span><LockKeyhole/>仅自己可见</span></div>{error?<div role="alert"><p>{error}</p><button className="text-button" onClick={()=>setRetry(n=>n+1)}>重新读取支持记录</button></div>:support===null?<p className="people-empty" role="status">正在读取支持记录…</p>:support.length?<><div className="people-support-list">{support.slice(0,expanded?20:3).map(a=><button key={a.id} disabled={busy} onClick={()=>onApplication(a.event_id)}><span className="support-avatar"><HandHeart/></span><div><strong>{a.consultant_name}</strong><p>{a.test_only?'体验资料 · ':''}{a.event_title}</p></div><AppointmentStatus status={a.status}/><ChevronRight/></button>)}</div>{support.length>3&&<button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':'查看最近的支持申请'}</button>}</>:<button className="people-support-empty" disabled={busy} onClick={onSupport}><span className="support-avatar"><HandHeart/></span><div><strong>了解适合自己的支持</strong><p>还没有咨询申请，可以先看看支持方式。</p></div><ChevronRight/></button>}</section>
  </div>
}


export function TopicCards({connections,userId,onInvite}:{connections:PersonConnection[];userId:string;onInvite:()=>void}){
  const [room,setRoom]=useState(''),[result,setResult]=useState<{room:string;rounds:RoomTopic[]}|null>(null)
  const [draft,setDraft]=useState({round:'',text:''}),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [reload,setReload]=useState(0),[copied,setCopied]=useState('')
  const rooms=[...new Map(connections.map(person=>[person.event_id,person])).values()]
  const chosenRoom=rooms.find(person=>person.event_id===room)
  const activeRoom=chosenRoom?.event_id??''
  const closed=!!chosenRoom?.room_closed_at
  const rounds=result?.room===activeRoom?result.rounds:null
  const current=rounds?.[0],myAnswer=current?.answers.find(answer=>answer.user_id===userId)
  const answer=draft.round===current?.id?draft.text:myAnswer?.answer||''

  useEffect(()=>{
    if(!activeRoom)return
    const controller=new AbortController()
    api<RoomTopic[]>(`/events/${activeRoom}/topics`,undefined,'GET',controller.signal).then(rounds=>{
      if(!controller.signal.aborted)setResult({room:activeRoom,rounds})
    }).catch(e=>{
      if(controller.signal.aborted)return
      if(e instanceof ApiError&&(e.status===403||e.status===404))setResult(null)
      setError(e.message)
    })
    return()=>controller.abort()
  },[activeRoom,connections,reload])

  async function update(path:string,body:object,method:'POST'|'PUT'){
    setBusy(true);setError('')
    try{
      await api(path,body,method)
      setDraft({round:'',text:''})
    }catch(e){
      if(e instanceof ApiError&&(e.status===403||e.status===404))setResult(null)
      setError(e instanceof Error?e.message:'暂时无法更新话题，请重试。')
    }finally{
      setReload(value=>value+1);setBusy(false)
    }
  }

  async function copyTopic(round:RoomTopic){
    try{await navigator.clipboard.writeText(round.question);setCopied(round.id)}
    catch{setError('未能复制，可以长按话题文字选择复制。')}
  }

  const answers=(round:RoomTopic)=>round.answers.length
    ? <ul className="topic-answers">{round.answers.map(item=><li key={item.user_id}><strong>{item.user_id===userId?'我':item.name}</strong><p>{item.answer}</p></li>)}</ul>
    : <p className="fineprint">还没有人回答。</p>
  return <div className="topic-cards">
    <p className="dialog-description">选一个会谈一起抽卡。话题和发送的回答对该会谈的当前成员可见。</p>
    {!rooms.length?<><p>邀请的人加入会谈后，就可以一起玩。</p><Button onClick={onInvite}>邀请重要的人</Button></>:<>
      <label className="field-label" htmlFor="topic-room">一起玩的话题会谈
        <select id="topic-room" value={activeRoom} disabled={busy} onChange={event=>{setError('');setRoom(event.target.value);setDraft({round:'',text:''})}}>
          <option value="">请选择会谈</option>{rooms.map(({event_id,event_title,room_closed_at})=><option key={event_id} value={event_id}>{event_title}{room_closed_at?' · 已结束':''}</option>)}
        </select>
      </label>
      {activeRoom&&rounds===null&&!error&&<p role="status">正在读取话题…</p>}
      {closed&&<p className="supporting-copy">会谈已结束，可以查看已有话题和回答。</p>}
      {current&&<>
        <div className="topic-question" aria-live="polite">{current.question}</div>
        <button type="button" className="text-button" onClick={()=>void copyTopic(current)}>复制话题</button>
        {copied===current.id&&<p role="status" className="fineprint">已复制话题。</p>}
        {answers(current)}
        {!closed&&<label className="field-label" htmlFor="topic-answer">我的回答<textarea id="topic-answer" maxLength={400} disabled={busy}
          value={answer} onChange={event=>setDraft({round:current.id,text:event.target.value})}/></label>}
      </>}
      {activeRoom&&rounds&&!closed&&<div className="two-actions">
        <Button secondary={!!current} disabled={busy} onClick={()=>void update(`/events/${activeRoom}/topics`,{previousId:current?.id??null},'POST')}>{current?'换个话题':'抽一张话题卡'}</Button>
        {current&&<Button disabled={busy||!answer.trim()||answer.trim()===myAnswer?.answer}
          onClick={()=>void update(`/events/${activeRoom}/topics/${current.id}/answer`,{answer},'PUT')}>{myAnswer?'更新我的回答':'发送我的回答'}</Button>}
      </div>}
      {!!rounds&&rounds.length>1&&<details><DisclosureSummary>最近聊过的话题</DisclosureSummary>
        {rounds.slice(1).map(round=><section key={round.id} className="workflow-entry"><h3>{round.question}</h3>{answers(round)}</section>)}
      </details>}
    </>}
    {error&&<div role="alert"><p>{error}</p>{activeRoom&&!rounds&&<Button secondary disabled={busy} onClick={()=>{setError('');setReload(value=>value+1)}}>重新读取话题</Button>}</div>}
  </div>
}

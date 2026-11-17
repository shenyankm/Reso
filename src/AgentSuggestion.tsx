import {Button,SaveStatus} from './components'
import {api} from './api'
import {useDraft} from './drafts'
import type {AgentAction} from '../shared/agent'
import type {MethodKind} from '../shared/agent'
import {methodLabels} from '../shared/methods'

const labels={summary:'私人摘要',nvc:'表达练习',followup:'回访记录'}
const fieldLabels:Record<string,string>={summary:'这件事的私人摘要',observation:'观察到的事',feeling:'我的感受',need:'我在意的需要',request:'我想提出的请求',reflection:'目前的感受或已经尝试的事',next_step:'尚未执行的下一步'}
type SuggestionProps={suggestion:AgentAction;eventId:string;userId:string;busy:boolean;perform:(task:()=>Promise<void>)=>Promise<boolean>;refresh:()=>Promise<void>;onOpen:(method?:MethodKind)=>void}
export function AgentSuggestion(props:SuggestionProps){
  return props.suggestion.kind==='method'?<MethodSuggestion {...props} suggestion={props.suggestion}/>:<RecordSuggestion {...props} suggestion={props.suggestion}/>
}

function MethodSuggestion({suggestion,eventId,busy,perform,refresh,onOpen}:SuggestionProps&{suggestion:Extract<AgentAction,{kind:'method'}>}){
  const resolve=(decision:'apply'|'dismiss')=>perform(async()=>{
    await api(`/events/${eventId}/agent-actions/${suggestion.id}`,{decision})
    await refresh()
    if(decision==='apply')onOpen(suggestion.value.method)
  })
  if(suggestion.status==='dismissed')return <p className="supporting-copy" role="status">先继续聊，暂时不尝试这个练习</p>
  if(suggestion.status==='applied')return <section className="agent-suggestion"><p role="status">你选择了“{methodLabels[suggestion.value.method]}”</p><button className="text-button" disabled={busy} onClick={()=>onOpen(suggestion.value.method)}>接着看看</button><p className="supporting-copy">内容仍需你确认保存，不会自动分享。</p></section>
  const stale=suggestion.status==='stale'
  return <section className="agent-suggestion" aria-label="可选的小练习"><h3>{methodLabels[suggestion.value.method]}</h3><p>{suggestion.value.reason}</p><p className="supporting-copy">也可以先继续聊。开始后随时可以暂停，不会自动保存或分享。</p>
    {stale&&<p role="status">对话已有更新，这个推荐需要重新核对。</p>}
    <div className="two-actions"><Button secondary disabled={busy} onClick={()=>resolve('dismiss')}>先继续聊</Button>{!stale&&<Button disabled={busy} onClick={()=>resolve('apply')}>看看这个练习</Button>}</div>
  </section>
}

function RecordSuggestion({suggestion,eventId,userId,busy,perform,refresh,onOpen}:SuggestionProps&{suggestion:Exclude<AgentAction,{kind:'method'}>}){
  const draft=useDraft(userId,eventId,`agent-${suggestion.id}`,suggestion.value as Record<string,string>)
  const resolve=(decision:'apply'|'dismiss')=>perform(async()=>{await api(`/events/${eventId}/agent-actions/${suggestion.id}`,{decision,...(decision==='apply'?{value:draft.values}:{})});draft.reset();await refresh()})
  if(suggestion.status==='applied')return <section className="agent-suggestion"><p role="status">已保存你确认的{labels[suggestion.kind]}</p><button className="text-button" disabled={busy} onClick={()=>onOpen()}>查看已保存记录</button></section>
  if(suggestion.status==='dismissed')return <p className="supporting-copy">已略过这份整理建议</p>
  const stale=suggestion.status==='stale'
  const empty=Object.values(draft.values).every(v=>!v.trim())
  return <section className="agent-suggestion"><details><summary>核对{labels[suggestion.kind]}建议</summary>{stale&&<p role="status">对话或记录已有更新，这份建议不能直接保存。你修改的文字仍保留，可请 Reso 按最新内容重新整理。</p>}<p className="supporting-copy">{suggestion.kind==='summary'?'保存后更新私人摘要，不会更新已经分享的版本。':suggestion.kind==='nvc'?'保存后更新这件事的表达练习，仅本人可见。':'确认后新增一条私人回访记录，不会自动发送提醒。'}</p>
    {!!suggestion.sources?.length&&<details><summary>参考的原话</summary>{suggestion.sources.map((s,i)=><blockquote key={i}>{s.content}</blockquote>)}</details>}
    {Object.entries(draft.values).map(([key,value])=><label className="field-label" key={key} htmlFor={`agent-${suggestion.id}-${key}`}>{fieldLabels[key]}<textarea id={`agent-${suggestion.id}-${key}`} disabled={busy} maxLength={key==='summary'?3000:key==='next_step'?1000:2000} value={value} onChange={e=>draft.update({...draft.values,[key]:e.target.value})}/></label>)}
    <SaveStatus saved={false}>{draft.dirty?(draft.persistent?'修改已暂存在本机，确认后才会保存':'修改暂时只在当前页面，离开前请复制保存'):''}</SaveStatus>
    <div className="two-actions"><Button secondary disabled={busy} onClick={()=>resolve('dismiss')}>不用这份建议</Button>{!stale&&<Button disabled={busy||empty} onClick={()=>resolve('apply')}>确认保存{labels[suggestion.kind]}</Button>}</div>
  </details></section>
}

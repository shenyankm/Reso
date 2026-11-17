import {useRef,useState} from 'react'
import {Card,Button,SaveStatus} from './components'
import {acts} from './demo'
import {api,clientId} from './api'
import {useDraft} from './drafts'
import type {ChatMessage,Application,Exercise,Followup,Member,Understanding} from '../shared/types'
import {legacyReplySummary,replyPhaseLabels} from '../shared/reply'
import type {ReplyPhase} from '../shared/reply'

type Actions={busy:boolean;perform:(task:()=>Promise<void>)=>Promise<boolean>;refresh:()=>Promise<void>}
export const applicationLabel=(value:string)=>({pending:'待处理',accepted:'已接单 · 待协商时间',rejected:'暂未接受',cancelled:'已取消',proposed:'时间提议 · 待你确认',scheduled:'双方已确认时间',completed:'已完成'} as Record<string,string>)[value]||value
const date=(value:string)=>new Date(value).toLocaleString('zh-CN')

export function MessageReasoning({message}:{message:ChatMessage}){
  if(message.role!=='assistant'||message.author_name!=='Reso'&&message.status!=='error')return null
  const summary=message.reply_summary?.trim()||(message.status==='error'?'这轮回复未完成，尚未形成可用的思考摘要。':legacyReplySummary)
  return <details className="message-reasoning"><summary>思考摘要</summary><div className="reasoning-content" tabIndex={0} role="region" aria-label="本轮思考摘要">{summary}</div></details>
}

export function ReplyProgress({state,phase,configured,connectionLost=false}:{state:string;phase?:ReplyPhase;configured:boolean;connectionLost?:boolean}){
  const label=connectionLost?'连接暂时中断，消息已保存，正在重连…':!configured?'消息已保存，AI 回复尚未配置，可先继续记录':state==='silent'?'Reso 暂时旁听，你们可以继续聊':state==='error'?'这轮回复暂停，可以重试或继续发送':state==='pending'?'已收到，准备回复…':phase?replyPhaseLabels[phase]:'正在处理你的消息…'
  return <p className="reply-progress" role="status" aria-live="polite" data-phase={connectionLost?'reconnecting':state==='running'?phase:state}>{label}</p>
}

export function UnderstandingPrompt({message,busy,onCheck}:{message:ChatMessage;busy:boolean;onCheck:()=>void}){
  if(message.role!=='assistant'||message.author_name!=='Reso'||message.status!=='complete'||message.card_type||message.agent_actions?.length||!['summary','inference'].includes(message.understanding_kind||''))return null
  return <button className="text-button understanding-prompt" disabled={busy} onClick={onCheck}>这符合你的意思吗？</button>
}

export function UnderstandingCards({entries,eventId,userId,onStart,...actions}:Actions&{entries:Understanding[];eventId:string;userId:string;onStart?:()=>void}){
  const[edit,setEdit]=useState<{id:string;content:string;version:number}|null>(null)
  return <Card title="一起核对理解"><p className="supporting-copy">原话、猜测和各自确认分开记录；修改后需要重新核对。</p>{!entries.length&&<><p>当 Reso 对你的核心意思作总结或提出推测时，可以点“这符合你的意思吗？”核对。</p>{onStart&&<Button secondary disabled={actions.busy} onClick={onStart}>回到对话</Button>}</>}{entries.map(entry=><section className="workflow-entry" key={entry.id}>
    <p className="supporting-copy">{entry.source_author_name} · {{user_quoted:'来源：用户原话',model_inference:'来源：AI 的待核对理解',user_corrected:'用户修正'}[entry.provenance]} · {{unconfirmed:'待确认',disputed:'存在不同意见',participant_confirmed:'有参与者确认',jointly_confirmed:'当前成员均已确认'}[entry.status]}</p>
    {edit?.id===entry.id?<><label className="field-label" htmlFor={`understanding-${entry.id}`}>更接近你的理解<textarea disabled={actions.busy} id={`understanding-${entry.id}`} maxLength={4000} value={edit.content} onChange={e=>setEdit({...edit,content:e.target.value})}/></label><div className="two-actions"><Button secondary disabled={actions.busy} onClick={()=>setEdit(null)}>先保留</Button><Button disabled={actions.busy||!edit.content.trim()} onClick={()=>actions.perform(async()=>{await api(`/events/${eventId}/understandings/${entry.id}`,{content:edit.content,version:edit.version},'PATCH');await actions.refresh();setEdit(null)})}>保存修正</Button></div></>:<><p>{entry.content}</p><p className="supporting-copy">{entry.confirmations.some(c=>c.user_id===userId)?entry.confirmations.find(c=>c.user_id===userId)!.agreed?'你已确认当前版本':'你对当前版本有不同意见':'你尚未确认当前版本'}</p><div className="two-actions">{[true,false].map(agreed=><Button secondary key={String(agreed)} disabled={actions.busy} onClick={()=>actions.perform(async()=>{await api(`/events/${eventId}/understandings/${entry.id}/confirm`,{agreed,version:entry.version});await actions.refresh()})}>{agreed?'认可当前理解':'我有不同理解'}</Button>)}</div>{entry.author_id===userId&&<Button secondary disabled={actions.busy} onClick={()=>setEdit({id:entry.id,content:entry.content,version:entry.version})}>修改这份理解</Button>}</>}
  </section>)}</Card>
}

export function PracticeFields({exercise,eventId,userId,kind,...actions}:Actions&{exercise:Exercise;eventId:string;userId:string;kind:'nvc'|'roleplay'}){
  const fields=kind==='nvc'?[['observation','发生了什么？只写你观察到的事'],['feeling','我有什么感受？'],['need','我在意或需要什么？'],['request','我想提出怎样具体、可拒绝的请求？']]:[['my_words','我准备怎样开口？'],['possible_reply','对方可能怎样回应？这里只是假设'],['my_response','如果这样回应，我想怎样表达？']]
  const initial=Object.fromEntries(fields.map(([key])=>[key,exercise.practice_notes[kind]?.[key]||'']))
  const draft=useDraft(userId,eventId,kind,initial,exercise.version),[saved,setSaved]=useState(false)
  const conflict=draft.dirty&&draft.revision!==exercise.version
  return <Card title={kind==='nvc'?'写下我的表达':'练习怎么开口'}><p className="supporting-copy">{kind==='nvc'?'按事实、感受、需要和请求整理自己的话。':'只排练自己的表达，不替对方确定想法，也不预设和解。'}</p>{fields.map(([key,label])=><label className="field-label" key={key} htmlFor={`practice-${key}`}>{label}<textarea disabled={actions.busy} id={`practice-${key}`} maxLength={2000} value={draft.values[key]} onChange={e=>{setSaved(false);draft.update({...draft.values,[key]:e.target.value})}}/></label>)}
    {conflict&&<div className="draft-conflict" role="alert"><p>已保存的记录有更新，你的草稿仍保留。</p><details><summary>核对最新保存的内容</summary>{fields.map(([key,label])=><p key={key}><strong>{label}</strong><br/>{initial[key]||'未填写'}</p>)}</details><div className="two-actions"><Button secondary onClick={draft.reset}>使用已保存内容</Button><Button secondary onClick={draft.rebase}>已核对，保留我的草稿</Button></div></div>}
    {exercise.paused&&<p className="fineprint">练习已暂停。可以先回到对话，准备好后再继续。</p>}
    <SaveStatus saved={!draft.dirty&&(saved||Object.values(initial).some(v=>v.trim()))}>{draft.dirty?(draft.persistent?'草稿已保留在此设备，尚未保存到记录':'草稿暂存在当前页面，退出 App 前请先保存'):saved||Object.values(draft.values).some(v=>v.trim())?'私人练习已保存':'填写后可以保存，仅自己可见'}</SaveStatus>
    <Button disabled={actions.busy||!draft.dirty||conflict} onClick={()=>actions.perform(async()=>{await api(`/events/${eventId}/exercise`,{...exercise,version:draft.revision,practice_notes:{...exercise.practice_notes,[kind]:draft.values}},'PUT');draft.saved(draft.revision+1);setSaved(true);await actions.refresh()})}>{actions.busy?'正在保存…':'保存私人练习'}</Button>
  </Card>
}

export function FollowupList({entries,onStart,pendingOnly=false,...actions}:Actions&{entries:Followup[];onStart?:()=>void;pendingOnly?:boolean}){
  const visible=pendingOnly?entries.filter(entry=>!entry.reviewed_at):entries
  return <Card title={pendingOnly?'待回访':'回访记录'}>{!visible.length&&<><p>{pendingOnly?'暂时没有待回访。已回看的内容仍保留在“我的记录”中。':'还没有回访记录。可以从某件事的记录页写下变化和下一步。'}</p>{onStart&&<Button secondary disabled={actions.busy} onClick={onStart}>{pendingOnly?'查看全部记录':'回到事件列表'}</Button>}</>}{visible.map(entry=><section key={entry.id} className="workflow-entry">{entry.event_title&&<h3>{entry.event_title}</h3>}<p>{entry.reflection}</p>{entry.next_step&&<p>下一步：{entry.next_step}</p>}<p className="fineprint">记录于 {date(entry.created_at)}{entry.review_at?` · 计划回看 ${date(entry.review_at)}`:''}</p>{entry.reviewed_at?<p className="fineprint">已在 {date(entry.reviewed_at)} 回看</p>:<Button secondary disabled={actions.busy} onClick={()=>actions.perform(async()=>{await api(`/events/${entry.event_id}/followups/${entry.id}/review`,{});await actions.refresh()})}>我已回看这条记录</Button>}</section>)}</Card>
}
export function FollowupForm({eventId,userId,entries,...actions}:Actions&{eventId:string;userId:string;entries:Followup[]}){
  const id=useRef(clientId()),[saved,setSaved]=useState(false)
  const draft=useDraft(userId,eventId,'followup',{id:id.current,reflection:'',nextStep:'',review:''})
  const {reflection,nextStep,review}=draft.values
  const change=(key:string,value:string)=>{setSaved(false);draft.update({...draft.values,[key]:value})}
  return <><Card title="这之后，有什么变化？"><label className="field-label" htmlFor="reflection">我想留下的变化或感受<textarea disabled={actions.busy} id="reflection" maxLength={2000} value={reflection} onChange={e=>change('reflection',e.target.value)}/></label><label className="field-label" htmlFor="next-step">我想尝试的下一步<textarea disabled={actions.busy} id="next-step" maxLength={1000} value={nextStep} onChange={e=>change('nextStep',e.target.value)}/></label><label className="field-label" htmlFor="review-time">何时回来看看（可不填）<input disabled={actions.busy} id="review-time" type="datetime-local" value={review} onChange={e=>change('review',e.target.value)}/></label><p className="fineprint">记录仅自己可见；本版不发送站外提醒。</p>
    <SaveStatus saved={saved}>{saved?'回访记录已保存':draft.dirty?(draft.persistent?'草稿已保留在此设备':'草稿暂存在当前页面，退出 App 前请先保存'):''}</SaveStatus>
    <Button disabled={actions.busy||!reflection.trim()} onClick={()=>actions.perform(async()=>{await api(`/events/${eventId}/followups`,{id:draft.values.id,reflection:reflection.trim(),nextStep:nextStep.trim(),reviewAt:review?new Date(review).toISOString():null});id.current=clientId();draft.reset();setSaved(true);await actions.refresh()})}>{actions.busy?'正在保存…':'保存回访记录'}</Button></Card>{entries.length>0&&<FollowupList entries={entries} {...actions}/>}</>
}

export function ClientApplication({application:a,members,...actions}:Actions&{application:Application;members:Member[]}){
  const[recipient,setRecipient]=useState(''),[consent,setConsent]=useState<number|null>(null)
  return <section className="workflow-entry"><h3>{a.consultant_name}</h3><p>{applicationLabel(a.status)}</p>{a.scheduled_at&&<p>已约定：{date(a.scheduled_at)}</p>}{a.proposed_at&&<><p>请核对提议时间：{date(a.proposed_at)}</p><div className="two-actions">{[false,true].map(accepted=><Button key={String(accepted)} secondary={!accepted} disabled={actions.busy} onClick={()=>actions.perform(async()=>{await api(`/applications/${a.id}/appointment-response`,{accepted,version:a.schedule_version});await actions.refresh()})}>{accepted?'确认这个时间':'需要换个时间'}</Button>)}</div></>}{a.rejection_reason&&<p>{a.rejection_reason}</p>}<p className="muted">{a.shared_summary?'已分享确认摘要':'未分享聊天内容'}</p><div className="two-actions">{['pending','accepted','proposed','scheduled'].includes(a.status)&&<Button secondary disabled={actions.busy} onClick={()=>actions.perform(async()=>{await api(`/applications/${a.id}`,{status:'cancelled'},'PATCH');await actions.refresh()})}>取消申请</Button>}{a.shared_summary&&<Button secondary disabled={actions.busy} onClick={()=>actions.perform(async()=>{await api(`/applications/${a.id}/share`,undefined,'DELETE');await actions.refresh()})}>撤回摘要分享</Button>}</div>{a.note_content&&<><h3>向你开放的咨询纪要</h3><p>{a.note_content}</p>{members.length>0&&<><label className="field-label" htmlFor={`note-recipient-${a.id}`}>分享给谁<select id={`note-recipient-${a.id}`} value={recipient} onChange={e=>{setRecipient(e.target.value);setConsent(null)}}><option value="">请选择当前房间成员</option>{members.map(m=><option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={consent===a.note_version} onChange={e=>setConsent(e.target.checked?a.note_version!:null)}/><span>我同意向所选成员分享上方这份纪要</span></label><Button secondary disabled={actions.busy||!recipient||consent!==a.note_version} onClick={()=>actions.perform(async()=>{await api(`/applications/${a.id}/note-shares`,{recipientId:recipient,version:a.note_version});await actions.refresh();setConsent(null)})}>确认分享纪要</Button></>}</>}{a.note_shares?.map(s=><div className="request-row" key={s.recipient_id}><span>已分享给 {members.find(m=>m.user_id===s.recipient_id)?.name||'原房间成员'} · 版本 {s.source_version}</span><button className="text-button" disabled={actions.busy} onClick={()=>actions.perform(async()=>{await api(`/applications/${a.id}/note-shares/${s.recipient_id}`,undefined,'DELETE');await actions.refresh()})}>撤回纪要</button></div>)}</section>
}

export function CounselorApplication({application:a,...actions}:Actions&{application:Application}){
  const[time,setTime]=useState(''),[reason,setReason]=useState(''),[editing,setEditing]=useState(false),[note,setNote]=useState(''),[visible,setVisible]=useState(false),[version,setVersion]=useState(0)
  return <Card title={a.applicant_name}><p>{applicationLabel(a.status)}</p><p>{a.shared_summary||'未分享聊天内容'}</p>{a.proposed_at&&<p>待申请人确认：{date(a.proposed_at)}</p>}{a.scheduled_at&&<p>已约定：{date(a.scheduled_at)}</p>}{['accepted','proposed','scheduled'].includes(a.status)&&<label className="field-label" htmlFor={`time-${a.id}`}>提议或调整咨询时间<input disabled={actions.busy} id={`time-${a.id}`} type="datetime-local" value={time} onChange={e=>setTime(e.target.value)}/></label>}{a.status==='pending'&&<label className="field-label" htmlFor={`reason-${a.id}`}>暂不接受时的说明（例如暂无档期）<input disabled={actions.busy} id={`reason-${a.id}`} value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label>}<div className="two-actions">{(a.status==='pending'?['accepted','rejected']:['accepted','proposed','scheduled'].includes(a.status)?['proposed',...(a.status==='scheduled'?['completed']:[])]:[]).map(status=><Button secondary={status==='rejected'} key={status} disabled={actions.busy||status==='proposed'&&!time||status==='completed'&&!!a.scheduled_at&&new Date(a.scheduled_at)>new Date()} onClick={()=>actions.perform(async()=>{await api(`/applications/${a.id}`,{status,reason,...(status==='proposed'?{scheduledAt:new Date(time).toISOString()}: {})},'PATCH');await actions.refresh()})}>{{accepted:'接单',rejected:'暂不接受',proposed:'发出时间提议',completed:'标记完成'}[status]}</Button>)}</div>{['scheduled','completed'].includes(a.status)&&<>{editing?<><label className="field-label" htmlFor={`note-${a.id}`}>服务纪要<textarea disabled={actions.busy} id={`note-${a.id}`} maxLength={5000} value={note} onChange={e=>setNote(e.target.value)}/></label><label className="check-row"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/><span>向申请人开放这份纪要</span></label><p className="fineprint">未开放的草稿不会进入申请人的导出或 Agent 上下文。</p><Button disabled={actions.busy||!note.trim()} onClick={()=>actions.perform(async()=>{await api(`/applications/${a.id}/note`,{content:note,clientVisible:visible,version},'PUT');await actions.refresh();setEditing(false)})}>保存纪要</Button></>:<Button secondary disabled={actions.busy} onClick={()=>{setNote(a.note_content||'');setVisible(a.note_visible||false);setVersion(a.note_version||0);setEditing(true)}}>{a.note_content?'编辑纪要':'填写纪要'}</Button>}</>}</Card>
}

export function ShareMembers({members,snapshots,currentVersion,busy,canShare,onShare,onWithdraw,onRemove}:{members:Member[];snapshots:import('../shared/types').EventDetail['snapshots'];currentVersion:number;busy:boolean;canShare:boolean;onShare:(id:string)=>void;onWithdraw:(id:string)=>void;onRemove:(id:string)=>void}){
  return <Card title="已加入的人">{members.map(member=>{
    const snapshot=snapshots.find(item=>item.user_id===member.user_id)
    return <section className="member-share" key={member.user_id}><strong>{member.name}</strong><p className="muted">{snapshot?'已向此人分享下方固定版本':'此人看不到你的私人摘要'}</p>
      {snapshot&&<details className="shared-preview"><summary>查看{member.name}可见的摘要</summary><p>{snapshot.content}</p><p className="fineprint">版本 {snapshot.version} · 分享于 {date(snapshot.granted_at)}</p><p>{snapshot.version===currentVersion?'与当前私人摘要版本一致':'你已修改私人记录，此人仍只能看到上方旧版本。'}</p></details>}
      <div className="two-actions">{snapshot?<><Button secondary disabled={busy} onClick={()=>onWithdraw(member.user_id)}>撤回摘要</Button>{snapshot.version!==currentVersion&&<Button secondary disabled={busy||!canShare} onClick={()=>onShare(member.user_id)}>更新为当前摘要</Button>}</>:<Button secondary disabled={busy||!canShare} onClick={()=>onShare(member.user_id)}>分享当前摘要</Button>}</div>
      <button className="text-button" disabled={busy} onClick={()=>onRemove(member.user_id)}>移出房间</button>
    </section>
  })}</Card>
}

export function ExerciseProgress({act,disabled,onSelect}:{act:number;disabled:boolean;onSelect:(act:number)=>void}) {
  return <div className="exercise-progress"><div className="act-progress"><svg className="act-track" viewBox="0 0 272 48" aria-hidden="true"><path d="M24 24H248"/><path className="act-track-position" d="M24 24H248" pathLength="1" strokeDasharray="1" strokeDashoffset={1-Math.max(0,act-1)/4}/></svg>{acts.slice(1).map((item,index)=><button key={item.chapter} disabled={disabled} className={act===index+1?'current':''} aria-current={act===index+1?'step':undefined} aria-label={`${item.chapter}：${item.title}`} onClick={()=>onSelect(index+1)}>{index+1}</button>)}</div><p className="act-position" role="status">{act?`当前：${acts[act].chapter}`:'准备开始'}</p></div>
}

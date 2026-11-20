import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, HandHeart, Heart, Info, Link, LogOut, MessageCircle, Mic, MoreHorizontal, Pause, Pencil, Plus, Search, Send, Shield, ShieldCheck, Sparkles, UserRound, UsersRound, X } from 'lucide-react'
import { Bubble, Button, Card, Dialog, DisclosureSummary, SaveStatus } from './components'
import MvpWelcome, { welcomeNotices, type WelcomeNotice } from './MvpWelcome'
import { api, ApiError, clientId } from './api'
import {AgentSuggestion} from './AgentSuggestion'
import {ProgressiveReply} from './ProgressiveReply'
import {Profile,SavedRecords,PrivacyData} from './Profile'
import {PeopleOverview,TopicCards} from './PeopleOverview'
import {PrimaryNavigation} from './PrimaryNavigation'
import {RelationshipEvents} from './RelationshipEvents'
import {EventTimeline} from './EventTimeline'
import {StoryArtwork} from './StoryArtwork'
import {InvitationQr,InvitationScanner} from './InvitationQr'
import {contactCategories, contactCategoryLabels, type ContactCategory} from '../shared/relationships'
import {ConsultantMatches} from './ConsultantMatches'
import {exportRecord} from './export'
import {allowDeviceReminders,rememberReminders,remindersEnabled,syncDeviceReminders,type Reminder} from './followupReminders'
import {createRequestScope} from './requests'
import {clearDrafts,hasDrafts,useDraft} from './drafts'
import { acts } from './demo'
import { eventHash,parseEventLink,parseInvitationLink,parseInviteHash } from '../shared/navigation'
import { ExerciseProgress,UnderstandingCards,UnderstandingPrompt,MessageReasoning,ReplyProgress,PracticeFields,FollowupForm,FollowupList,ClientApplication,CounselorApplication,ShareMembers } from './WorkflowCards'
import { scqaItems, scqaOptions, scqaVersion, scales,firstUnanswered } from '../shared/scqa'
import type { Application, Consultant, Domain, EventDetail, EventRecord, Exercise, User, Followup,MessagePage,SavedRecord,SavedRecordPage,InvitationPreview,PersonConnection,ChatMessage } from '../shared/types'

type View='profile'|'records'|'privacy'|'chat'|'relationships'|'questionnaire'|'discovery'|'exercise'|'story'|'memory'|'invite'|'perspectives'|'consultants'|'applications'|'safety'|'counselor'|'understandings'|'nvc'|'roleplay'|'growth'|'person'|'room-timeline'
type Sheet=WelcomeNotice|'people-support'|'people-add'|'topics'|'auth'|'share'|'tools'|'event'|'summary'|'edit-act'|'perspective'|'voice'|'account'|'delete'|'event-menu'|'discard'|'logout'|'open-invite'|'remove-member'|'close-room'|'invite-qr'|null
const image=(name:string)=>`/assets/${name}.webp`
const practiceWriting=[
  {prompt:'可以围绕这件事，按自己的节奏写下经历。先描述你愿意谈的部分，随时可以暂停。', caption:'写下你愿意聊的开头。'},
  {prompt:'回到事情发生时：你记得哪些具体的话或行动？当时有什么感受？', caption:'写下你记得的情境，不必补齐不确定的细节。'},
  {prompt:'对方实际说了什么？你从中理解到了什么？可以把原话和自己的理解分别写下。', caption:'把原话、自己的理解和还不确定的部分分开。'},
  {prompt:'在这段经历里，你做过哪些努力、尝试或选择？即使很小，也可以写下来。', caption:'留下一次你认可的尝试。'},
  {prompt:'把前面写下的内容放在一起。有没有一个判断，你想保留、补充，或换一种说法？', caption:'写下你想保留或补充的理解。'},
  {prompt:'用自己的话整理这件事：发生了什么、你有什么感受，以及接下来希望怎样被对待。', caption:'从你愿意留下的片段写起。'},
]
const emptyExercise:Exercise={act:0,paused:false,notes:{},story:'',saved:false,version:0,practice_notes:{}}

export default function MvpApp(){
  const[user,setUser]=useState<User|null>(null),[role,setRole]=useState('member'),[starting,setStarting]=useState(true)
  const[status,setStatus]=useState({agentConfigured:false,asrConfigured:false})
  const[recordPage,setRecordPage]=useState<SavedRecordPage|null>(null)
  const[people,setPeople]=useState<PersonConnection[]>([])
  const[events,setEvents]=useState<EventRecord[]>([]),[selected,setSelected]=useState<string|null>(null),[domain,setDomain]=useState<Domain>('private'),[detail,setDetail]=useState<EventDetail|null>(null)
  const[view,setView]=useState<View>('relationships'),[sheet,setSheet]=useState<Sheet>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState('')
  const[register,setRegister]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState('')
  const[replyConnectionLost,setReplyConnectionLost]=useState(false)
  const[requestId,setRequestId]=useState(clientId),[title,setTitle]=useState(''),[summary,setSummary]=useState(''),[search,setSearch]=useState(''),[relationsTab,setRelationsTab]=useState<'events'|'people'>('events')
  const[question,setQuestion]=useState(0),[share,setShare]=useState(false),[inviteLink,setInviteLink]=useState(''),[correction,setCorrection]=useState('')
  const[consultants,setConsultants]=useState<Consultant[]>([]),[consultant,setConsultant]=useState<Consultant|null>(null),[counselorApplications,setCounselorApplications]=useState<Application[]>([])
  const[invitation,setInvitation]=useState<(InvitationPreview&{token:string})|null>(null)
  const[pastedInvite,setPastedInvite]=useState('')
  const[removeMember,setRemoveMember]=useState<string|null>(null)
  const[recording,setRecording]=useState(false),[voiceBusy,setVoiceBusy]=useState(false),[audioBlob,setAudioBlob]=useState<Blob|null>(null)
  const[shareRecipient,setShareRecipient]=useState<string|null>(null)
  const[followups,setFollowups]=useState<Followup[]>([]),[person,setPerson]=useState<{id:string;name:string}|null>(null),[consultantNeed,setConsultantNeed]=useState(''),[appliedNeed,setAppliedNeed]=useState('')
  const[reminderSetting,setReminderSetting]=useState<{account:string;enabled:boolean}|null>(null)
  const[requests]=useState(()=>({session:createRequestScope(),lists:createRequestScope(),detail:createRequestScope(),invitation:createRequestScope()}))
  const accountTrigger=useRef<HTMLButtonElement>(null),accountMenu=useRef<HTMLDivElement>(null)
  const pendingReplies=useRef(new Set<string>())
  const actionRunning=useRef(false),viewHistory=useRef<View[]>([]),viewRef=useRef(view),backRef=useRef<()=>boolean>(()=>false)
  const[toolGroup,setToolGroup]=useState('了解自己'),[discardSheet,setDiscardSheet]=useState<Sheet>(null)
  const inviteRequestId=useRef(clientId()),applicationRequestId=useRef(clientId())
  const scroll=useRef<HTMLDivElement>(null),selectedRef=useRef(selected),domainRef=useRef(domain),recorder=useRef<MediaRecorder|null>(null),recordTimeout=useRef<ReturnType<typeof setTimeout>|null>(null),voiceAbort=useRef<AbortController|null>(null)
  const lastChat=useRef<{id:string;domain:Domain}|null>(null)
  const chatPositions=useRef(new Map<string,number>())
  selectedRef.current=selected;domainRef.current=domain;viewRef.current=view
  const deviceReminders=!!window.ResoReminders
  const remindersOn=!!user&&(reminderSetting?.account===user.id?reminderSetting.enabled:remindersEnabled(user.id))
  const owner=!!detail&&detail.event.owner_id===user?.id
  const roomClosed=!!detail?.event.room_closed_at,roomReadOnly=domain==='room'&&roomClosed
  const exercise=detail?.exercise||emptyExercise
  const mePerspective=detail?.perspectives.find(p=>p.user_id===user?.id)
  const messageDraft=useDraft(user?.id||'',selected||'',`message-${domain}`,{text:''})
  const storyEditor=useDraft(user?.id||'',selected||'','story',{text:exercise.story},exercise.version)
  const findingEditor=useDraft(user?.id||'',selected||'','finding',{text:detail?.questionnaire?.confirmed_summary||detail?.questionnaire?.discovery||''},detail?.questionnaire?.revision||0)
  const findingConflict=findingEditor.dirty&&findingEditor.revision!==(detail?.questionnaire?.revision||0)
  const draft=messageDraft.values.text,storyDraft=storyEditor.dirty?storyEditor.values.text:null
  const storyConflict=storyEditor.dirty&&storyEditor.revision!==exercise.version
  const latestDraft=useRef(draft);latestDraft.current=draft
  const relationshipsActive=view==='relationships'||(view!=='chat'&&viewHistory.current[0]==='relationships'&&!viewHistory.current.includes('chat'))
  const eventView=!!selected&&!['profile','records','privacy','relationships','growth','person','counselor','safety'].includes(view)
  const localLinks=['localhost','127.0.0.1','[::1]'].includes(location.hostname)
  function setDraft(next:string|((previous:string)=>string)){messageDraft.update({text:typeof next==='function'?next(latestDraft.current):next})}
  function setStoryDraft(next:string){storyEditor.update({text:next})}

  function clearSession(){
    syncDeviceReminders('',[]);setReminderSetting(null)
    lastChat.current=null;chatPositions.current.clear()
    setRegister(false);setPassword('');setPastedInvite('');setRemoveMember(null)
    clearDrafts(user?.id);setRecordPage(null);viewHistory.current=[];setSearch('');setRelationsTab('events');setCorrection('');setTitle('');setSummary('');setQuestion(0);setToolGroup('了解自己');setConsultantNeed('');setAppliedNeed('')
    requests.session.cancel();requests.lists.cancel();requests.detail.cancel();requests.invitation.cancel()
    voiceAbort.current?.abort()
    if(recorder.current){recorder.current.onstop=null;recorder.current.ondataavailable=null;if(recorder.current.state==='recording')recorder.current.stop();recorder.current.stream.getTracks().forEach(t=>t.stop())}
    if(recordTimeout.current)clearTimeout(recordTimeout.current)
    setUser(null);setRole('member');setSelected(null);selectedRef.current=null;setDomain('private');domainRef.current='private';setDetail(null);setView('relationships');setEvents([]);setPeople([]);setFollowups([]);setPerson(null);setCounselorApplications([]);setConsultants([]);setConsultant(null);setInviteLink('');setShare(false);setShareRecipient(null);setAudioBlob(null);setRecording(false);setVoiceBusy(false);setSheet(null)
  }
  function closeUnavailableEvent(id:string,scope:Domain){
    if(user)clearDrafts(user.id,id)
    if(lastChat.current?.id===id&&lastChat.current.domain===scope)lastChat.current=null
    chatPositions.current.delete(`${id}:${scope}`)
    requests.detail.cancel();voiceAbort.current?.abort()
    const media=recorder.current
    if(media){media.ondataavailable=null;media.onstop=null;stopRecording();media.stream.getTracks().forEach(track=>track.stop())}
    if(recordTimeout.current)clearTimeout(recordTimeout.current)
    recorder.current=null;recordTimeout.current=null
    setRecording(false);setVoiceBusy(false);setAudioBlob(null);setCorrection('');setInviteLink('');setRemoveMember(null)
    const route=parseEventLink(location.hash)
    if(route?.id===id&&route.domain===scope)history.replaceState(null,'',location.pathname+location.search)
    setSelected(null);selectedRef.current=null;setDetail(null)
    navigate('relationships',true)
  }
  async function refresh(){
    const id=selectedRef.current,currentDomain=domainRef.current,signal=requests.lists.begin(requests.session.signal)
    try{
      if(viewRef.current==='counselor'){
        const applications=await api<Application[]>('/counselor/applications',undefined,'GET',signal)
        if(!signal.aborted&&viewRef.current==='counselor')setCounselorApplications(applications)
        return
      }
      const [list,contacts]=await Promise.all([api<EventRecord[]>('/events',undefined,'GET',signal),api<typeof people>('/people',undefined,'GET',signal)])
      if(signal.aborted)return
      setEvents(list);setPeople(contacts)
      if(!id||selectedRef.current!==id||domainRef.current!==currentDomain)return
      const detailSignal=requests.detail.begin(requests.session.signal)
      try{
        const next=await api<EventDetail>(`/events/${id}?domain=${currentDomain}`,undefined,'GET',detailSignal)
        if(!detailSignal.aborted){
          setDetail(previous=>{
            if(!previous||previous.event.id!==id||!next.messages.length)return next
            const overlap=previous.messages.findIndex(message=>message.id===next.messages[0].id)
            return overlap>0?{...next,messages:[...previous.messages.slice(0,overlap),...next.messages],hasMore:previous.hasMore}:next
          })
          if(!parseInviteHash(location.hash))history.replaceState(null,'',eventHash(id,currentDomain))
        }
      }catch(e){
        if(detailSignal.aborted)return
        if(e instanceof ApiError&&(e.status===403||e.status===404)){
          closeUnavailableEvent(id,currentDomain)
          setError(currentDomain==='room'?'房间访问已撤回或会谈已删除':'这件事的访问已撤回或记录已删除')
        }else throw e
      }
    }catch(e){if(signal.aborted)return;if(e instanceof ApiError&&e.status===401){clearSession();setError('登录已失效，请重新登录');return}throw e}
  }
  async function action(task:()=>Promise<void>){
    if(actionRunning.current)return false
    actionRunning.current=true;setError('');setBusy(true)
    try{await task();return true}catch(e){
      if(e instanceof Error&&e.name==='AbortError')return false
      if(e instanceof ApiError&&e.status===401&&!['/auth/sign-in/email','/auth/sign-up/email'].includes(e.path))clearSession()
      setError(e instanceof Error?e.message:'操作未完成，请重试')
      if(e instanceof ApiError&&e.status===409)await refresh().catch(()=>{})
      return false
    }finally{actionRunning.current=false;setBusy(false)}
  }
  function positionAccountMenu(){
    if(!accountTrigger.current||!accountMenu.current)return
    const bounds=accountTrigger.current.getBoundingClientRect(),menu=accountMenu.current
    menu.style.top=`${bounds.bottom+6}px`;menu.style.right=`${Math.max(12,innerWidth-bounds.right)}px`;menu.style.maxHeight=`${Math.max(48,innerHeight-bounds.bottom-18)}px`
  }
  useEffect(()=>{const resize=()=>{if(accountMenu.current?.matches(':popover-open'))positionAccountMenu()};window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[])
  function rememberChatPosition(){
    const node=scroll.current
    if(viewRef.current!=='chat'||!selectedRef.current||!node)return
    const atBottom=node.scrollHeight-node.clientHeight-node.scrollTop<24
    chatPositions.current.set(`${selectedRef.current}:${domainRef.current}`,atBottom ? Infinity : node.scrollTop)
  }
  function navigate(next:View,root=false){
    if(next!=='chat')rememberChatPosition()
    accountMenu.current?.hidePopover()
    if(root)viewHistory.current=next==='relationships'?[]:['relationships']
    else if(next!==viewRef.current){if(next==='relationships')viewHistory.current=[];else viewHistory.current.push(viewRef.current)}
    viewRef.current=next;setView(next);setSheet(null);setError('')
  }
  function goBack(){
    if(view==='chat'&&domain==='room'&&owner){void action(()=>openEvent(selected!,'private'));return}
    rememberChatPosition()
    const previous=viewHistory.current.pop()||'relationships';viewRef.current=previous;setView(previous);setError('')
  }
  function handleBack(){
    if(accountMenu.current?.matches(':popover-open')){accountMenu.current.hidePopover();return true}
    if(busy){setToast('正在处理，请稍候');return true}
    if(sheet){closeSheet();return true}
    if(!user||view==='relationships'||view==='profile'&&!viewHistory.current.length)return false
    goBack();return true
  }
  backRef.current=handleBack
  useEffect(()=>{const back=(event:Event)=>{if(backRef.current())event.preventDefault()};window.addEventListener('reso-back',back);return()=>window.removeEventListener('reso-back',back)},[])
  function openQuestionnaire(){
    setQuestion(firstUnanswered(detail?.questionnaire?.answers))
    if(detail?.questionnaire?.scores){navigate('discovery')}else navigate('questionnaire')
  }
  async function openEvent(id:string,d:Domain='private',destination:View='chat'){
    const signal=requests.detail.begin(requests.session.signal)
    if(destination==='chat')rememberChatPosition()
    navigate(destination)
    setInviteLink('');setShare(false);setShareRecipient(null);setConsultant(null);inviteRequestId.current=clientId();applicationRequestId.current=clientId();setSelected(id);selectedRef.current=id;setDomain(d);domainRef.current=d;setDetail(null);setRequestId(clientId())
    try{
      const next=await api<EventDetail>(`/events/${id}?domain=${d}`,undefined,'GET',signal)
      if(!signal.aborted){setDetail(next);history.replaceState(null,'',eventHash(id,d))}
    }catch(e){
      if(signal.aborted)return
      if(e instanceof ApiError&&(e.status===403||e.status===404))closeUnavailableEvent(id,d)
      throw e
    }
  }
  async function initSession(){
    const signal=requests.session.begin();requests.lists.cancel();requests.detail.cancel()
    const session=await api<{user:User}|null>('/auth/get-session',undefined,'GET',signal)
    if(!session?.user){if(!signal.aborted)clearSession();return}
    const [me,list,contacts]=await Promise.all([api<{role:string}>('/me',undefined,'GET',signal),api<EventRecord[]>('/events',undefined,'GET',signal),api<typeof people>('/people',undefined,'GET',signal)])
    if(signal.aborted)return
    setUser(session.user);setRole(me.role);setEvents(list);setPeople(contacts)
    const route=parseEventLink(location.hash)
    if(route)try{await openEvent(route.id,route.domain)}catch(e){if(signal.aborted)return;setSelected(null);selectedRef.current=null;setDetail(null);setView('relationships');setError(e instanceof Error?e.message:'无法打开这件事')}
    return list
  }
  useEffect(()=>{
    let active=true
    const controller=new AbortController()
    const report=(e:unknown)=>{if(active&&!(e instanceof Error&&e.name==='AbortError'))setError(e instanceof Error?e.message:'连接未完成，请重试')}
    Promise.allSettled([initSession().catch(report),api<typeof status>('/status',undefined,'GET',controller.signal).then(data=>{if(active)setStatus(data)}).catch(report)]).finally(()=>{if(active)setStarting(false)})
    return()=>{active=false;controller.abort();requests.session.cancel();requests.lists.cancel();requests.detail.cancel();voiceAbort.current?.abort();recorder.current?.stream.getTracks().forEach(t=>t.stop());if(recordTimeout.current)clearTimeout(recordTimeout.current)}
  },[])
  useEffect(()=>{
    if(starting)return
    const open=()=>{
      const token=parseInviteHash(location.hash)
      if(!token)return
      const signal=requests.invitation.begin()
      setInvitation(null);setError('')
      loadInvitation(token,signal).catch(e=>{if(!signal.aborted)setError(e instanceof Error?e.message:'无法读取邀请，请重试')})
    }
    open();window.addEventListener('hashchange',open)
    return()=>{window.removeEventListener('hashchange',open);requests.invitation.cancel()}
  },[starting,user?.id])
  useEffect(()=>{
    if(!deviceReminders||!user)return
    if(!remindersOn){syncDeviceReminders('',[]);return}
    const controller=new AbortController()
    api<Reminder[]>('/followups/reminders',undefined,'GET',controller.signal)
      .then(entries=>{if(!controller.signal.aborted)syncDeviceReminders(user.id,entries)})
      .catch(()=>{}) // Keep the last device schedule while offline.
    return()=>controller.abort()
  },[user?.id,deviceReminders,remindersOn,people])
  async function toggleReminders(){
    if(!user)return
    const enabled=!remindersOn
    if(enabled&&!await allowDeviceReminders())throw new Error('请在系统设置中允许 Reso 发送通知后重试。')
    rememberReminders(user.id,enabled);setReminderSetting({account:user.id,enabled})
    if(!enabled)syncDeviceReminders('',[])
  }
  useEffect(()=>{pendingReplies.current.clear()},[user?.id])
  useEffect(()=>{
    const latest=detail?.messages.at(-1)
    if(latest?.role==='user')pendingReplies.current.add(String(latest.id))
  },[detail?.messages.at(-1)?.id])
  useEffect(()=>{
    setReplyConnectionLost(false)
    if(!user||detail?.messages.at(-1)?.role!=='user'||!['pending','running'].includes(detail.reply_state))return
    let active=true
    const timer=setInterval(()=>{if(!document.hidden)refresh().then(()=>{if(active)setReplyConnectionLost(false)}).catch(()=>{if(active)setReplyConnectionLost(true)})},2000)
    return()=>{active=false;clearInterval(timer)}
  },[user?.id,selected,domain,detail?.messages.at(-1)?.id,detail?.reply_state])
  useEffect(()=>{
    if(!user)return
    let source:EventSource|null=null,timer:ReturnType<typeof setInterval>|undefined
    const update=()=>{if(!document.hidden)refresh().catch(()=>{})}
    const stop=()=>{source?.close();source=null;clearInterval(timer)}
    const connect=()=>{
      stop()
      if(document.hidden)return
      source=new EventSource('/api/stream')
      source.addEventListener('ready',update);source.addEventListener('update',update)
      timer=setInterval(update,15000)
    }
    connect();document.addEventListener('visibilitychange',connect);window.addEventListener('focus',update)
    return()=>{stop();document.removeEventListener('visibilitychange',connect);window.removeEventListener('focus',update)}
  },[user?.id])
  useEffect(()=>{
    if(!user)return
    const openLink=()=>{const route=parseEventLink(location.hash);if(route)action(()=>openEvent(route.id,route.domain))}
    window.addEventListener('hashchange',openLink);return()=>window.removeEventListener('hashchange',openLink)
  },[user?.id])
  const readyEventId=detail?.event.id
  useLayoutEffect(()=>{
    const node=scroll.current
    if(view!=='chat'){node?.scrollTo({top:0,behavior:'instant'});return}
    if(!selected||readyEventId!==selected||!node)return
    lastChat.current={id:selected,domain}
    const position=chatPositions.current.get(`${selected}:${domain}`)
    node.scrollTo({top:position===Infinity?node.scrollHeight:position??0,behavior:'instant'})
  },[starting,view,selected,domain,readyEventId])
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3000);return()=>clearTimeout(timer)},[toast])

  async function signOut(){
    await api('/auth/sign-out',{})
    if(parseEventLink(location.hash))history.replaceState(null,'',location.pathname+location.search)
    clearSession()
  }
  async function authenticate(e:FormEvent){
    e.preventDefault()
    if(register&&!name.trim()){setError('请填写称呼');return}
    if(!email.trim()||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('请填写有效的邮箱地址');return}
    if(password.length<10){setError('密码至少需要 10 位');return}
    await action(async()=>{
      await api(register?'/auth/sign-up/email':'/auth/sign-in/email',{email:email.trim(),password,...(register?{name:name.trim()}: {})})
      setPassword('');const list=await initSession();setSheet(null)
      if(list&&!list.length&&!invitation&&!parseInviteHash(location.hash))await openNewEvent('和 Reso 聊聊')
    })
  }
  async function openNewEvent(eventTitle:string){const created=await api<EventRecord>('/events',{title:eventTitle});await openEvent(created.id);setEvents(await api<EventRecord[]>('/events'));setTitle('')}
  async function createEvent(){await action(()=>openNewEvent(title.trim()||'和 Reso 聊聊'))}
  async function startChat(){
    const own=events.find(event=>event.id===selected&&event.is_owner)||events.find(event=>event.is_owner)
    if(own){
      if(selected===own.id&&domain==='private'&&detail){navigate('chat',true);return}
      await openEvent(own.id,'private')
    }else await openNewEvent('和 Reso 聊聊')
    navigate('chat',true)
  }
  async function resumeChat(){
    const previous=lastChat.current
    if(!previous||!events.some(event=>event.id===previous.id)){await startChat();return}
    if(selected!==previous.id||domain!==previous.domain||!detail)await openEvent(previous.id,previous.domain)
    navigate('chat',true)
  }
  async function send(e:FormEvent){e.preventDefault();if(!selected||!detail||!draft.trim()||busy||roomReadOnly)return;await action(async()=>{const message=await api<ChatMessage>(`/events/${selected}/messages`,{content:draft.trim(),domain,clientId:requestId});pendingReplies.current.add(String(message.id));setDraft('');setRequestId(clientId());await refresh();requestAnimationFrame(()=>scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}))})}
  function followReply(){const element=scroll.current;if(element&&element.scrollHeight-element.scrollTop-element.clientHeight<100)element.scrollTop=element.scrollHeight}
  async function saveExercise(change:Partial<Exercise>){
    if(!selected)return false
    const savingStory=change.saved===true&&change.story!==undefined
    return action(async()=>{
      const version=savingStory&&storyEditor.dirty?storyEditor.revision:exercise.version
      await api(`/events/${selected}/exercise`,{...exercise,...change,version},'PUT')
      if(savingStory)storyEditor.saved(version+1)
      else if(storyEditor.dirty&&!storyConflict)storyEditor.rebase(version+1)
      await refresh()
      if(savingStory)setToast('故事已保存到我的成长卡片')
      else if(change.notes)setToast('私人练习已保存')
    })
  }
  async function saveAnswer(value:number){if(!selected)return;await action(async()=>{
    const answers=[...(detail?.questionnaire?.answers||Array(24).fill(null))];answers[question]=value
    await api(`/events/${selected}/questionnaire`,{answers,version:scqaVersion,revision:detail?.questionnaire?.revision||0},'PUT');await refresh()
  })}
  async function confirmDiscovery(accepted:boolean){
    if(!selected)return
    await action(async()=>{
      const revision=detail?.questionnaire?.revision||0
      await api(`/events/${selected}/discovery`,{accepted,summary:accepted?findingEditor.values.text.trim():'',revision:accepted&&findingEditor.dirty?findingEditor.revision:revision})
      if(accepted)findingEditor.saved(revision+1)
      else findingEditor.reset()
      await refresh()
      setToast(accepted?'已保存你确认的理解':'已放下这个猜测，不会作为确认事实使用')
    })
  }
  async function loadInvitation(token:string,signal?:AbortSignal){
    const preview=await api<InvitationPreview>(`/invites/${token}`,undefined,'GET',signal)
    if(signal?.aborted)return
    setInvitation({token,...preview})
    setSheet(current=>current==='open-invite'?null:current)
    setPastedInvite('')
    if(user){
      const details=await api<InvitationPreview>(`/invites/${token}/details`,undefined,'GET',signal)
      if(!signal?.aborted)setInvitation({token,...details})
    }
  }
  async function openPastedInvitation(e:FormEvent){
    e.preventDefault()
    const token=parseInvitationLink(pastedInvite,location.origin)
    if(!token){setError('请粘贴当前 Reso 服务生成的完整邀请链接');return}
    await action(()=>loadInvitation(token,requests.invitation.begin(requests.session.signal)))
  }
  function openScannedInvitation(link:string){
    const token=parseInvitationLink(link,location.origin)
    if(!token)return false
    void action(()=>loadInvitation(token,requests.invitation.begin(requests.session.signal)))
    return true
  }
  async function setContactCategory(id:string,category:ContactCategory){
    await action(async()=>{
      await api(`/people/${encodeURIComponent(id)}/category`,{category},'PUT')
      setPeople(people=>people.map(connection=>connection.user_id===id?{...connection,category}:connection))
      setToast('已更新联系人分类')
    })
  }
  async function inviteResponse(accept:boolean){if(!invitation)return;await action(async()=>{const result=await api<{eventId:string}>(`/invites/${invitation.token}/respond`,{accept});setInvitation(null);history.replaceState(null,'',location.pathname);if(accept)await openEvent(result.eventId,'room');else setToast('已拒绝邀请，不会加入房间')})}
  function openSummaryEditor(){
    if(!detail)return
    setTitle(detail.event.title);setSummary(detail.event.summary);setShare(false);setSheet('summary')
  }
  async function exportData(id=selected){if(!id)return;await action(async()=>{const data=await api(`/events/${id}/export`),result=await exportRecord(data);setToast(result==='saved'?'记录已导出':result==='cancelled'?'已取消导出':'已发起下载，请查看浏览器下载记录')})}

  async function loadSavedRecords(offset=0){
    const page=await api<SavedRecordPage>(`/me/records?offset=${offset}`,undefined,'GET',requests.session.signal)
    setRecordPage(previous=>offset&&previous?{records:[...previous.records,...page.records.filter(record=>!previous.records.some(existing=>existing.id===record.id&&existing.kind===record.kind))],nextOffset:page.nextOffset}:page)
  }
  async function openSavedRecords(){navigate('records');setRecordPage(null);await loadSavedRecords()}
  async function openSavedRecord(record:SavedRecord){
    await openEvent(record.event_id,'private',({story:'story',nvc:'nvc',roleplay:'roleplay',followup:'memory'} as const)[record.kind])
  }
  async function loadConsultants(need=''){
    const list=await api<Consultant[]>(need?`/consultants?need=${encodeURIComponent(need)}`:'/consultants')
    setConsultants(list);setConsultantNeed(need);setAppliedNeed(need)
  }
  async function openGrowth(){setFollowups(await api<Followup[]>('/followups'));navigate('growth')}
  async function openCounselor(){setCounselorApplications(await api<Application[]>('/counselor/applications'));navigate('counselor')}
  function requestLogout(){if(user&&hasDrafts(user.id))setSheet('logout');else void action(signOut)}

  async function startRecording(){
    setError('')
    if(!window.isSecureContext){setError('录音需要安全连接，请在电脑 localhost 使用，或为手机配置 HTTPS');return}
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const media=new MediaRecorder(stream);const chunks:BlobPart[]=[];recorder.current=media
      media.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      media.onstop=()=>{stream.getTracks().forEach(t=>t.stop());setRecording(false);setAudioBlob(new Blob(chunks,{type:media.mimeType}));if(recordTimeout.current)clearTimeout(recordTimeout.current)}
      media.start();setAudioBlob(null);setRecording(true);recordTimeout.current=setTimeout(()=>media.state==='recording'&&media.stop(),60000)
    }catch{setError('无法使用麦克风，请检查权限或改用文字输入')}
  }
  function stopRecording(){if(recorder.current?.state==='recording')recorder.current.stop()}
  function closeSheet(){
    if(busy){setToast('正在处理，请稍候');return}
    if(sheet==='discard'){setSheet(discardSheet);return}
    if(sheet==='logout'){setSheet(null);return}
    const changed=sheet==='summary'?(title!==detail?.event.title||summary!==detail?.event.summary):sheet==='edit-act'?correction!==(exercise.notes[String(exercise.act)]||''):sheet==='perspective'?correction!==(mePerspective?.text||''):false
    if(changed){setDiscardSheet(sheet);setSheet('discard');return}
    if(sheet==='voice'){stopRecording();voiceAbort.current?.abort();setVoiceBusy(false)}
    setSheet(null)
  }
  async function recognize(){if(!audioBlob)return;const event=selectedRef.current,scope=domainRef.current;setVoiceBusy(true);setError('');const controller=new AbortController();voiceAbort.current=controller
    let context:AudioContext|null=null
    try{context=new AudioContext();const decoded=await context.decodeAudioData(await audioBlob.arrayBuffer());if(decoded.duration>60.5)throw new Error('录音不能超过60秒')
      const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const rendered=await offline.startRendering(),samples=rendered.getChannelData(0),pcm=new ArrayBuffer(samples.length*2),data=new DataView(pcm)
      for(let i=0;i<samples.length;i++){const n=Math.max(-1,Math.min(1,samples[i]));data.setInt16(i*2,n<0?n*32768:n*32767,true)}
      const form=new FormData();form.append('audio',new Blob([pcm],{type:'application/octet-stream'}),'recording.pcm')
      const response=await fetch('/api/asr',{method:'POST',body:form,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(100000)])}),result=await response.json();if(!response.ok)throw new Error(result.error||'转写未完成')
      if(!controller.signal.aborted&&selectedRef.current===event&&domainRef.current===scope){setDraft(prev=>prev+(prev?'\n':'')+result.text);setSheet(null);setAudioBlob(null);setToast('文字已放入输入框，请核对后发送')}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'转写未完成，请重试')}finally{await context?.close();setVoiceBusy(false)}
  }

  function chatView(){return<>
    {roomReadOnly&&<p className="room-closed-status" role="status">本次会谈已结束 · 历史记录仍可查看</p>}
    {domain==='room'&&detail&&<details className="shared-preview"><DisclosureSummary>谁能看到这里的消息（{detail.members.length+1}人）</DisclosureSummary><p>{[owner?'你（发起人）':people.find(person=>person.user_id===detail.event.owner_id)?.name||'事件发起人',...detail.members.map(member=>member.user_id===user?.id?'你':member.name)].join('、')}</p><p className="fineprint">房间成员和 Reso 可以读取这里的聊天。私人聊天、问卷和故事不共享。</p></details>}
    {domain==='room'&&detail?.shared_notes.map(note=><Card key={note.application_id} title="单独向你分享的咨询纪要" icon={<ShieldCheck/>}><p>{note.content}</p><p className="fineprint">版本 {note.source_version} · 不会自动用于房间里的 AI 回复</p></Card>)}
    {domain==='room'&&detail?.snapshots.map((snapshot,i)=><Card key={i} title={owner?`你向${detail.members.find(member=>member.user_id===snapshot.user_id)?.name||'成员'}分享的摘要`:'向你分享的摘要'} icon={<ShieldCheck />}><p>{snapshot.content}</p><p className="fineprint">版本 {snapshot.version} · 分享于 {new Date(snapshot.granted_at).toLocaleString('zh-CN')} · 仅授权接收人可见，后续修改不自动共享</p></Card>)}
    {!detail?.messages.length&&<><Bubble>{domain==='private'?'可以从今天让你在意的一件小事说起。你想先聊聊什么？':'这里可以分别说说自己的感受。不急着得出同一个答案。'}</Bubble>{domain==='private'&&<p className="supporting-copy chat-tools-hint">需要一点思路时，可以点左下角的加号打开聊天工具。</p>}</>}
    {detail?.hasMore&&<Button secondary disabled={busy} onClick={()=>action(async()=>{const more=await api<MessagePage>(`/events/${selected}/messages?domain=${domain}&before=${detail.messages[0]?.id}`);setDetail(prev=>prev?{...prev,messages:[...more.messages,...prev.messages],hasMore:more.hasMore}:prev)})}>加载更早的消息</Button>}
    {detail?.messages.map(message=><div key={message.id} className={message.role==='user'&&message.author_id===user?.id?'message-wrap own-message':'message-wrap'}><MessageReasoning message={message}/><Bubble role={message.role==='user'&&message.author_id===user?.id?'user':message.role==='user'?'mom':'reso'} speaker={message.author_name}>{message.role==='assistant'&&message.author_name==='Reso'&&message.status==='complete'?<ProgressiveReply text={message.content} animate={message.card_type!=='safety'&&!!message.in_reply_to&&pendingReplies.current.has(String(message.in_reply_to))} onStart={()=>pendingReplies.current.delete(String(message.in_reply_to))} onChunk={followReply}/>:message.content}</Bubble>{message.card_type==='safety'&&safetyCard(true)}{message.agent_actions?.map(suggestion=><AgentSuggestion key={suggestion.id} suggestion={suggestion} eventId={selected!} userId={user!.id} busy={busy} perform={action} refresh={refresh} onOpen={method=>{if(selectedRef.current!==selected||domainRef.current!=='private')return;navigate(method==='narrative'?'exercise':method==='nvc'?'nvc':method==='roleplay'?'roleplay':suggestion.kind==='nvc'?'nvc':'memory')}}/>)}{!roomReadOnly&&<UnderstandingPrompt message={message} busy={busy} onCheck={()=>action(async()=>{await api(`/events/${selected}/understandings`,{domain,sourceMessageId:String(message.id)});await refresh();navigate('understandings')})}/>} {!roomReadOnly&&message.status==='error'&&<button className="text-button" disabled={busy} onClick={()=>action(async()=>{await api(`/events/${selected}/retry`,{domain});setToast('已提交重试，请稍候')})}>重试回复 <ArrowRight /></button>}</div>)}
    {detail?.messages.at(-1)?.role==='user'&&<ReplyProgress state={detail.reply_state} phase={detail.reply_progress?.phase} configured={status.agentConfigured} connectionLost={replyConnectionLost}/>}
    {detail?.reply_state==='error'&&detail.messages.at(-1)?.role==='user'&&<Button secondary disabled={busy} onClick={()=>action(async()=>{await api(`/events/${selected}/retry`,{domain});setToast('已提交重试')})}>重试回复</Button>}
  </>}

  function eventContent(){
    if(!detail)return busy?<p className="loading-copy" role="status">正在读取这件事…</p>:<Card title="暂时没能打开这件事" icon={<Info/>}><p>可以重新打开，或返回列表选择其他记录。</p><Button onClick={()=>action(()=>openEvent(selected!,domain))}>重新打开</Button><Button secondary onClick={()=>navigate('relationships')}>返回我的关系</Button></Card>
    switch(view){
      case'room-timeline':return <EventTimeline key={selected!} eventId={selected!} domain="room" version={detail.event.room_version}/>
      case'understandings':return <UnderstandingCards entries={detail.understandings} eventId={selected!} userId={user!.id} busy={busy||roomReadOnly} perform={action} refresh={refresh} onStart={()=>navigate('chat')}/>
      case'nvc':case'roleplay':return <PracticeFields key={`${selected}:${view}`} kind={view} exercise={exercise} eventId={selected!} userId={user!.id} busy={busy} perform={action} refresh={refresh}/>
      case'questionnaire':return<><Card className="question-card"><div className="mini-row"><span>SCQA · 研究参考</span><span>{question+1}/24</span></div><div className="progress"><span style={{width:`${(question+1)/24*100}%`}}/></div><h2>{scqaItems[question]}</h2><fieldset className="answer-grid"><legend className="sr-only">选择符合程度</legend>{scqaOptions.map((label,index)=><label key={label} className={`answer ${detail.questionnaire?.answers[question]===index+1?'selected':''}`}><input type="radio" name="scqa" disabled={busy} checked={detail.questionnaire?.answers[question]===index+1} onChange={()=>saveAnswer(index+1)}/><span className="answer-number">{index+1}</span><span>{label}</span>{detail.questionnaire?.answers[question]===index+1&&<Check aria-hidden="true"/>}</label>)}</fieldset><div className="two-actions"><Button secondary disabled={busy||question===0} onClick={()=>setQuestion(n=>n-1)}>上一题</Button><Button disabled={busy||!detail.questionnaire?.answers[question]} onClick={()=>{if(question<23)setQuestion(n=>n+1);else navigate('discovery')}}>{question<23?'下一题':'看看结果'} <ArrowRight/></Button></div><p className="fineprint">研究题本未经正式验证，不用于诊断。</p></Card><Button secondary onClick={()=>navigate('chat')}>先不回答，继续聊聊</Button></>
      case'discovery': {
        const result=detail.questionnaire
        if(!result?.scores)return <Card title="先慢慢了解自己"><p>问卷未完成，进度已保存。</p><Button onClick={openQuestionnaire}>接着回答 <ArrowRight/></Button></Card>
        const reviewed=result.state==='accepted'||result.state==='rejected'
        const review=<>
          <p>{result.discovery}</p>
          <details className="score-details"><DisclosureSummary>查看分量表得分</DisclosureSummary><p>八项分别计分，不合并总分。</p>
            {scales.map(scale=><div className="score-row" key={scale.id}><span>{scale.name}</span><strong>{result.scores![scale.id].toFixed(2)} / 6</strong></div>)}
          </details>
          <label className="field-label" htmlFor="finding-summary">如果像你，你想留下怎样的理解？</label>
          <textarea disabled={busy} id="finding-summary" className="mvp-textarea" value={findingEditor.values.text} onChange={e=>findingEditor.update({text:e.target.value})} maxLength={1000}/>
          {findingEditor.dirty&&<p className="draft-status" role="status">理解草稿已保留，尚未确认</p>}
          {findingConflict&&<div className="draft-conflict" role="alert"><p>问卷或理解已有更新，请核对上方最新发现。你的草稿仍保留。</p>
            <div className="two-actions"><Button secondary onClick={findingEditor.reset}>使用最新发现</Button><Button secondary onClick={()=>findingEditor.rebase()}>已核对，保留我的草稿</Button></div>
          </div>}
          <div className="two-actions"><Button secondary disabled={busy} onClick={()=>confirmDiscovery(false)}>不太像我</Button>
            <Button disabled={busy||findingConflict||!findingEditor.values.text.trim()} onClick={()=>confirmDiscovery(true)}>确认这份理解 <Check/></Button></div>
          <Button secondary onClick={()=>{setQuestion(0);navigate('questionnaire')}}>查看已填写答案</Button>
          <p className="fineprint">仅将确认的摘要用于后续对话。</p>
        </>
        return <Card title={result.state==='accepted'?'我确认过的小发现':'一个小发现'} icon={<Sparkles/>}>
          {reviewed?<div className="discovery-next">
            <p className="personal-text">{result.state==='accepted'?result.confirmed_summary:'你选择放下这次问卷给出的发现。'}</p>
            <p className="supporting-copy">如果愿意，可以从刚才聊的那件事出发，慢慢写下自己的故事。</p>
            <Button disabled={busy} onClick={()=>navigate('exercise')}>{exercise.act>0&&!exercise.saved?'继续叙事小练习':'做个叙事小练习'} <ArrowRight/></Button>
            <Button secondary disabled={busy} onClick={()=>navigate('chat')}>回到对话</Button>
            <details className="score-details discovery-review"><DisclosureSummary>重新核对问卷结果</DisclosureSummary>{review}</details>
          </div>:review}
        </Card>
      }
      case'exercise': {
        const current=acts[exercise.act]
        return <>
          <ExerciseProgress act={exercise.act} disabled={busy} onSelect={act=>{void saveExercise({act,paused:false})}}/>
          <Bubble>{practiceWriting[exercise.act].prompt}</Bubble>
          {exercise.act===0&&detail.event.initial_summary&&<Card title="我确认过的小发现" icon={<Sparkles/>}>
            <p className="personal-text">{detail.event.initial_summary}</p>
          </Card>}
          <section className="story-card">
            <div className="story-title"><span>{current.chapter}</span><h2>{current.title}</h2></div>
            {(exercise.act===5?exercise.story:exercise.notes[String(exercise.act)])?.trim()
              ?<StoryArtwork text={exercise.act===5?exercise.story:exercise.notes[String(exercise.act)]} chapter={exercise.act}/>
              :<img className="story-art" src={image(current.image)} alt=""/>}
            <div className="story-body">
              {exercise.notes[String(exercise.act)]&&<p className="personal-text">{exercise.notes[String(exercise.act)]}</p>}
              {exercise.act===5&&<>
                <label className="field-label" htmlFor="my-story">用自己的话写下故事</label>
                <textarea disabled={busy} id="my-story" className="mvp-textarea" value={storyDraft??exercise.story} onChange={e=>setStoryDraft(e.target.value)} placeholder="我想对这样的自己说…" maxLength={4000}/>
                <SaveStatus saved={!storyEditor.dirty&&exercise.saved}>{storyEditor.dirty?'故事草稿已保留，尚未保存到记录':exercise.saved?'故事已保存，仅自己可见':''}</SaveStatus>
                {storyConflict&&<div className="draft-conflict" role="alert"><p>练习记录已有更新，请核对后保存故事。你的草稿仍保留。</p>
                  <details><DisclosureSummary>核对最新保存的故事</DisclosureSummary><p>{exercise.story||'暂无已保存故事'}</p></details>
                  <div className="two-actions"><Button secondary onClick={storyEditor.reset}>使用已保存故事</Button><Button secondary onClick={()=>storyEditor.rebase()}>已核对，保留我的草稿</Button></div>
                </div>}
              </>}
              {exercise.act===0&&<p className="muted">练习插图仅作示意。</p>}
              {exercise.paused?<><p className="pause-notice"><Pause/>已暂停</p><Button disabled={busy} onClick={()=>saveExercise({paused:false})}>接着看看 <ArrowRight/></Button></>
                :<div className="two-actions">
                  <Button secondary disabled={busy} onClick={()=>{setCorrection(exercise.notes[String(exercise.act)]||'');setSheet('edit-act')}}>我想修改</Button>
                  <Button disabled={busy||(exercise.act===5&&(storyConflict||!(storyDraft??exercise.story).trim()))} onClick={async()=>{
                    if(exercise.act<5)await saveExercise({act:exercise.act+1})
                    else if(await saveExercise({story:storyDraft??exercise.story,saved:true}))navigate('story')
                  }}>{exercise.act===0?'开始第一幕':exercise.act===5?'保存我的故事':'继续下一幕'} <ArrowRight/></Button>
                </div>}
            </div>
          </section>
          <div className="practice-controls">
            <button disabled={busy||exercise.act===0} onClick={()=>saveExercise({act:exercise.act-1})}><ChevronLeft/>上一幕</button>
            <button disabled={busy} onClick={()=>saveExercise({paused:true})}><Pause/>暂停</button>
            <button disabled={busy} onClick={async()=>{if(await saveExercise({paused:true}))navigate('chat')}}>下次接着聊</button>
          </div>
        </>
      }
      case'story': return exercise.saved&&exercise.story.trim()?<>
        <article className="saved-story-card">
          <div className="saved-story-heading"><Sparkles aria-hidden="true"/><span>已保存</span></div>
          <h2>{detail.event.title}</h2>
          <StoryArtwork text={exercise.story} chapter={5}/>
          <p className="personal-text">{exercise.story}</p>
        </article>
        <Button disabled={busy} onClick={()=>navigate('chat')}>回到这件事的对话 <ArrowRight/></Button>
        <Button secondary disabled={busy} onClick={()=>navigate('memory')}>查看这件事的记录</Button>
      </>:<Card title="这件事暂无已保存故事" icon={<Info/>}><Button secondary onClick={()=>navigate('relationships')}>返回我的关系</Button></Card>
      case'memory':return<><EventTimeline key={selected!} eventId={selected!} domain="private" version={detail.event.private_version}/><Card title="这件事，我想怎样记录" icon={<FileText/>}><h3 className="block-heading">{detail.event.title}</h3><p>{detail.event.summary||'还没有摘要'}</p><Button secondary onClick={openSummaryEditor}><Pencil/>修改事件与摘要</Button>{detail.event.initial_summary&&<><h3 className="block-heading">我确认过的小发现</h3><p>{detail.event.initial_summary}</p></>}{exercise.saved&&<><h3 className="block-heading">我的故事</h3><p className="saved-story">{exercise.story}</p></>}<div className="two-actions"><Button disabled={busy} onClick={()=>navigate('invite')}>邀请一起聊 <ArrowRight/></Button><Button secondary onClick={()=>exportData()}><Download/>导出记录</Button></div></Card><FollowupForm key={`${user!.id}:${selected}`} eventId={selected!} userId={user!.id} entries={detail.followups} busy={busy} perform={action} refresh={refresh}/></>
      case'invite':return<>{roomClosed?<Card title="会谈已结束" icon={<UsersRound/>}><p>可以查看会谈记录，或撤回已分享的摘要。</p></Card>:<Card title="邀请一个重要的人" icon={<UsersRound/>}><h3>{detail.event.room_title||detail.event.title}</h3><p className="fineprint">会谈标题对受邀者可见。私人摘要版本 {detail.event.summary_version}</p><p>{detail.event.summary||'未填写摘要，仍可邀请'}</p><Button secondary disabled={busy} onClick={openSummaryEditor}>{detail.event.summary.trim()?'编辑要分享的摘要':'整理要分享的摘要'} <Pencil/></Button><p className="supporting-copy">私人故事不会自动成为分享摘要。保存摘要后，仍需勾选“分享当前摘要”才会随邀请发送；也可以不附摘要邀请。</p><label className="check-row"><input type="checkbox" checked={share} disabled={!detail.event.summary} onChange={e=>setShare(e.target.checked)}/><span>分享当前摘要<small>不含私聊、问卷和故事</small></span></label><Button disabled={busy} onClick={()=>action(async()=>{const result=await api<{token:string}>(`/events/${selected}/invites`,{shareSummary:share,version:detail.event.summary_version,clientId:inviteRequestId.current});inviteRequestId.current=clientId();setInviteLink(`${location.origin}/#invite/${result.token}`);await refresh()})}>生成邀请链接 <Link/></Button>{inviteLink&&<div className="invite-link-result"><label className="field-label" htmlFor="invitation-link">{localLinks?'本机邀请链接':'邀请链接'}</label><input id="invitation-link" readOnly value={inviteLink}/><Button secondary onClick={async()=>{try{await navigator.clipboard.writeText(inviteLink);setToast('已复制邀请链接')}catch{setToast('请长按链接输入框复制')}}}>{localLinks?'复制本机链接':'复制链接'}</Button><Button secondary onClick={()=>setSheet('invite-qr')}>显示邀请二维码</Button></div>}<p className="fineprint">7天有效 · 受邀者确认后加入</p>{localLinks&&<p className="fineprint">此链接仅供当前电脑及已连接的模拟器使用，其他设备暂时无法打开。</p>}</Card>}{detail.invites.length>0&&<Card title="邀请状态">{detail.invites.map(invite=><section className="workflow-entry" key={invite.id}><div className="request-row"><span>{invite.recipient_name||'等待受邀者'} · {{pending:'待加入',accepted:'已接受',declined:'已拒绝',cancelled:'已取消',expired:'已过期'}[invite.status]||invite.status}</span>{invite.status==='pending'&&<button className="text-button" disabled={busy} onClick={()=>action(async()=>{await api(`/events/${selected}/invites/${invite.id}`,undefined,'DELETE');await refresh()})}>取消</button>}</div>{invite.shared_content&&<details className="shared-preview"><DisclosureSummary>查看此邀请附带的摘要</DisclosureSummary><p>{invite.shared_content}</p><p className="fineprint">版本 {invite.source_version} · 创建于 {new Date(invite.created_at).toLocaleString('zh-CN')}</p><p className="fineprint">仅表示此邀请当时附带的内容，成员当前权限以“已加入的人”中的分享状态为准。</p></details>}</section>)}</Card>}{detail.members.length>0&&<ShareMembers members={detail.members} snapshots={detail.snapshots} currentVersion={detail.event.summary_version} busy={busy} canShare={!roomClosed&&!!detail.event.summary.trim()} onShare={recipient=>{setShare(false);setShareRecipient(recipient);setSheet('share')}} onWithdraw={recipient=>{void action(async()=>{await api(`/events/${selected}/shares/${recipient}`,undefined,'DELETE');await refresh();setToast('已撤回摘要分享，对方仍可在房间聊天')})}} onRemove={recipient=>{setRemoveMember(recipient);setSheet('remove-member')}}/>}<label className="field-label" htmlFor="room-link">房间直达链接<input id="room-link" readOnly value={`${location.origin}/${eventHash(selected!,'room')}`}/></label><p className="fineprint">直达链接不授予加入权限，仅当前成员可访问。{localLinks?'此地址仅供本机使用。':''}</p><Button secondary disabled={busy} onClick={()=>action(()=>openEvent(selected!,'room'))}>进入房间聊天 <ArrowRight/></Button></>
      case'perspectives':return<><Card title="分别核对各自的感受" icon={<UsersRound/>}>{detail.perspectives.map(p=><div className="perspective-entry" key={p.user_id}><span>{p.name} · {p.confirmed?'本人已确认':'待本人核对'}</span><p>{p.text}</p></div>)}{!roomReadOnly&&<Button secondary onClick={()=>{setCorrection(mePerspective?.text||'');setSheet('perspective')}}>{mePerspective?'修改我的表达':'写下我的感受'} <Pencil/></Button>}{!roomReadOnly&&mePerspective&&!mePerspective.confirmed&&<Button disabled={busy} onClick={()=>action(async()=>{await api(`/events/${selected}/perspective`,{text:mePerspective.text,confirmed:true,version:mePerspective.version},'PUT');await refresh()})}>确认这是我的感受 <Check/></Button>}<p className="fineprint">各自确认自己的表达。</p></Card></>
      case'consultants':return <>
        <Card title="想找哪方面的支持？">
          <form className="consultant-search" onSubmit={event=>{
            event.preventDefault()
            void action(async()=>loadConsultants(consultantNeed.trim()))
          }}>
            <label className="field-label" htmlFor="consultant-need">支持方向<input id="consultant-need"
              value={consultantNeed} maxLength={80} onChange={event=>setConsultantNeed(event.target.value)} placeholder="例如亲子沟通、学业压力"/></label>
            <button type="submit" className="button secondary" disabled={busy}>查看匹配资料</button>
          </form>
        </Card>
        {consultants.length?<ConsultantMatches key={consultants.map(item=>item.id).join(':')} consultants={consultants} matched={!!appliedNeed} busy={busy}
          onSelect={item=>{setConsultant(item);setShare(false);navigate('applications')}}/>
          :<Card title={appliedNeed?'暂未找到匹配的咨询师':'暂无可申请的咨询师'}>
            {appliedNeed?<><p>可以换个关键词，或查看全部可申请的资料。</p><Button disabled={busy} onClick={()=>action(()=>loadConsultants())}>查看全部可申请的咨询师</Button></>:<p>你可以先继续和 Reso 整理这件事，之后再来看看。</p>}
            <Button onClick={()=>navigate('chat')}>回到对话</Button>
            <Button secondary onClick={()=>navigate('safety')}>查看其他支持方式</Button>
          </Card>}
      </>
      case'applications':return <>
        {consultant&&<Card title={`向${consultant.name}申请支持`} icon={<ShieldCheck/>}>
          <p>{consultant.test_only?'体验申请 · 用于验证流程':'老师接单后会提出时间，由你确认。'}</p>
          <div className="application-sharing">
            <p><strong>{share?'将分享下方确认摘要':'不分享私人摘要'}</strong></p>
            {share?<p className="personal-text">{detail.event.summary}</p>:<p className="supporting-copy">老师会看到你的称呼和申请。私人聊天、问卷和故事仅你可见。</p>}
            <label className="check-row"><input type="checkbox" checked={share} disabled={busy||!detail.event.summary.trim()}
              onChange={event=>setShare(event.target.checked)}/><span>分享当前摘要</span></label>
          </div>
          <Button disabled={busy} onClick={()=>action(async()=>{
            await api(`/events/${selected}/applications`,{
              consultantId:consultant.id,shareSummary:share,version:detail.event.summary_version,clientId:applicationRequestId.current,
            })
            applicationRequestId.current=clientId();setConsultant(null);setShare(false)
            await refresh();setToast('申请已提交，等待老师处理')
          })}>确认提交申请 <ArrowRight/></Button>
        </Card>}
        {(!consultant||detail.applications.length>0)&&<Card title="我的申请">
          {!detail.applications.length&&<>
            <p className="muted">还没有咨询申请。</p>
            <Button secondary disabled={busy} onClick={()=>action(async()=>{await loadConsultants();navigate('consultants')})}>了解真人支持</Button>
          </>}
          {detail.applications.map(a=><ClientApplication key={a.id} application={a} members={detail.members} busy={busy} perform={action} refresh={refresh}/>)}
        </Card>}
      </>
      case'safety':return safetyCard()
      default:return chatView()
    }
  }

  function safetyCard(inline=false){return<Card title="先让自己安全下来" icon={<Shield/>} className="safety-card"><p>先找一位信任的家人或老师陪着你。</p><div className="safety-notice">如果正处于即时危险，请优先联系当地紧急服务及身边可信任的成年人。</div><p className="fineprint">无实时人工值守，不能替代紧急救助。</p><p>也可以联系校园心理老师，或了解当前可用的专业支持。</p><Button secondary disabled={busy} onClick={()=>{if(!owner||domain==='room'){setSheet('people-support');return}void action(async()=>{await loadConsultants();navigate('consultants')})}}>了解专业支持</Button><Button secondary onClick={()=>navigate(inline?'safety':'chat')}>{inline?'查看安全支持':'回到对话'}</Button></Card>}


  if(starting)return<div className="app loading-screen"><img src={image('reso-empty')} alt="Reso"/><p>正在打开 Reso…</p></div>
  const welcomeNotice=sheet==='用户协议'||sheet==='隐私政策'||sheet==='监护人协助'?sheet:null
  return<>
    <div className={`app mvp-app ${user&&view==='chat'?'chat-app':''}`}>
      {!user?<MvpWelcome invitationTitle={invitation?.title} onStart={()=>setSheet('auth')}
        onNotice={notice=>{setError('');setSheet(notice)}}/>:<>
        <header className={`app-header${view==='relationships'?' people-header':''}`}>{view!=='relationships'&&<button className="icon-button back" aria-label="返回" disabled={busy} onClick={goBack}><ChevronLeft/></button>}<img className="header-mascot" src={image(view==='relationships'?'roadshow-relations/mascot':'reso-avatar')} alt=""/><div className="header-name"><h1>{view==='relationships'?'我的关系':view==='person'?(person?.name||'重要的人'):view==='chat'?(domain==='room'?'房间聊天':'Reso'):({profile:'我的',records:'我的记录',privacy:'隐私与数据',counselor:'专业支持',growth:'待回访',questionnaire:'初步了解',discovery:'一个小发现',exercise:'整理这件事',story:'我的故事',memory:'这件事的记录',invite:'邀请与分享','room-timeline':'会谈进展',perspectives:'分别核对感受',consultants:'真人支持',applications:'咨询申请',safety:'安全与支持',understandings:'核对理解',nvc:'写下我的表达',roleplay:'练习怎么开口'}[view])}</h1>{view!=='relationships'&&view!=='profile'&&<span>{view==='person'||(eventView&&domain==='room')?<UsersRound/>:<ShieldCheck/>}{view==='growth'?'仅自己可见':view==='person'?'共同参与的事件':eventView&&domain==='room'?'房间成员可见':'仅自己可见'}</span>}</div>{view==='relationships'&&<div className="people-header-actions"><button className="icon-button" aria-label={relationsTab==='people'?'搜索重要的人':'搜索聊过的事'} onClick={()=>document.getElementById('relations-search')?.focus()}><Search/></button><button className="icon-button" aria-label={relationsTab==='people'?'邀请重要的人':'记录新小事'} disabled={busy} onClick={()=>{setTitle('');setSheet(relationsTab==='people'?'people-add':'event')}}><Plus/></button></div>}{view==='chat'&&<><button ref={accountTrigger} className="icon-button more" aria-label="打开账户快捷入口" popoverTarget="account-shortcuts" disabled={busy}><UserRound/></button><div ref={accountMenu} id="account-shortcuts" className="account-shortcuts" popover="auto" aria-label="账户快捷入口" onBeforeToggle={event=>{if(event.newState==='open')positionAccountMenu()}}><button disabled={busy} onClick={()=>navigate('profile')}><UserRound/>我的</button><button disabled={busy} onClick={()=>navigate('safety')}><Shield/>安全与人工支持</button></div></>}</header>
        {error&&!sheet&&<div role="alert" className="mvp-error"><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError('')}><X/></button></div>}
        {invitation?<main className="mvp-panel"><Card title="有人邀请你聊一件事" icon={<UsersRound/>}><h3>{invitation.title}</h3>{invitation.inviter_name!==undefined?<><p>邀请人：{invitation.inviter_name||'未设置昵称的发起人'}</p><p className="supporting-copy">当前成员（含发起人）：{[invitation.inviter_name||'未设置昵称的发起人',...(invitation.member_names||[])].join('、')}</p><p className="supporting-copy">以上为账号昵称，请向对方确认邀请来源。</p></>:<><p className="supporting-copy" role="status">需要读取邀请人与成员信息后再加入。</p><Button secondary disabled={busy} onClick={()=>action(()=>loadInvitation(invitation.token))}>重新读取邀请信息</Button></>}<p>{invitation.has_summary?'已分享事件摘要':'未分享私人摘要'}</p><p className="muted">加入后，你的房间消息对当前及之后加入的房间成员可见，你也可以看到房间聊天历史。私人聊天、问卷和故事不共享。</p><div className="two-actions"><Button secondary disabled={busy} onClick={()=>inviteResponse(false)}>拒绝邀请</Button><Button disabled={busy||invitation.inviter_name===undefined} onClick={()=>inviteResponse(true)}>接受并加入 <ArrowRight/></Button></div></Card></main>:view==='relationships'?<main className={`relations-screen mvp-relations${relationsTab==='people'?' people-relations':''}`}>
          <div className="search-field"><Search/><input id="relations-search" aria-label={relationsTab==='events'?'搜索聊过的事':'搜索重要的人'} placeholder="搜索重要的人、聊过的事" value={search} onChange={e=>setSearch(e.target.value)}/>{relationsTab==='people'&&search&&<button className="icon-button" aria-label="清除搜索" onClick={()=>setSearch('')}><X/></button>}</div>
          <div className="tabs" role="tablist" aria-label="查找方式"><button role="tab" aria-selected={relationsTab==='events'} onClick={()=>setRelationsTab('events')}><MessageCircle/>一件小事</button><button role="tab" aria-selected={relationsTab==='people'} onClick={()=>setRelationsTab('people')}><UsersRound/>重要的人</button></div>
          <button className="text-button open-invitation" disabled={busy} onClick={()=>{setPastedInvite('');setSheet('open-invite')}}><Link aria-hidden="true"/>打开邀请</button>
          {relationsTab==='events'?<RelationshipEvents events={events} connections={people} search={search} busy={busy}
            onEvent={(id,scope)=>void action(()=>openEvent(id,scope))}
            onChat={()=>{setTitle('');setSheet('event')}} onRecords={()=>void action(openSavedRecords)}
            onStory={record=>void action(()=>openSavedRecord(record))} onClearSearch={()=>setSearch('')}/>
            :<PeopleOverview key={user.id} connections={people} search={search} busy={busy} onPerson={person=>{setPerson(person);navigate('person')}} onTopic={()=>setSheet('topics')} onSupport={()=>setSheet('people-support')} onApplication={id=>{void action(()=>openEvent(id,'private','applications'))}}/>}
        </main>:['profile','records','privacy'].includes(view)?<main className="mvp-panel profile-screen">
          {view==='profile'?<Profile user={user} busy={busy} hasLocalDrafts={hasDrafts(user.id)} counselor={role==='counselor'} onSaveName={nextName=>action(async()=>{const result=await api<{user:User}>('/me',{name:nextName},'PATCH');setUser(result.user);setToast('昵称已保存')})} onRecords={()=>action(openSavedRecords)} onGrowth={()=>action(openGrowth)} onPrivacy={()=>navigate('privacy')} onSafety={()=>navigate('safety')} onService={()=>setSheet('account')} onCounselor={()=>action(openCounselor)} onLogout={requestLogout}/>:view==='records'?<SavedRecords page={recordPage} busy={busy} onLoad={()=>action(()=>loadSavedRecords(recordPage?.nextOffset||0))} onOpen={record=>action(()=>openSavedRecord(record))} onStart={()=>navigate('relationships')}/>:<PrivacyData events={events} busy={busy} onExport={id=>exportData(id)}/>}
        </main>:view==='counselor'?<main className="mvp-panel"><div className="section-heading counselor-heading"><h2>待处理与服务记录</h2><button className="text-button" disabled={busy} onClick={()=>action(refresh)}>刷新申请</button></div>{!counselorApplications.length&&<p className="muted">暂无申请</p>}{counselorApplications.map(a=><CounselorApplication key={a.id} application={a} busy={busy} perform={action} refresh={refresh}/>)}</main>:<>
          {eventView&&<div className="conversation-status event-context"><button className="event-context-toggle" aria-label={`事件操作：${detail?.event.title||(busy?'正在读取':'暂时无法打开')}，${domain==='room'?'房间成员可见':'仅自己可见'}`} aria-haspopup="dialog" disabled={!detail||busy} onClick={()=>setSheet('event-menu')}><span className="event-context-title">{detail?.event.title||(busy?'正在读取这件事…':'这件事暂时无法打开')}</span><span className="compact-visibility">{domain==='room'?'房间成员可见':'仅自己可见'}</span><MoreHorizontal/></button></div>}
          <main ref={scroll} className="conversation"><div className="conversation-content">{view==='growth'?<>{deviceReminders&&<Card title="回访提醒"><p className="supporting-copy">在本机按你设定的回看时间发送通知。通知中不会出现记录内容，系统可能延后送达。</p><Button secondary disabled={busy} onClick={()=>action(toggleReminders)}>{remindersOn?'关闭本机提醒':'开启本机提醒'}</Button></Card>}<FollowupList pendingOnly entries={followups} onStart={()=>action(openSavedRecords)} busy={busy} perform={action} refresh={async()=>{setFollowups(await api<Followup[]>('/followups'));await refresh()}}/></>:view==='person'?<Card title={`和${person?.name||'重要的人'}一起聊过的事`}><p className="supporting-copy">房间消息对当前成员可见。</p>
            {person&&people.some(p=>p.user_id===person.id)&&<label className="field-label" htmlFor="contact-category">联系人分类 · 仅自己可见
              <select id="contact-category" value={people.find(p=>p.user_id===person.id)?.category??'uncategorized'}
                disabled={busy} onChange={event=>void setContactCategory(person.id,event.target.value as ContactCategory)}>
                {contactCategories.map(category=><option key={category} value={category}>{contactCategoryLabels[category]}</option>)}
              </select>
            </label>}
            {people.filter(p=>p.user_id===person?.id).map(p=><Button secondary key={p.event_id}
              onClick={()=>action(()=>openEvent(p.event_id,'room'))}>{p.event_title}{p.room_closed_at?' · 已结束':''}</Button>)}</Card>:view==='safety'?safetyCard():selected?eventContent():<Card title="从一件小事开始"><p>创建一件事，就可以开始私人聊天。不同事件分别保存。</p><Button disabled={busy} onClick={()=>action(()=>openNewEvent('和 Reso 聊聊'))}>开始私人聊天 <Plus/></Button></Card>}</div></main>
          {view==='chat'&&selected&&!roomReadOnly&&<form className="composer" onSubmit={send}><button type="button" className="icon-button tools-button" aria-label="打开聊天工具" disabled={busy||!detail} onClick={()=>setSheet('tools')}><Plus/></button><div className="composer-field"><input disabled={busy||!detail} autoComplete="off" aria-label={domain==='room'?'发送给房间成员的消息':'发送给 Reso 的消息'} placeholder="也可以直接告诉我…" value={draft} maxLength={4000} onChange={e=>{setDraft(e.target.value);setRequestId(clientId())}}/><button className="icon-button send-button" type="submit" aria-label="发送消息" disabled={busy||!detail||!draft.trim()}><Send/></button></div><button type="button" className="icon-button mic-button" aria-label="语音输入" disabled={busy||!detail} onClick={()=>setSheet('voice')}><Mic/></button></form>}
        </>}
        {!invitation&&<PrimaryNavigation className="bottom-nav" relationships={relationshipsActive} busy={busy}
          onReso={()=>{if(view!=='chat')void action(relationshipsActive?resumeChat:startChat)}}
          onRelationships={()=>{if(view!=='relationships')navigate('relationships',true)}}/>}
      </>}
      {!user&&error&&!sheet&&<div role="alert" className="mvp-error welcome-error">{error}</div>}{toast&&<div role="status" className="toast"><Check/>{toast}</div>}
    </div>
    {sheet&&<Dialog busy={busy} title={welcomeNotice??(sheet==='close-room'?'结束本次会谈？':sheet==='invite-qr'?'邀请二维码':sheet==='open-invite'?'打开会谈邀请':sheet==='remove-member'?'移出房间':sheet==='people-support'?'了解专业支持':sheet==='people-add'?'邀请重要的人':sheet==='topics'?'轻松聊一聊':sheet==='share'?'确认摘要分享':sheet==='auth'?(register?'创建账号':'登录 Reso'):sheet==='tools'?'聊天工具':sheet==='event-menu'?'这件事的操作':sheet==='discard'?'还有内容未保存':sheet==='logout'?'退出账号前':sheet==='event'?'记录一件小事':sheet==='summary'?'这件事，我想怎样记录':sheet==='edit-act'?'用你的话修改这一幕':sheet==='perspective'?'只确认自己的表达':sheet==='voice'?'把想说的话，慢慢说出来':sheet==='delete'?'删除这件事？':'服务状态')} onClose={closeSheet}>
      {welcomeNotice&&<div className="prose">{welcomeNotices[welcomeNotice].map(paragraph=><p key={paragraph}>{paragraph}</p>)}</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {sheet==='invite-qr'&&inviteLink&&<InvitationQr key={inviteLink} link={inviteLink}/>}
      {sheet==='close-room'&&<div className="prose">
        <p>结束后，当前成员仍可查看已有房间记录，未接受的邀请会失效。</p>
        <div className="two-actions">
          <Button secondary disabled={busy} onClick={closeSheet}>继续会谈</Button>
          <Button disabled={busy} onClick={()=>action(async()=>{
            await api(`/events/${selected}/close-room`,{})
            await refresh();setSheet(null);setToast('本次会谈已结束')
          })}>确认结束会谈</Button>
        </div>
      </div>}
      {sheet==='open-invite'&&<><form className="auth-form" onSubmit={openPastedInvitation}>
        <label className="field-label">邀请链接<input autoComplete="off" spellCheck={false} type="text" inputMode="url" value={pastedInvite}
          onChange={event=>{setPastedInvite(event.target.value);setError('')}} maxLength={1024} placeholder="粘贴对方发来的 Reso 链接"/></label>
        <button type="submit" className="button primary" disabled={busy||!pastedInvite.trim()}>{busy?'正在读取…':'查看邀请'} <ArrowRight/></button>
      </form><InvitationScanner accept={openScannedInvitation}/></>}
      {sheet==='remove-member'&&removeMember&&detail&&<div className="prose">
        <p>移出「{detail.members.find(member=>member.user_id===removeMember)?.name||'这位成员'}」后，对方将失去房间与已分享摘要的访问权限。</p>
        <p>尚未接受的邀请链接也会失效。需要发新邀请才能重新加入。</p>
        <div className="two-actions"><Button secondary disabled={busy} onClick={closeSheet}>保留成员</Button>
          <Button disabled={busy} onClick={()=>action(async()=>{
            await api(`/events/${selected}/members/${removeMember}`,undefined,'DELETE')
            setRemoveMember(null);setSheet(null);await refresh();setToast('已移出房间并撤回摘要分享')
          })}>确认移出</Button></div>
      </div>}
      {sheet==='share'&&<div className="prose"><p>向{detail?.members.find(m=>m.user_id===shareRecipient)?.name}分享以下摘要：</p><p>{detail?.event.summary}</p><p className="fineprint">仅分享当前版本，不含私聊、问卷和故事。</p><Button disabled={busy||!detail||!shareRecipient} onClick={()=>action(async()=>{await api(`/events/${selected}/shares/${shareRecipient}`,{version:detail!.event.summary_version},'PUT');await refresh();setSheet(null);setToast('已分享当前摘要')})}>确认分享 <ShieldCheck/></Button></div>}
      {sheet==='logout'&&<><p>退出会清除此设备尚未保存的草稿，已保存的记录不受影响。</p><div className="two-actions"><Button secondary onClick={()=>setSheet(null)}>返回当前页面</Button><Button onClick={()=>action(signOut)}>退出并清理草稿</Button></div></>}
      {sheet==='discard'&&<><p>离开会放弃这次尚未保存的修改。</p><div className="two-actions"><Button secondary onClick={()=>setSheet(discardSheet)}>继续编辑</Button><Button onClick={()=>{setSheet(null);setDiscardSheet(null)}}>放弃修改</Button></div></>}
      {sheet==='auth'&&<form className="auth-form" noValidate onSubmit={authenticate}><div className="tabs"><button type="button" disabled={busy} aria-pressed={!register} onClick={()=>{setRegister(false);setError('')}}>登录</button><button type="button" disabled={busy} aria-pressed={register} onClick={()=>{setRegister(true);setError('')}}>创建账号</button></div>{register&&<label className="field-label">怎么称呼你<input disabled={busy} required autoComplete="name" value={name} maxLength={50} onChange={e=>setName(e.target.value)}/></label>}<label className="field-label">邮箱<input disabled={busy} type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field-label">密码{register?'（至少 10 位）':''}<input disabled={busy} type="password" required minLength={10} autoComplete={register?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label><button type="submit" className="button primary" disabled={busy}>{busy?(register?'正在创建账号…':'正在登录…'):register?'创建账号':'登录'} <ArrowRight/></button></form>}
      {(sheet==='people-add'||sheet==='people-support')&&<><p className="dialog-description">{sheet==='people-add'?'选择一件你发起的事，在邀请页确认后再生成链接。不会自动分享私人聊天。':'选择一件想获得支持的小事，先查看支持资料，再决定是否申请。不会自动提交或分享。'}</p><div className="scene-list">{events.filter(e=>e.is_owner).map(e=><button key={e.id} disabled={busy} onClick={()=>action(async()=>{if(sheet==='people-add')await openEvent(e.id,'private','invite');else{await openEvent(e.id,'private','consultants');await loadConsultants()}})}><span>{e.title}</span><ChevronRight/></button>)}</div><Button secondary disabled={busy} onClick={()=>{setTitle('');setSheet('event')}}>先记录一件新小事 <Plus/></Button></>}
      {sheet==='topics'&&user&&<TopicCards connections={people} userId={user.id} onInvite={()=>setSheet('people-add')}/>}
      {sheet==='event'&&<><label className="field-label" htmlFor="new-event-title">给这件事起个名字</label><input disabled={busy} className="mvp-input" id="new-event-title" value={title} onChange={e=>setTitle(e.target.value)} maxLength={80} placeholder="比如：最近和妈妈的一次聊天"/><Button disabled={busy} onClick={()=>createEvent()}>创建并开始私聊 <ArrowRight/></Button></>}
      {sheet==='summary'&&<><label className="field-label" htmlFor="edit-event-title">事件名称</label><input disabled={busy} className="mvp-input" id="edit-event-title" value={title} maxLength={80} onChange={e=>setTitle(e.target.value)}/><label className="field-label" htmlFor="edit-summary">我确认的摘要</label><textarea disabled={busy} id="edit-summary" rows={5} value={summary} maxLength={3000} onChange={e=>setSummary(e.target.value)} placeholder="发生了什么？我的感受和希望是什么？"/><p className="fineprint">修改不会更新已分享的摘要。</p><Button disabled={busy||!title.trim()} onClick={()=>action(async()=>{await api(`/events/${selected}`,{title,summary,version:detail!.event.summary_version},'PATCH');await refresh();setSheet(null);setToast('已保存你的确认版本')})}>{busy?'正在保存…':'确认保存'} <Check/></Button></>}
      {sheet==='edit-act'&&<><label className="field-label" htmlFor="act-correction">这一幕更接近你的表达是？</label><textarea disabled={busy} id="act-correction" rows={5} placeholder={practiceWriting[exercise.act].caption} value={correction} maxLength={2000} onChange={e=>setCorrection(e.target.value)}/><Button disabled={busy||!correction.trim()} onClick={async()=>{if(await saveExercise({notes:{...exercise.notes,[exercise.act]:correction.trim()}})){setCorrection('');setSheet(null)}}}>{busy?'正在保存…':'保存这一幕'} <Check/></Button></>}
      {sheet==='perspective'&&<><label className="field-label" htmlFor="perspective-text">我想表达的感受与需要</label><textarea disabled={busy} id="perspective-text" rows={5} value={correction} maxLength={2000} onChange={e=>setCorrection(e.target.value)}/><Button disabled={busy||!correction.trim()} onClick={()=>action(async()=>{await api(`/events/${selected}/perspective`,{text:correction,confirmed:false,version:mePerspective?.version||0},'PUT');await refresh();setSheet(null)})}>{busy?'正在保存…':'保存为待核对表达'} <Check/></Button></>}
      {sheet==='tools'&&(domain==='private'?[
        {title:'了解自己',tools:[{view:'questionnaire',label:detail?.questionnaire?.scores?'查看初步了解':detail?.questionnaire?.answers.some(value=>value!==null)?'继续初步了解':'初步了解',icon:<Sparkles/>},{view:'understandings',label:'核对理解',icon:<Check/>}]},
        {title:'整理表达',tools:[{view:'exercise',label:exercise.act>0&&!exercise.saved?'继续整理这件事':'整理这件事',icon:<Heart/>},{view:'nvc',label:'写下我的表达',icon:<MessageCircle/>},{view:'roleplay',label:'练习怎么开口',icon:<UsersRound/>}]},
        {title:'一起沟通与支持',tools:[{view:'invite',label:'邀请一起聊',icon:<UsersRound/>},{view:'consultants',label:'真人支持',icon:<HandHeart/>},{view:'safety',label:'安全与求助',icon:<Shield/>}]},
      ]:[{title:'房间里的沟通',tools:[{view:'understandings',label:'核对理解',icon:<Check/>},{view:'perspectives',label:'双视角核对',icon:<UsersRound/>},{view:'safety',label:'安全与求助',icon:<Shield/>}]}]).map((group,index)=><section className={`tool-group${group.title==='整理表达'?' expression-tools':''}`} key={group.title}>{domain==='room'?<h3>{group.title}</h3>:<button className="tool-group-toggle disclosure-toggle" aria-expanded={toolGroup===group.title} aria-controls={`tool-group-${index}`} onClick={()=>setToolGroup(toolGroup===group.title?'':group.title)}><span>{group.title}</span><ChevronDown aria-hidden="true"/></button>}{(domain==='room'||toolGroup===group.title)&&<div id={`tool-group-${index}`} className="tool-list">{group.tools.map(tool=><button disabled={busy} key={tool.view} onClick={()=>action(async()=>{if(tool.view==='consultants')await loadConsultants();setCorrection('');if(tool.view==='questionnaire')openQuestionnaire();else navigate(tool.view as View)})}>{tool.icon}<span>{tool.label}</span><ChevronRight/></button>)}</div>}</section>)}

      {sheet==='event-menu'&&eventView&&detail&&<div className="scene-list"><p className="dialog-description">{detail.event.title}</p>{domain==='room'&&<div className="menu-section">
        <button disabled={busy} onClick={()=>navigate('room-timeline')}>查看会谈时间线 <FileText/></button>
        {roomReadOnly&&<button disabled={busy} onClick={()=>navigate('perspectives')}>查看双视角 <UsersRound/></button>}
        {owner&&detail.event.room_title&&!roomClosed&&<button disabled={busy} onClick={()=>setSheet('close-room')}>结束本次会谈 <Check/></button>}
      </div>}{owner?<><div className="menu-section"><button disabled={busy} onClick={openSummaryEditor}>修改事件名称与摘要 <Pencil/></button><button disabled={busy} onClick={()=>action(async()=>{if(domain==='room')await openEvent(selected!,'private');navigate('memory')})}>这件事的记录 <FileText/></button><button disabled={busy} onClick={()=>action(async()=>{if(domain==='room')await openEvent(selected!,'private');navigate('invite')})}>邀请与分享管理 <UsersRound/></button><button disabled={busy} onClick={()=>action(async()=>{if(domain==='room')await openEvent(selected!,'private');setConsultant(null);navigate('applications')})}>咨询申请状态 <HandHeart/></button><button disabled={busy} onClick={()=>action(()=>openEvent(selected!,domain==='private'?'room':'private'))}>{domain==='private'?'进入房间聊天':'回到私人聊天'} <ArrowRight/></button></div><div className="menu-section"><button disabled={busy} onClick={()=>setSheet('delete')}>删除“{detail.event.title}” <X/></button></div></>:<button disabled={busy} onClick={()=>action(async()=>{await api(`/events/${selected}/members/${user!.id}`,undefined,'DELETE');clearDrafts(user!.id,selected!);setSelected(null);selectedRef.current=null;setDetail(null);await refresh();navigate('relationships')})}>退出“{detail.event.title}” <LogOut/></button>}</div>}
      {sheet==='voice'&&<div className="voice-preview"><Mic/><p>转写为草稿，核对后发送。</p>{!status.asrConfigured&&<p className="form-error">语音转文字尚未配置，可以先用文字聊天。</p>}<Button disabled={!status.asrConfigured||voiceBusy} onClick={recording?stopRecording:startRecording}>{recording?'结束录音（最长60秒）':'开始录音'}</Button>{audioBlob&&!recording&&<><p className="fineprint">录音已就绪</p><Button disabled={voiceBusy} onClick={recognize}>{voiceBusy?'正在转写…':'转成可编辑文字'} <ArrowRight/></Button></>}</div>}
      {sheet==='account'&&<div className="prose"><p>AI 回复（DeepSeek）：{status.agentConfigured?'已配置，连通情况以实际请求为准':'尚未配置'}<br/>语音转文字（豆包）：{status.asrConfigured?'已配置，连通情况以实际请求为准':'尚未配置'}</p><p>体验版，非正式心理评估或咨询服务。</p><a className="button secondary" href="/?preview=1">查看 UI 演示 <ArrowRight/></a><a className="text-button centered" href="/?roadshow=1">体验 Reso <ArrowRight/></a></div>}
      {sheet==='delete'&&<div className="prose"><p>将删除“{detail?.event.title}”的全部相关记录并终止房间访问，无法恢复。</p><Button secondary disabled={busy} onClick={closeSheet}>先保留</Button><Button disabled={busy} onClick={()=>action(async()=>{await api(`/events/${selected}`,undefined,'DELETE');clearDrafts(user!.id,selected!);setSelected(null);selectedRef.current=null;setDetail(null);await refresh();navigate('relationships');setSheet(null)})}>确认删除这件事</Button></div>}
    </Dialog>}
  </>
}

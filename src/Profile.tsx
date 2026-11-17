import {useState} from 'react'
import {ChevronRight,Download,FileText,HandHeart,Info,LogOut,Pencil,Shield,UserRound} from 'lucide-react'
import {Button} from './components'
import type {EventRecord,SavedRecord,SavedRecordPage,User} from '../shared/types'

export function Profile({user,busy,hasLocalDrafts,counselor,onSaveName,onRecords,onGrowth,onPrivacy,onSafety,onService,onCounselor,onLogout}:{
  user:User;busy:boolean;hasLocalDrafts:boolean;counselor:boolean
  onSaveName:(name:string)=>Promise<boolean>;onRecords:()=>void;onGrowth:()=>void;onPrivacy:()=>void
  onSafety:()=>void;onService:()=>void;onCounselor:()=>void;onLogout:()=>void
}){
  const[editing,setEditing]=useState(false),[name,setName]=useState(user.name)
  return <>
    <section className="profile-identity" aria-label="个人资料">
      <div className="profile-avatar"><UserRound aria-hidden="true"/></div>
      <div><h2>{user.name}</h2><p>{user.email}</p></div>
      <button className="icon-button" aria-label="修改昵称" disabled={busy} onClick={()=>{setName(user.name);setEditing(!editing)}}><Pencil/></button>
    </section>
    {editing&&<form className="profile-editor" onSubmit={async event=>{event.preventDefault();if(name.trim()&&await onSaveName(name.trim()))setEditing(false)}}>
      <label className="field-label" htmlFor="profile-name">昵称<input id="profile-name" autoComplete="nickname" maxLength={50} required disabled={busy} value={name} onChange={event=>setName(event.target.value)}/></label>
      <p className="supporting-copy">昵称会在共同参与的房间中显示，历史消息保留发送时的称呼。邮箱用于登录。</p>
      <div className="two-actions"><Button secondary disabled={busy} onClick={()=>setEditing(false)}>取消修改</Button><button className="button primary" disabled={busy||!name.trim()||name.trim()===user.name}>{busy?'正在保存…':'保存昵称'}</button></div>
    </form>}
    <section className="profile-section" aria-labelledby="profile-records"><h2 id="profile-records">留下的记录</h2><div className="profile-links">
      <button aria-label="我的记录" disabled={busy} onClick={onRecords}><FileText/><span>我的记录<small>已保存的故事、表达练习与回访</small></span><ChevronRight/></button>
      <button aria-label="待回访" disabled={busy} onClick={onGrowth}><HandHeart/><span>待回访<small>查看尚未回看的记录</small></span><ChevronRight/></button>
    </div><p className="supporting-copy">{hasLocalDrafts?'你还有未保存的本机草稿。':'聊天和练习中的草稿只留在当前设备。'}草稿不会出现在已保存记录中，退出账号会清理。</p></section>
    <section className="profile-section" aria-labelledby="profile-settings"><h2 id="profile-settings">隐私与设置</h2><div className="profile-links">
      <button aria-label="隐私与数据" disabled={busy} onClick={onPrivacy}><Shield/><span>隐私与数据<small>保存方式、可见范围与记录导出</small></span><ChevronRight/></button>
      <button disabled={busy} onClick={onSafety}><HandHeart/><span>安全与人工支持</span><ChevronRight/></button>
      {counselor&&<button disabled={busy} onClick={onCounselor}><UserRound/><span>专业支持工作台</span><ChevronRight/></button>}
      <button disabled={busy} onClick={onService}><Info/><span>关于与服务状态</span><ChevronRight/></button>
    </div></section>
    <button className="text-button profile-logout" disabled={busy} onClick={onLogout}><LogOut/>退出账号</button>
  </>
}

const recordLabels={story:'私人故事',nvc:'表达练习',roleplay:'开口练习',followup:'回访记录'}
export function SavedRecords({page,busy,onOpen,onLoad,onStart}:{page:SavedRecordPage|null;busy:boolean;onOpen:(record:SavedRecord)=>void;onLoad:()=>void;onStart:()=>void}){
  return <>
    <p className="supporting-copy">这里只显示已保存到账号的私人记录，仅自己可见。点开可回到所属事件继续查看和修改。</p>
    {!page?busy?<p role="status">正在读取已保存记录…</p>:<><p>暂时没能读取记录，请重试。</p><Button secondary onClick={onLoad}>重新读取记录</Button></>:!page.records.length?<section className="empty-state"><img src="/assets/reso-empty.webp" alt=""/><h2>想留下的话，会在这里</h2><p>在事件中保存故事、表达练习或回访后，就能在这里找到。</p><Button onClick={onStart}>去看看聊过的事</Button></section>:<div className="profile-links saved-records">{page.records.map(record=><button disabled={busy} key={`${record.kind}:${record.id}`} onClick={()=>onOpen(record)}><FileText/><span>{recordLabels[record.kind]}<small>{record.event_title}</small><small>{record.kind==='followup'?'记录于':'练习更新于'} {new Date(record.updated_at).toLocaleString('zh-CN')} · 仅自己可见</small></span><ChevronRight/></button>)}</div>}
    {page&&page.nextOffset!==null&&<Button secondary disabled={busy} onClick={onLoad}>{busy?'正在读取…':'加载更多记录'}</Button>}
  </>
}

export function PrivacyData({events,busy,onExport}:{events:EventRecord[];busy:boolean;onExport:(id:string)=>void}){
  const mine=events.filter(event=>event.is_owner)
  return <>
    <section className="profile-section"><h2>记录保存在哪里</h2><p>已发送的聊天和已保存的记录存放在当前服务的数据库，登录同一账号后可以继续查看。本机版与服务器版的数据分别保存。</p><p>未提交的草稿只保存在当前设备，尚未备份到账号；退出账号或登录失效会清理。</p></section>
    <section className="profile-section"><h2>谁能看到</h2><p>私人聊天、原始问卷、故事与练习仅自己可见。房间聊天对当前成员可见；摘要和咨询纪要需要你单独确认分享。</p><p>分享管理可在具体事件中查看或撤回。撤回不能收回对方已经看到或复制的内容。</p></section>
    <section className="profile-section"><h2>导出我的事件</h2><p className="supporting-copy">按事件导出 JSON，包含聊天与已保存记录。导出文件可能包含私人内容，请妥善保管。删除整件事请进入该事件的操作菜单。</p>
      {!mine.length?<p className="supporting-copy">还没有自己创建的事件。</p>:<div className="profile-links">{mine.map(event=><button key={event.id} disabled={busy} aria-label={`导出事件：${event.title}`} onClick={()=>onExport(event.id)}><FileText/><span>{event.title}</span><Download/></button>)}</div>}
    </section>
  </>
}

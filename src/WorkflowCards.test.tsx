import test from 'node:test'
import assert from 'node:assert/strict'
import {renderToStaticMarkup} from 'react-dom/server'
import {ExerciseProgress,ClientApplication,CounselorApplication,UnderstandingCards,UnderstandingPrompt,MessageReasoning,ShareMembers,FollowupList,FollowupForm} from './WorkflowCards'
import {SaveStatus} from './components'
import {PeopleOverview} from './PeopleOverview'
import type {ChatMessage,Application,Understanding,Followup} from '../shared/types'

const actions={busy:false,perform:async()=>true,refresh:async()=>{}}
const application:Application={id:'application',event_id:'event',consultant_id:'expert',consultant_name:'测试人员',applicant_name:'申请人',status:'proposed',shared_summary:null,scheduled_at:null,proposed_at:'2026-12-01T10:00:00Z',schedule_version:2,rejection_reason:'',created_at:'2026-11-13T00:00:00Z'}

test('a proposed appointment asks the applicant to confirm; old note shares remain revocable without a visible current note',()=>{
  const client=renderToStaticMarkup(<ClientApplication application={{...application,note_content:null,note_shares:[{recipient_id:'member',source_version:1}]}} members={[]} {...actions}/> )
  assert.ok(client.includes('确认这个时间'));assert.ok(client.includes('需要换个时间'))
  assert.ok(client.includes('撤回纪要'));assert.ok(!client.includes('确认分享纪要'))
  const expert=renderToStaticMarkup(<CounselorApplication application={application} {...actions}/> )
  assert.ok(expert.includes('待申请人确认'));assert.ok(!expert.includes('双方已确认时间'))
})

test('a disputed model interpretation retains its source and cannot render as joint confirmation',()=>{
  const entry:Understanding={id:'entry',event_id:'event',domain:'room',author_id:'other',source_message_id:'1',source_author_id:null,source_author_name:'Reso',content:'待核对的猜测',provenance:'model_inference',version:2,status:'disputed',confirmations:[{user_id:'me',agreed:false,confirmed_at:'2026-11-13T00:00:00Z'}]}
  const html=renderToStaticMarkup(<UnderstandingCards entries={[entry]} eventId="event" userId="me" {...actions}/> )
  assert.ok(html.includes('AI 的待核对理解'));assert.ok(html.includes('存在不同意见'))
  assert.ok(html.includes('你对当前版本有不同意见'));assert.ok(!html.includes('当前成员均已确认'))
  assert.ok(!html.includes('修改这份理解'))
})


test('sharing controls show the exact recipient version and timestamp after the private summary changes',()=>{
  const html=renderToStaticMarkup(<ShareMembers members={[{user_id:'member',name:'家长',shared:true},{user_id:'other',name:'朋友',shared:false}]} snapshots={[{user_id:'member',content:'旧版本：我希望努力被看见',version:1,granted_at:'2026-11-13T00:00:00Z'}]} currentVersion={2} canShare busy={false} onShare={()=>{}} onWithdraw={()=>{}} onRemove={()=>{}}/>)
  assert.ok(html.includes('查看家长可见的摘要'));assert.ok(html.includes('旧版本：我希望努力被看见'));assert.ok(html.includes('版本 1'));assert.ok(html.includes('分享于'))
  assert.ok(html.includes('此人仍只能看到上方旧版本'));assert.ok(html.includes('更新为当前摘要'));assert.ok(html.includes('撤回摘要'));assert.ok(html.includes('此人看不到你的私人摘要'))
})

test('empty workflows offer a way forward without repeating an empty list below its own form',()=>{
  const understanding=renderToStaticMarkup(<UnderstandingCards entries={[]} eventId="event" userId="me" onStart={()=>{}} {...actions}/> )
  assert.ok(understanding.includes('回到对话'));assert.ok(understanding.includes('这符合你的意思吗？'))
  const growth=renderToStaticMarkup(<FollowupList entries={[]} onStart={()=>{}} {...actions}/> )
  assert.ok(growth.includes('回到事件列表'))
  const form=renderToStaticMarkup(<FollowupForm entries={[]} eventId="event" userId="me" {...actions}/> )
  assert.ok(form.includes('保存回访记录'));assert.ok(!form.includes('还没有回访记录'))
})

test('a pending support request preserves both choices while highlighting acceptance',()=>{
  const html=renderToStaticMarkup(<CounselorApplication application={{...application,status:'pending'}} {...actions}/> )
  assert.match(html,/<button[^>]*class="button primary [^"]*"[^>]*>接单<\/button>/)
  assert.match(html,/<button[^>]*class="button secondary [^"]*"[^>]*>暂不接受<\/button>/)
  assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*>暂不接受<\/button>/)
})

test('pending followups exclude reviewed records without removing them from event history',()=>{
  const entry:Followup={id:'pending',event_id:'event',reflection:'尚未回看的感受',next_step:'慢慢表达',review_at:null,reviewed_at:null,created_at:'2026-11-15T00:00:00Z'}
  const reviewed={...entry,id:'reviewed',reflection:'已经回看的感受',reviewed_at:'2026-11-15T01:00:00Z'}
  const pending=renderToStaticMarkup(<FollowupList pendingOnly entries={[entry,reviewed]} {...actions}/> )
  assert.match(pending,/待回访/);assert.match(pending,/尚未回看的感受/);assert.doesNotMatch(pending,/已经回看的感受/)
  const history=renderToStaticMarkup(<FollowupList entries={[entry,reviewed]} {...actions}/> )
  assert.match(history,/尚未回看的感受/);assert.match(history,/已经回看的感受/)
  const empty=renderToStaticMarkup(<FollowupList pendingOnly entries={[reviewed]} onStart={()=>{}} {...actions}/> )
  assert.match(empty,/暂时没有待回访/);assert.match(empty,/查看全部记录/)
})

test('save feedback distinguishes a confirmed save from a local draft and an empty state',()=>{
  const saved=renderToStaticMarkup(<SaveStatus saved>私人练习已保存</SaveStatus>)
  assert.match(saved,/is-saved/);assert.match(saved,/<svg/);assert.match(saved,/私人练习已保存/)
  const draft=renderToStaticMarkup(<SaveStatus saved={false}>草稿已保留，尚未保存</SaveStatus>)
  assert.doesNotMatch(draft,/is-saved|<svg/);assert.match(draft,/尚未保存/)
  assert.equal(renderToStaticMarkup(<SaveStatus saved={false}>{''}</SaveStatus>),'')
})

test('chapter progress marks position without claiming skipped chapters are complete',()=>{
  const intro=renderToStaticMarkup(<ExerciseProgress act={0} disabled={false} onSelect={()=>{}}/>)
  assert.doesNotMatch(intro,/aria-current/);assert.match(intro,/准备开始/)
  const middle=renderToStaticMarkup(<ExerciseProgress act={3} disabled onSelect={()=>{}}/>)
  assert.equal((middle.match(/<button/g)||[]).length,5)
  assert.equal((middle.match(/aria-current="step"/g)||[]).length,1)
  assert.equal((middle.match(/disabled=""/g)||[]).length,5)
  assert.match(middle,/stroke-dashoffset="0.5"/);assert.match(middle,/当前：第三幕/)
  assert.doesNotMatch(middle,/done|已完成/)
})

test('only important AI understandings get a check prompt, without duplicating proposal review',()=>{
  const message:ChatMessage={id:'1',event_id:'event',author_id:null,author_name:'Reso',domain:'private',role:'assistant',content:'你希望先被听完，再讨论安排是否要调整。',status:'complete',client_id:null,in_reply_to:'0',created_at:'2026-11-15T00:00:00Z',card_type:null}
  const render=(change:Partial<ChatMessage>,busy=false)=>renderToStaticMarkup(<UnderstandingPrompt message={{...message,...change}} busy={busy} onCheck={()=>{}}/>)
  for(const understanding_kind of ['summary','inference'] as const)assert.match(render({understanding_kind}),/这符合你的意思吗？/)
  assert.match(render({understanding_kind:'summary'},true),/disabled/)
  for(const change of [{},{understanding_kind:null},{understanding_kind:'summary' as const,role:'user' as const},{understanding_kind:'inference' as const,author_name:'系统'},{understanding_kind:'summary' as const,status:'error' as const},{understanding_kind:'summary' as const,card_type:'safety' as const},{understanding_kind:'summary' as const,agent_actions:[{id:'action',message_id:'1',kind:'summary' as const,value:{summary:'待核对摘要'},source_ids:['0'],status:'pending' as const,created_at:'2026-11-15T00:00:00Z'}]}])assert.equal(render(change),'')
})

test('provider reasoning is a separate accessible disclosure and is never fabricated for other messages',()=>{
  const message:ChatMessage={id:'1',event_id:'event',author_id:null,author_name:'Reso',domain:'private',role:'assistant',content:'这是最终回复。',status:'complete',client_id:null,in_reply_to:'0',created_at:'2026-11-15T00:00:00Z',card_type:null,reasoning_content:'先区分原话与假设。<script>不得作为 HTML 执行</script>'}
  const render=(change:Partial<ChatMessage>)=>renderToStaticMarkup(<MessageReasoning message={{...message,...change}}/>)
  const html=render({});assert.match(html,/思考过程/);assert.match(html,/role="region"/);assert.match(html,/tabindex="0"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|这是最终回复。|<details[^>]* open/)
  for(const change of [{reasoning_content:null},{reasoning_content:' '},{role:'user' as const},{author_name:'系统'},{status:'error' as const},{card_type:'safety' as const}])assert.equal(render(change),'')
})


test('people overview deduplicates people, searches shared events and never invents relationship categories',()=>{
  const connections=[{user_id:'a',name:'小禾',event_id:'e1',event_title:'家里那件事',last_interaction_at:'2026-11-15T10:00:00Z'},{user_id:'a',name:'小禾',event_id:'e2',event_title:'周末安排',last_interaction_at:'2026-11-14T10:00:00Z'},{user_id:'b',name:'小雨',event_id:'e2',event_title:'周末安排',last_interaction_at:'2026-11-14T10:00:00Z'}]
  const props={connections,search:'',busy:false,onPerson:()=>{},onTopic:()=>{},onSupport:()=>{},onApplication:()=>{}}
  const html=renderToStaticMarkup(<PeopleOverview {...props}/>)
  assert.ok(html.includes('共 2 人'));assert.equal((html.match(/class="people-group"/g)||[]).length,2);assert.equal((html.match(/class="person-avatar"/g)||[]).length,5)
  assert.ok(html.includes('最近聊到的人'));assert.ok(html.includes('今天想聊点轻松的？'));assert.ok(html.includes('我的专业支持'));assert.ok(!html.includes('已预约'));assert.ok(!html.includes('同学'))
  const filtered=renderToStaticMarkup(<PeopleOverview {...props} search="家里"/>);assert.ok(filtered.includes('小禾'));assert.ok(!filtered.includes('小雨'))
  const empty=renderToStaticMarkup(<PeopleOverview {...props} connections={[]}/>);assert.ok(empty.includes('共 0 人'));assert.ok(empty.includes('一起聊过的人会出现在这里'))
})

import type {MethodKind} from './agent'

export const methodLabels:Record<MethodKind,string>={narrative:'整理这件事',nvc:'写下我的表达',roleplay:'练习怎么开口'}
const source={name:'Reso 产品需求 V2.1',version:'2026-11-11',kind:'product_spec_reference',professional_review:'pending'} as const
const common={version:1,source,status:'product_reference',requires_user_choice:true,may_pause:true,may_skip:true,automatically_saved:false,automatically_shared:false} as const

export const methodCards={
  narrative:{...common,method_id:'reso-narrative-v1',kind:'narrative',title:methodLabels.narrative,
    reference_framework:'叙事取向（产品方法卡参考）',
    goal:'从一次具体经历里区分事件、评价和对自己的理解，保存本人认可的故事。',
    trigger_signals:['被单一负面评价困住','把一次表现解释为整个人的价值','愿意回看具体经历'],
    contraindications:['当前安全需要核实','情绪过强只想倾诉','本人拒绝或不想回忆'],
    steps:['开场：说明自愿与暂停，征求意愿','回到那天：只还原有来源的事','两种声音：区分原话与自己的解释','没有放弃的时刻：寻找本人确实经历的例外','这些画里的我：允许复杂和不同感受','我的故事：由本人改写、确认是否保存'],
    boundary:'不强迫积极、原谅或和解，不把示例中的经历补成当前用户事实。'},
  nvc:{...common,method_id:'reso-nvc-v1',kind:'nvc',title:methodLabels.nvc,
    goal:'把自己的观察、感受、需要和可被拒绝的请求分开，形成可修改的表达。',
    trigger_signals:['想表达但容易争吵','希望先被听完','不知道怎样提出具体请求'],
    contraindications:['当前安全需要核实','存在暴力或强迫控制，不适合直接沟通','本人拒绝'],
    field_rules:{feeling:'感受是情绪体验，例如委屈、难过、生气；不要把“想被听见、希望受尊重”填成感受',need:'需要是所重视的事，例如被听见、尊重、自主；用户已明确说出就保留其原话，仍作为可修改草稿',request:'把用户明确希望的行为整理为具体、可拒绝的请求；用户要求帮忙拟请求时，可根据其描述的行为拟一句待核对的候选说法，不能声称是本人已说过或对方已同意。不要因对象、场合或感受缺失就把请求留空；用户明确不想填请求时才留空',unknown:'用户说不清或明确要求不填写的部分留空，不推断、不强迫补全；确认保存不要求所有字段非空'},
    steps:['观察：只描述已有来源支持的具体行为，不替对方归因','感受：允许多种或不确定的感受，不诊断','需要：请本人确认，不替本人下结论','请求：具体、可执行、允许对方拒绝'],
    boundary:'不要强迫沟通或和解；存在即时危险先求助，不推动练习。'},
  roleplay:{...common,method_id:'reso-roleplay-v1',kind:'roleplay',title:methodLabels.roleplay,
    goal:'在安全的假设情境中排练自己的边界和回应，理解不同可能。',
    trigger_signals:['关系双方有理解差异','想试着换一种说法','愿意进行假设排练'],
    contraindications:['当前安全需要核实','存在暴力或强迫控制','本人不愿重演'],
    steps:['使用本人的具体原话','给对方的可能回应标记为假设，提供不同可能','优先练习自己的边界与回应','回看是否有帮助，允许退出'],
    boundary:'假设回应不是对方真实表态，也不是已达成共识；不能强迫用户接受替对方编出的动机。'},
} as const

export const followupGuide={purpose:'回看尝试与下一步',steps:['区分已经尝试和计划尝试','允许没有变化或不想继续','下一步由本人决定'],boundary:'不能声称已经发送提醒、联系人工或安排预约'}

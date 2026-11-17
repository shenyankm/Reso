export const scenes = [
  { id: 'welcome', label: '欢迎与隐私说明', group: '开始' },
  { id: 'chat', label: '私聊 · 努力未被看见', group: '开始' },
  { id: 'question', label: '初步了解 · 问卷题卡', group: '了解自己' },
  { id: 'discovery', label: '一个小发现', group: '了解自己' },
  { id: 'tools', label: '心理学小练习', group: '了解自己' },
  { id: 'exercise', label: '叙事小练习 · 五幕', group: '了解自己' },
  { id: 'memory', label: '事件记忆', group: '一起沟通' },
  { id: 'invite', label: '邀请妈妈', group: '一起沟通' },
  { id: 'room', label: '三人自由会谈', group: '一起沟通' },
  { id: 'perspectives', label: '双视角核对', group: '一起沟通' },
  { id: 'music', label: '音乐陪伴', group: '更多支持' },
  { id: 'experts', label: '咨询师推荐', group: '更多支持' },
  { id: 'booking', label: '咨询申请与分享', group: '更多支持' },
  { id: 'safety', label: '安全与人工支持', group: '更多支持' },
  { id: 'relationships', label: '我的关系', group: '我的关系' },
] as const

export type Scene = typeof scenes[number]['id']

export function parseScene(hash: string): Scene {
  const id = hash.replace(/^#\/?/, '')
  return scenes.find(scene => scene.id === id)?.id ?? 'welcome'
}

export type Message = { role: 'reso' | 'user' | 'mom'; text: string }

export const chatMessages: Message[] = [
  { role: 'reso', text: '最近有没有一件事，你其实已经做得不错了，后来却怎么也高兴不起来？' },
  { role: 'user', text: '有。中考我其实比平时考得好。但我妈后来总说，就差几分，再多考几分就好了。' },
  { role: 'reso', text: '我想先问一句：在听到妈妈那句话之前，你自己对那个成绩满意吗？' },
  { role: 'user', text: '其实挺满意的。我真的努力了。' },
  { role: 'reso', text: '那你原本是认可自己的。后来听见“就差几分”，那份满意好像被盖过去了。你更难受的是没拿到那几分，还是自己的努力没有被看见？' },
  { role: 'user', text: '是后面那个。我觉得我已经很努力了，但她好像永远都觉得不够。' },
  { role: 'reso', text: '听起来，你不是不知道自己努力过。你是很希望，在被提醒哪里还不够之前，有人能先看见你已经做到了什么。' },
]

// shortcut: these are interaction samples, replace with the approved questionnaire before scoring.
export const questions = [
  '当学习上没有达到预期时，我会觉得自己不够好。',
  '即使取得了进步，我对自己的肯定也很快就消失了。',
  '一次成绩不理想，会让我怀疑自己之前的努力。',
] as const

export const answerLabels = ['完全不符合', '比较不符合', '有点不符合', '有点符合', '比较符合', '完全符合'] as const

export const acts = [
  { title: '把这段经历画出来', chapter: '开始之前', prompt: '“我被践踏了”，这几个字听起来很重。我们可以慢一点，把那天的故事重新看一看。', image: 'story-5', caption: '一次只看一点，随时可以停下。', question: '准备好了，就从那天开始。' },
  { title: '回到那天', chapter: '第一幕', prompt: '我们先回到那天。妈妈开口前，看到成绩的你是什么感觉？', image: 'story-1', caption: '开心是真实的，后来受伤也是真实的。', question: '你看看，像不像那天的变化？' },
  { title: '两种声音', chapter: '第二幕', prompt: '妈妈说的是“还差几分”。你心里听到的，是不是“我怎么努力都不够好”？这两句话，我们可以分开看看。', image: 'story-2', caption: '对方说的话，和我们听见的意思，有时并不一样。', question: '这两种声音，像你的感受吗？' },
  { title: '没有放弃的时刻', chapter: '第三幕', prompt: '你说过，落下的功课是你一点点补回来的。我们把这些真实的努力也放进故事里，好吗？', image: 'story-3', caption: '不是每次都做得好，但你还是带着自己往前走。', question: '你想把哪些努力留在故事里？' },
  { title: '这些画里的我', chapter: '第四幕', prompt: '开心的你、受伤的你，还有没有放弃的你，都是真实的。我们不让一种感受，盖住其它的事实。', image: 'story-1', caption: '我可以难过，也可以看见自己已经做到的事。', question: '你愿意把这些自己，放在一起看看吗？' },
  { title: '我的故事', chapter: '第五幕 · 终章', prompt: '妈妈的话可以让我难过，却不必决定我怎么看自己。现在，我们可以用你的话，写下你愿意留下的故事。', image: 'story-5', caption: '妈妈的话，不是我全部的故事。', question: '这段故事只属于你，保存前也可以再修改。' },
] as const

export const teachers = [
  { name: '周老师', method: '支持性倾听', tag: '先让感受被听见', image: 'teacher-zhou', reason: '如果你暂时只想倾诉，可以先在不被催促的对话里，慢慢说出自己的感受。' },
  { name: '林老师', method: 'CBT · 亲子沟通', tag: '一起梳理想法', image: 'teacher-lin', reason: '先接住“努力没有被看见”的委屈，再区分妈妈的话、事实与自我评价，练习表达你的需要。' },
  { name: '张老师', method: '短程 CBT', tag: '尝试具体行动', image: 'teacher-zhang', reason: '当你准备尝试改变时，可以一起整理一个小目标，找到适合自己的学习与沟通行动。' },
] as const

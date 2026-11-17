import items from './scqa-items.json' with { type: 'json' }

export const scqaVersion = 'zh-research-v0.2-20261029'
export const scqaItems: string[] = items
export const scqaOptions = ['完全不符合我', '比较不符合我', '有点不符合我', '有点符合我', '比较符合我', '非常符合我']
export const scales = [
  { id: 'academic_down', name: '学业能力 · 往下', domain: '学业', items: [2, 14, 18] },
  { id: 'academic_up', name: '学业能力 · 往上', domain: '学业', items: [5, 9, 21] },
  { id: 'appearance_down', name: '外貌 · 往下', domain: '外貌', items: [8, 20, 24] },
  { id: 'appearance_up', name: '外貌 · 往上', domain: '外貌', items: [3, 12, 15] },
  { id: 'peer_down', name: '同伴关系 · 往下', domain: '同伴关系', items: [4, 10, 16] },
  { id: 'peer_up', name: '同伴关系 · 往上', domain: '同伴关系', items: [1, 7, 13] },
  { id: 'sport_down', name: '体育运动能力 · 往下', domain: '体育运动', items: [6, 11, 22] },
  { id: 'sport_up', name: '体育运动能力 · 往上', domain: '体育运动', items: [17, 19, 23] },
] as const

export function scoreScqa(answers: number[]) {
  if (answers.length !== 24 || answers.some(n => !Number.isInteger(n) || n < 1 || n > 6)) throw new Error('需要完整的24题作答，每题1至6分')
  return Object.fromEntries(scales.map(s => [s.id, s.items.reduce((sum, n) => sum + answers[n - 1], 0) / 3]))
}

export function describeScqa(scores: Record<string, number>) {
  const ranked = scales.filter(s => s.id.endsWith('_down')).slice().sort((a, b) => scores[b.id] - scores[a.id])
  const domain = ranked[0].domain
  return `你的回答中，${domain}方面的不顺利可能比较容易牵动你对自己的评价。这只是我们可以一起核对的线索，不代表诊断。你觉得像你吗？`
}

export function firstUnanswered(answers:(number|null)[]|undefined){
  const next=answers?.findIndex(value=>value===null)??0
  return next<0?0:next
}

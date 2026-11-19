import script from './script.json'

export const stages = script.steps as Record<string, { title: string; summary: Record<string, string>; reply: string }>
export type Effect =
  | { kind: 'message'; role: 'child' | 'mother' | 'reso'; text: string }
  | { kind: 'summary' | 'reply' }
  | { kind: 'card'; card_id: keyof typeof script.cards }
  | { kind: 'status'; text: string }
export const turns = script.turns as { step: string; action: string; effects: Effect[] }[]
export const sharedStart = turns.findIndex(turn => turn.action === 'demo.shared_room_open')
export const sharedEnd = turns.findIndex(turn => turn.action === 'demo.private_followup')
export const sharedTurn = (index: number) => index >= sharedStart && index < sharedEnd
export const dialogueInput = (cursor: number) => turns[cursor]?.action === 'chat.send'
  ? turns[cursor].effects.find(effect => effect.kind === 'message') : undefined

export function comparableLine(text: string) {
  return text.normalize('NFKC').replace(/[\p{P}\s]/gu, '')
}

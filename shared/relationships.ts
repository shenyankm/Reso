export const contactCategories = ['family', 'friend', 'classmate', 'uncategorized'] as const
export type ContactCategory = typeof contactCategories[number]
export const contactCategoryLabels: Record<ContactCategory, string> = {
  family: '家人',
  friend: '朋友',
  classmate: '同学',
  uncategorized: '未分类',
}

export type TimelineEntry = {
  id: string
  occurred_at: string
  kind: 'event_created' | 'discovery_confirmed' | 'story_saved' | 'followup_saved' | 'invite_accepted' | 'perspective_confirmed' | 'room_closed'
}

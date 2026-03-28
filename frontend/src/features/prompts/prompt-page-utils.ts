import type { PromptCollectionItem, PromptGroupRecord, PromptStatistics, PromptTypeFilter } from '@/types/prompt'

export const PROMPT_TYPE_TABS: Array<{ value: PromptTypeFilter; label: string }> = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'auto', label: 'Auto' },
]

export function getSortedSiblingGroups(groups: PromptGroupRecord[], group: PromptGroupRecord | null) {
  if (!group) {
    return []
  }

  return groups
    .filter((item) => item.id !== 0 && item.parent_id === group.parent_id)
    .sort((left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name))
}

export function isLockedPromptGroup(group?: PromptGroupRecord | null) {
  return group?.group_name?.trim().toLowerCase() === 'lora'
}

export function isLockedPromptItem(item: PromptCollectionItem) {
  return item.group_info?.group_name?.trim().toLowerCase() === 'lora'
}

export function getPromptTypeTotal(promptType: PromptTypeFilter, statistics?: PromptStatistics) {
  if (!statistics) {
    return 0
  }

  if (promptType === 'positive') {
    return statistics.total_prompts
  }
  if (promptType === 'negative') {
    return statistics.total_negative_prompts
  }
  return statistics.total_auto_prompts
}

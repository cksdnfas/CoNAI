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

export function isProtectedLoRAPromptGroup(group?: PromptGroupRecord | null) {
  return group?.group_name?.trim().toLowerCase() === 'lora'
}

export function isDanbooruPromptGroup(group?: PromptGroupRecord | null, groups: PromptGroupRecord[] = []) {
  if (!group) {
    return false
  }

  const byId = new Map(groups.map((item) => [item.id, item] as const))
  const visited = new Set<number>()
  let current: PromptGroupRecord | null | undefined = group

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const normalizedName = current.group_name.trim().toLowerCase()
    if (current.parent_id == null && (normalizedName === 'danbooru' || normalizedName === '단부루')) {
      return true
    }
    current = current.parent_id == null ? null : byId.get(current.parent_id)
  }

  return false
}

export function isLockedPromptGroup(group?: PromptGroupRecord | null, groups: PromptGroupRecord[] = []) {
  return isProtectedLoRAPromptGroup(group) || isDanbooruPromptGroup(group, groups)
}

export function isLockedPromptItem(item: PromptCollectionItem, groups: PromptGroupRecord[] = []) {
  return isProtectedLoRAPromptGroup(item.group_info) || isDanbooruPromptGroup(item.group_info, groups)
}

export function canDeletePromptItem(item: PromptCollectionItem, groups: PromptGroupRecord[] = []) {
  return !isLockedPromptItem(item, groups) && item.usage_count <= 0
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

export function formatPromptUsageCount(value: number): string {
  if (value < 1000) {
    return String(value)
  }

  const thousands = value / 1000
  if (value >= 100000) {
    return `${Math.round(thousands)}K`
  }

  const oneDecimalThousands = Math.floor(thousands * 10) / 10
  return `${oneDecimalThousands.toFixed(1).replace(/\.0$/, '')}K`
}

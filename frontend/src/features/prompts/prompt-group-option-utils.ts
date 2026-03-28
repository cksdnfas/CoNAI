import type { PromptGroupRecord } from '@/types/prompt'

export interface PromptGroupOptionItem {
  id: number
  label: string
  depth: number
}

/** Build a flat prompt-group option list while preserving hierarchy depth. */
export function buildPromptGroupOptionItems(groups: PromptGroupRecord[]) {
  const childrenByParent = new Map<number | null, PromptGroupRecord[]>()

  for (const group of groups) {
    const parentId = group.parent_id ?? null
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(group)
    childrenByParent.set(parentId, siblings)
  }

  const items: PromptGroupOptionItem[] = []

  const visit = (parentId: number | null, depth: number) => {
    const siblings = (childrenByParent.get(parentId) ?? []).sort(
      (left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name),
    )

    for (const group of siblings) {
      items.push({
        id: group.id,
        depth,
        label: `${'— '.repeat(depth)}${group.group_name}`,
      })
      visit(group.id, depth + 1)
    }
  }

  visit(null, 0)
  return items
}

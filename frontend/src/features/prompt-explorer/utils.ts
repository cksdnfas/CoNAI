import type { PromptGroupRecord, PromptRecord } from '@/services/prompt-api'
import type { GroupedPromptResult, PromptGroupWithChildren } from '@/features/prompt-explorer/types'

export function buildGroupTree(groups: PromptGroupRecord[]): PromptGroupWithChildren[] {
  const map = new Map<number, PromptGroupWithChildren>()
  const roots: PromptGroupWithChildren[] = []

  for (const group of groups) {
    if (typeof group.id !== 'number') {
      continue
    }

    map.set(group.id, {
      ...group,
      id: group.id,
      children: [],
    })
  }

  for (const group of groups) {
    if (typeof group.id !== 'number') {
      continue
    }

    const node = map.get(group.id)
    if (!node) {
      continue
    }

    if (typeof group.parent_id === 'number' && map.has(group.parent_id)) {
      map.get(group.parent_id)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortTree = (nodes: PromptGroupWithChildren[]) => {
    nodes.sort((a, b) => {
      const aOrder = a.display_order ?? 0
      const bOrder = b.display_order ?? 0
      if (aOrder !== bOrder) {
        return aOrder - bOrder
      }
      return a.group_name.localeCompare(b.group_name)
    })

    for (const node of nodes) {
      if (node.children.length > 0) {
        sortTree(node.children)
      }
    }
  }

  sortTree(roots)
  return roots
}

export function flattenGroupIds(nodes: PromptGroupWithChildren[]): number[] {
  const ids: number[] = []
  const walk = (items: PromptGroupWithChildren[]) => {
    for (const item of items) {
      ids.push(item.id)
      if (item.children.length > 0) {
        walk(item.children)
      }
    }
  }

  walk(nodes)
  return ids
}

export function findGroupById(nodes: PromptGroupWithChildren[], groupId: number | null): PromptGroupWithChildren | null {
  if (groupId === null) {
    return null
  }

  const walk = (items: PromptGroupWithChildren[]): PromptGroupWithChildren | null => {
    for (const item of items) {
      if (item.id === groupId) {
        return item
      }

      if (item.children.length > 0) {
        const found = walk(item.children)
        if (found) {
          return found
        }
      }
    }

    return null
  }

  return walk(nodes)
}

export function findGroupNameById(nodes: PromptGroupWithChildren[], groupId: number): string | null {
  const group = findGroupById(nodes, groupId)
  return group ? group.group_name : null
}

export function groupPromptsByGroup(prompts: PromptRecord[], groups: PromptGroupWithChildren[]): GroupedPromptResult[] {
  const map = new Map<number | 'ungrouped', PromptRecord[]>()

  for (const prompt of prompts) {
    const key = typeof prompt.group_id === 'number' ? prompt.group_id : 'ungrouped'
    const bucket = map.get(key) ?? []
    bucket.push(prompt)
    map.set(key, bucket)
  }

  const results: GroupedPromptResult[] = []
  for (const [key, items] of map.entries()) {
    if (key === 'ungrouped') {
      results.push({
        id: 'ungrouped',
        name: 'Ungrouped',
        prompts: items,
      })
      continue
    }

    const groupName = findGroupNameById(groups, key) ?? `Group ${key}`
    results.push({
      id: key,
      name: groupName,
      prompts: items,
    })
  }

  results.sort((a, b) => a.name.localeCompare(b.name))
  return results
}

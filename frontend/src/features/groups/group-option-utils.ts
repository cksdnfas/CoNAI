import type { GroupWithHierarchy } from '@/types/group'

export interface GroupOptionItem {
  id: number
  label: string
  depth: number
}

/** Collect every descendant id under a group for hierarchy-safe parent selection. */
export function collectDescendantGroupIds(groups: GroupWithHierarchy[], groupId: number) {
  const descendantIds = new Set<number>()
  const queue = [groupId]

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (currentId === undefined) {
      continue
    }

    for (const group of groups) {
      if (group.parent_id !== currentId || descendantIds.has(group.id)) {
        continue
      }

      descendantIds.add(group.id)
      queue.push(group.id)
    }
  }

  return descendantIds
}

/** The given groups plus every group under them (what a cascade delete removes, or what a move may not target). */
export function collectGroupSubtreeIds(groups: GroupWithHierarchy[], rootIds: Iterable<number>) {
  const roots = new Set(rootIds)
  const parentById = new Map(groups.map((group) => [group.id, group.parent_id ?? null] as const))
  const subtreeIds = new Set<number>()

  for (const group of groups) {
    let currentId: number | null = group.id
    while (currentId !== null) {
      if (roots.has(currentId)) {
        subtreeIds.add(group.id)
        break
      }
      currentId = parentById.get(currentId) ?? null
    }
  }

  return subtreeIds
}

/** Build a flat select-friendly option list that keeps hierarchy depth visible. */
export function buildGroupOptionItems(groups: GroupWithHierarchy[], options?: { excludeIds?: Set<number> }) {
  const childrenByParent = new Map<number | null, GroupWithHierarchy[]>()

  for (const group of groups) {
    const parentId = group.parent_id ?? null
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(group)
    childrenByParent.set(parentId, siblings)
  }

  const items: GroupOptionItem[] = []

  const visit = (parentId: number | null, depth: number) => {
    for (const group of childrenByParent.get(parentId) ?? []) {
      if (!options?.excludeIds?.has(group.id)) {
        items.push({
          id: group.id,
          depth,
          label: `${'— '.repeat(depth)}${group.name}`,
        })
      }
      visit(group.id, depth + 1)
    }
  }

  visit(null, 0)
  return items
}

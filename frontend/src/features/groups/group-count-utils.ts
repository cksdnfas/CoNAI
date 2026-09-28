import type { GroupWithHierarchy } from '@/types/group'

export interface GroupCountMaps {
  childCountByGroupId: Map<number, number>
  totalImageCountByGroupId: Map<number, number>
}

/** Direct image count, preferring the server's visible count that matches the in-group list. */
export function getGroupDirectImageCount(group: GroupWithHierarchy) {
  return group.visible_image_count ?? group.image_count ?? 0
}

/**
 * Resolve direct + descendant image totals for flat group hierarchy records.
 *
 * Custom groups carry a server-side inclusive count that de-duplicates images shared by
 * several subgroups and applies the same visibility filters as the group page, so it is
 * used as-is. Summing children here would double-count those shared images. Sources
 * without that field (watched-folder groups, whose folders rarely share images) still
 * fall back to summing direct counts.
 */
export function buildGroupCountMaps(groups: GroupWithHierarchy[]): GroupCountMaps {
  const childrenByParentId = new Map<number, GroupWithHierarchy[]>()
  const childCountByGroupId = new Map<number, number>()
  const totalImageCountByGroupId = new Map<number, number>()

  for (const group of groups) {
    if (group.parent_id == null) continue
    const children = childrenByParentId.get(group.parent_id) ?? []
    children.push(group)
    childrenByParentId.set(group.parent_id, children)
    childCountByGroupId.set(group.parent_id, (childCountByGroupId.get(group.parent_id) ?? 0) + 1)
  }

  const groupById = new Map(groups.map((group) => [group.id, group] as const))
  const collectTotal = (groupId: number, visiting = new Set<number>()): number => {
    if (totalImageCountByGroupId.has(groupId)) return totalImageCountByGroupId.get(groupId) ?? 0
    if (visiting.has(groupId)) return 0

    const group = groupById.get(groupId)
    if (group?.total_visible_image_count !== undefined) {
      totalImageCountByGroupId.set(groupId, group.total_visible_image_count)
      return group.total_visible_image_count
    }

    visiting.add(groupId)
    let total = group ? getGroupDirectImageCount(group) : 0
    for (const child of childrenByParentId.get(groupId) ?? []) {
      total += collectTotal(child.id, visiting)
    }
    visiting.delete(groupId)
    totalImageCountByGroupId.set(groupId, total)
    return total
  }

  for (const group of groups) {
    collectTotal(group.id)
  }

  return { childCountByGroupId, totalImageCountByGroupId }
}

/** Format a tree count as direct(total), or just (total) when the direct count is zero. */
function formatHierarchyCountLabel(params: {
  directCount: number
  totalWithDescendants: number
  hasChildren: boolean
  formatNumber: (value: number) => string
}) {
  const { directCount, totalWithDescendants, hasChildren, formatNumber } = params

  if (!hasChildren) {
    return formatNumber(directCount)
  }

  if (directCount === 0) {
    return `(${formatNumber(totalWithDescendants)})`
  }

  return `${formatNumber(directCount)}(${formatNumber(totalWithDescendants)})`
}

export function getGroupHierarchyCountLabel(
  group: GroupWithHierarchy,
  countMaps: GroupCountMaps,
  formatNumber: (value: number) => string,
) {
  const directCount = getGroupDirectImageCount(group)
  const hasChildren = (countMaps.childCountByGroupId.get(group.id) ?? 0) > 0
  const totalWithDescendants = countMaps.totalImageCountByGroupId.get(group.id) ?? directCount

  return formatHierarchyCountLabel({ directCount, totalWithDescendants, hasChildren, formatNumber })
}

export function getGroupHierarchyTotalCount(group: GroupWithHierarchy, countMaps: GroupCountMaps) {
  return countMaps.totalImageCountByGroupId.get(group.id) ?? getGroupDirectImageCount(group)
}

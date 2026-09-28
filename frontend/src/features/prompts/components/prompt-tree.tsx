import { useCallback, useMemo } from 'react'
import type { SidebarItemProps } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import type { PromptGroupRecord } from '@/types/prompt'
import { SidebarTree } from './sidebar-tree'

interface PromptTreeProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  onSelectGroup: (groupId?: number | null) => void
  getIcon?: (group: PromptGroupRecord) => SidebarItemProps['icon']
}

/** Visible prompt groups as sidebar folder rows. Parents show "direct(total)" counts. */
export function PromptTree({ groups, selectedGroupId, onSelectGroup, getIcon }: PromptTreeProps) {
  const { formatNumber } = useI18n()
  const treeGroups = useMemo(() => groups.filter((group) => group.id === 0 || Boolean(group.is_visible)), [groups])
  const visibleGroupIds = useMemo(() => new Set(treeGroups.map((group) => group.id)), [treeGroups])
  const { childCountByGroupId, totalPromptCountByGroupId } = useMemo(() => {
    const groupById = new Map(treeGroups.map((group) => [group.id, group] as const))
    const childrenByParentId = new Map<number, PromptGroupRecord[]>()
    const childCounts = new Map<number, number>()
    const totals = new Map<number, number>()

    for (const group of treeGroups) {
      if (group.parent_id == null || !visibleGroupIds.has(group.parent_id)) continue
      const children = childrenByParentId.get(group.parent_id) ?? []
      children.push(group)
      childrenByParentId.set(group.parent_id, children)
      childCounts.set(group.parent_id, (childCounts.get(group.parent_id) ?? 0) + 1)
    }

    const collectTotal = (groupId: number, visiting = new Set<number>()): number => {
      if (totals.has(groupId)) return totals.get(groupId) ?? 0
      if (visiting.has(groupId)) return 0

      visiting.add(groupId)
      const group = groupById.get(groupId)
      let total = group?.prompt_count ?? 0
      for (const child of childrenByParentId.get(groupId) ?? []) {
        total += collectTotal(child.id, visiting)
      }
      visiting.delete(groupId)
      totals.set(groupId, total)
      return total
    }

    for (const group of treeGroups) {
      collectTotal(group.id)
    }

    return {
      childCountByGroupId: childCounts,
      totalPromptCountByGroupId: totals,
    }
  }, [treeGroups, visibleGroupIds])

  const getId = useCallback((group: PromptGroupRecord) => group.id, [])
  const getParentId = useCallback((group: PromptGroupRecord) => (group.parent_id != null && visibleGroupIds.has(group.parent_id) ? group.parent_id : null), [visibleGroupIds])
  const sortGroups = useCallback((left: PromptGroupRecord, right: PromptGroupRecord) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name), [])

  return (
    <SidebarTree
      items={treeGroups}
      selectedId={selectedGroupId}
      onSelect={(group) => onSelectGroup(group.id)}
      getId={getId}
      getParentId={getParentId}
      getLabel={(group) => group.group_name}
      getCount={(group) => {
        const directCount = group.prompt_count ?? 0
        const hasChildren = (childCountByGroupId.get(group.id) ?? 0) > 0
        const totalWithDescendants = totalPromptCountByGroupId.get(group.id) ?? directCount
        if (!hasChildren) return formatNumber(directCount)
        return directCount === 0
          ? `(${formatNumber(totalWithDescendants)})`
          : `${formatNumber(directCount)}(${formatNumber(totalWithDescendants)})`
      }}
      getIcon={getIcon}
      sortItems={sortGroups}
    />
  )
}

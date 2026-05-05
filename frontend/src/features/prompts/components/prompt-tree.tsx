import { useMemo } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import { useI18n } from '@/i18n'
import type { PromptGroupRecord } from '@/types/prompt'

interface PromptTreeProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  totalCount?: number
  onSelectGroup: (groupId?: number | null) => void
}

export function PromptTree({ groups, selectedGroupId, totalCount = 0, onSelectGroup }: PromptTreeProps) {
  const { formatNumber, t } = useI18n()
  const treeGroups = useMemo(() => groups.filter((group) => group.id === 0 || Boolean(group.is_visible)), [groups])
  const visibleGroupIds = useMemo(() => new Set(treeGroups.map((group) => group.id)), [treeGroups])
  const { childCountByGroupId, totalPromptCountByGroupId } = useMemo(() => {
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
      const group = treeGroups.find((item) => item.id === groupId)
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

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelectGroup(undefined)}
        className={getNavigationItemClassName({
          active: selectedGroupId == null,
          className: 'flex items-center justify-between',
        })}
      >
        <span>{t({ ko: '전체 프롬프트 ({count})', en: 'All prompts ({count})' }, { count: formatNumber(totalCount) })}</span>
      </button>

      <HierarchyNav
        items={treeGroups}
        expandable
        selectedId={selectedGroupId}
        onSelect={(group) => onSelectGroup(group.id)}
        getId={(group) => group.id}
        getParentId={(group) => (group.parent_id != null && visibleGroupIds.has(group.parent_id) ? group.parent_id : null)}
        getLabel={(group) => {
          const directCount = group.prompt_count ?? 0
          const hasChildren = (childCountByGroupId.get(group.id) ?? 0) > 0
          const totalWithDescendants = totalPromptCountByGroupId.get(group.id) ?? directCount
          const countLabel = hasChildren
            ? directCount === 0
              ? `(${formatNumber(totalWithDescendants)})`
              : `${formatNumber(directCount)}(${formatNumber(totalWithDescendants)})`
            : formatNumber(directCount)

          return (
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate">{group.group_name}</span>
              <span className="shrink-0 text-xs tabular-nums">{countLabel}</span>
            </div>
          )
        }}
        sortItems={(left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name)}
        renderIcon={(group, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
      />
    </div>
  )
}

import { useCallback, useMemo } from 'react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { getGroupHierarchyCountDescription, getGroupHierarchyCountLabel, type GroupCountMaps } from '@/features/groups/group-count-utils'
import type { GroupWithHierarchy } from '@/types/group'
import { GroupColorDot } from './group-color-dot'

interface GroupTreeProps {
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  selectedGroupId?: number
  /** Case-insensitive name filter; matches keep their ancestors so the path stays visible. */
  filterText?: string
  /** Group row currently hovered by an image drag. */
  dropTargetId?: number | null
  onSelectGroup: (groupId: number) => void
}

/** Attribute the sidebar's delegated drag-and-drop reads to find the hovered group row. */
export const GROUP_DROP_ID_ATTRIBUTE = 'data-group-drop-id'

const EMPTY_IDS: number[] = []

function sortGroupsByName(left: GroupWithHierarchy, right: GroupWithHierarchy) {
  return left.name.localeCompare(right.name)
}

function getGroupId(group: GroupWithHierarchy) {
  return group.id
}

function getGroupParentId(group: GroupWithHierarchy) {
  return group.parent_id
}

function renderGroupIcon(group: GroupWithHierarchy) {
  return <GroupColorDot color={group.color} size="md" className="mx-1" />
}

/** Keep the groups whose name matches plus every ancestor of a match; also return those ancestors to expand. */
function filterGroupsByName(groups: GroupWithHierarchy[], filterText: string) {
  const query = filterText.trim().toLocaleLowerCase()
  if (!query) {
    return { visibleGroups: groups, expandedIds: EMPTY_IDS }
  }

  const groupById = new Map(groups.map((group) => [group.id, group] as const))
  const keptIds = new Set<number>()
  const expandedIds = new Set<number>()

  for (const group of groups) {
    if (!group.name.toLocaleLowerCase().includes(query)) continue
    keptIds.add(group.id)
    let parentId = group.parent_id ?? null
    while (parentId != null && !expandedIds.has(parentId)) {
      expandedIds.add(parentId)
      keptIds.add(parentId)
      parentId = groupById.get(parentId)?.parent_id ?? null
    }
  }

  return {
    visibleGroups: groups.filter((group) => keptIds.has(group.id)),
    expandedIds: Array.from(expandedIds),
  }
}

export function GroupTree({ groups, countMaps, selectedGroupId, filterText = '', dropTargetId = null, onSelectGroup }: GroupTreeProps) {
  const { formatNumber, t } = useI18n()
  const { visibleGroups, expandedIds } = useMemo(() => filterGroupsByName(groups, filterText), [filterText, groups])

  const getLabel = useCallback((group: GroupWithHierarchy) => {
    const countLabel = getGroupHierarchyCountLabel(group, countMaps, formatNumber)
    const countDescription = getGroupHierarchyCountDescription(group, countMaps, formatNumber, t)

    return (
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate">{group.name}</span>
        <Tip content={countDescription}>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            <span aria-hidden="true">{countLabel}</span>
            <span className="sr-only">{countDescription}</span>
          </span>
        </Tip>
      </div>
    )
  }, [countMaps, formatNumber, t])

  const getItemClassName = useCallback((group: GroupWithHierarchy) => (
    dropTargetId === group.id ? cn('bg-primary/20 text-foreground ring-2 ring-primary/60') : undefined
  ), [dropTargetId])

  const getItemDataAttributes = useCallback((group: GroupWithHierarchy) => ({
    [GROUP_DROP_ID_ATTRIBUTE]: String(group.id),
  }), [])

  if (visibleGroups.length === 0 && filterText.trim()) {
    return <p className="px-2 py-3 text-sm text-muted-foreground">{t({ ko: '맞는 그룹 없음', en: 'No matching groups' })}</p>
  }

  return (
    <HierarchyNav
      items={visibleGroups}
      expandable
      defaultExpandedIds={expandedIds}
      selectedId={selectedGroupId}
      onSelect={(group) => onSelectGroup(group.id)}
      getId={getGroupId}
      getParentId={getGroupParentId}
      getLabel={getLabel}
      sortItems={sortGroupsByName}
      renderIcon={renderGroupIcon}
      getItemClassName={getItemClassName}
      getItemDataAttributes={getItemDataAttributes}
    />
  )
}

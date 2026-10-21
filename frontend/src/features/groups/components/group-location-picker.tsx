import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SearchField } from '@/components/common/search-field'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useI18n } from '@/i18n'
import { getGroupHierarchyCountLabel, type GroupCountMaps } from '@/features/groups/group-count-utils'
import { cn } from '@/lib/utils'
import { buildGroupPathItems } from '@/features/groups/group-page-shared'
import type { GroupWithHierarchy } from '@/types/group'
import { GroupColorDot } from './group-color-dot'
import { filterGroupsByName } from './group-tree'

interface GroupLocationPickerProps {
  /** Groups that may be picked (callers leave out invalid targets, e.g. a group's own descendants). */
  groups: GroupWithHierarchy[]
  /** Every group, for the path of the current value; defaults to `groups`. */
  pathGroups?: GroupWithHierarchy[]
  /** Picked group id; `null` is the top level. */
  value: number | null
  onChange: (groupId: number | null) => void
  /** Offer the top level as a choice. */
  allowRoot?: boolean
  /**
   * A settings row (label · current path · change) inside a `GroupModalSection` that opens the tree on demand;
   * otherwise the tree is always shown.
   */
  collapsible?: boolean
  /** Row label of the collapsible form. */
  label?: ReactNode
  /** Image counts after each name. */
  countMaps?: GroupCountMaps
}

function getGroupId(group: GroupWithHierarchy) {
  return group.id
}

function getGroupParentId(group: GroupWithHierarchy) {
  return group.parent_id
}

function sortGroupsByName(left: GroupWithHierarchy, right: GroupWithHierarchy) {
  return left.name.localeCompare(right.name)
}

function renderGroupIcon(group: GroupWithHierarchy) {
  return <GroupColorDot color={group.color} size="md" className="mx-1" />
}

/** Pick a group (or the top level) from a searchable tree; the collapsed form shows the picked path in one line. */
export function GroupLocationPicker({
  groups,
  pathGroups,
  value,
  onChange,
  allowRoot = true,
  collapsible = true,
  label,
  countMaps,
}: GroupLocationPickerProps) {
  const { t, formatNumber } = useI18n()
  const [open, setOpen] = useState(!collapsible)
  const [filterText, setFilterText] = useState('')
  const { visibleGroups, expandedIds } = useMemo(() => filterGroupsByName(groups, filterText), [filterText, groups])
  const pathItems = useMemo(() => buildGroupPathItems(pathGroups ?? groups, value ?? undefined), [groups, pathGroups, value])
  const rootLabel = t({ ko: '최상위', en: 'Top level' })
  const showTree = open || !collapsible

  const pick = (groupId: number | null) => {
    onChange(groupId)
    if (collapsible) {
      setOpen(false)
      setFilterText('')
    }
  }

  const getLabel = (group: GroupWithHierarchy) => (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate">{group.name}</span>
      {countMaps ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{getGroupHierarchyCountLabel(group, countMaps, formatNumber)}</span> : null}
    </div>
  )

  return (
    <div className={cn(collapsible && 'border-b border-line last:border-b-0')}>
      {collapsible ? (
        <div className="flex min-h-12 items-center gap-3 py-2">
          <span className="shrink-0 text-sm font-medium text-foreground">{label}</span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden text-sm">
            <span className="shrink-0 text-muted-foreground">{rootLabel}</span>
            {pathItems.map((item, index) => (
              <span key={item.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className={index === pathItems.length - 1 ? 'truncate font-medium' : 'truncate text-muted-foreground'}>{item.name}</span>
              </span>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
            {open ? t({ ko: '닫기', en: 'Close' }) : t({ ko: '변경', en: 'Change' })}
          </Button>
        </div>
      ) : null}

      {showTree ? (
        <div className={cn('space-y-1.5 rounded-lg border border-line bg-surface-low p-2', collapsible && 'mb-3')}>
          <SearchField value={filterText} onChange={setFilterText} placeholder={t({ ko: '그룹 검색', en: 'Search groups' })} />
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {allowRoot && !filterText.trim() ? (
              <Button
                type="button"
                variant="nav"
                size="sm"
                onClick={() => pick(null)}
                data-active={value === null ? 'true' : undefined}
                aria-current={value === null ? 'true' : undefined}
              >
                <FolderOpen />
                {rootLabel}
              </Button>
            ) : null}
            {visibleGroups.length > 0 ? (
              <HierarchyNav
                items={visibleGroups}
                expandable
                defaultExpandedIds={expandedIds}
                selectedId={value}
                onSelect={(group) => pick(group.id)}
                getId={getGroupId}
                getParentId={getGroupParentId}
                getLabel={getLabel}
                sortItems={sortGroupsByName}
                renderIcon={renderGroupIcon}
              />
            ) : (
              <EmptyState size="compact" title={filterText.trim() ? t({ ko: '맞는 그룹이 없어', en: 'No matching groups' }) : t({ ko: '고를 수 있는 그룹이 없어', en: 'No groups to pick' })} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

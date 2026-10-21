import { useState } from 'react'
import { Check, SlidersHorizontal } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SearchField } from '@/components/common/search-field'
import { CountBadge } from '@/components/ui/count-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'
import { GroupColorDot } from '@/features/groups/components/group-color-dot'
import { filterGroupsByName } from '@/features/groups/components/group-tree'
import { buildGroupCountMaps, getGroupHierarchyCountLabel } from '@/features/groups/group-count-utils'
import { HOME_HIDDEN_GROUPS_LIMIT } from '@/features/home/home-hidden-groups'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'

interface HomeGalleryOptionsMenuProps {
  groups: GroupWithHierarchy[]
  groupsStatus: 'pending' | 'error' | 'success'
  hiddenGroupIds: number[]
  onHiddenGroupIdsChange: (groupIds: number[]) => void
  /** Hiding on; off keeps the ticked groups but shows every image. */
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
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

/**
 * The checkbox look (components/ui/checkbox) drawn inside a tree row: the row itself is the button, and a real
 * Checkbox would nest a second button in it.
 */
function RowCheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 items-center justify-center rounded-sm border',
        checked ? 'border-primary bg-primary' : 'border-muted-foreground/55',
      )}
    >
      {checked ? <Check className="size-3.5 text-primary-foreground" strokeWidth={3} /> : null}
    </span>
  )
}

/** Every ancestor of the given groups, so the tree opens on them. */
function collectAncestorIds(groupById: Map<number, GroupWithHierarchy>, groupIds: number[]) {
  const ancestorIds = new Set<number>()
  for (const groupId of groupIds) {
    let parentId = groupById.get(groupId)?.parent_id ?? null
    while (parentId != null && !ancestorIds.has(parentId)) {
      ancestorIds.add(parentId)
      parentId = groupById.get(parentId)?.parent_id ?? null
    }
  }
  return [...ancestorIds]
}

/** Home gallery options: the key shows how many groups are hidden and opens the hidden-group picker. */
export function HomeGalleryOptionsMenu(props: HomeGalleryOptionsMenuProps) {
  const { t, formatNumber } = useI18n()
  const groupIds = new Set(props.groups.map((group) => group.id))
  // Only existing groups count: ids of deleted groups drop out with the next change.
  const hiddenCount = props.enabled ? props.hiddenGroupIds.filter((id) => groupIds.has(id)).length : 0
  const label = hiddenCount > 0
    ? t({ ko: '갤러리 옵션 · 그룹 {count}개 숨김', en: 'Gallery options · {count} groups hidden' }, { count: formatNumber(hiddenCount) })
    : t({ ko: '갤러리 옵션', en: 'Gallery options' })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton size="icon-sm" variant="ghost" label={label} className="relative">
          <SlidersHorizontal className="size-4" />
          {hiddenCount > 0 ? <CountBadge corner="top-right" size="xs" count={hiddenCount} max={99} /> : null}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        padding="none"
        className="flex w-80 flex-col overflow-hidden"
        // Keep focus off the search box so a phone keyboard does not pop up over the list on open.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <HiddenGroupsPanel {...props} />
      </PopoverContent>
    </Popover>
  )
}

/** Mounted while the popover is open, so the search and the folding start fresh each time. */
function HiddenGroupsPanel({ groups, groupsStatus, hiddenGroupIds, onHiddenGroupIdsChange, enabled, onEnabledChange }: HomeGalleryOptionsMenuProps) {
  const { t, formatNumber } = useI18n()
  const [filterText, setFilterText] = useState('')
  const groupById = new Map(groups.map((group) => [group.id, group] as const))
  const hiddenIds = hiddenGroupIds.filter((id) => groupById.has(id))
  const hidden = new Set(hiddenIds)
  const atLimit = hiddenIds.length >= HOME_HIDDEN_GROUPS_LIMIT
  const countMaps = buildGroupCountMaps(groups)
  // Opens on the hidden groups: their parents start unfolded.
  const [hiddenAncestorIds] = useState(() => collectAncestorIds(groupById, hiddenIds))
  const { visibleGroups, expandedIds } = filterGroupsByName(groups, filterText)

  const toggle = (group: GroupWithHierarchy) => onHiddenGroupIdsChange(
    hidden.has(group.id) ? hiddenIds.filter((id) => id !== group.id) : [...hiddenIds, group.id],
  )

  let body
  if (groupsStatus === 'pending') {
    body = <div className="px-3 py-2.5"><LoadingState variant="inline" spinnerSize="sm" label={t({ ko: '그룹을 불러오는 중…', en: 'Loading groups…' })} /></div>
  } else if (groupsStatus === 'error') {
    body = <EmptyState size="compact" title={t('useHomePageData.failedToLoadGroupList')} />
  } else if (groups.length === 0) {
    body = <EmptyState size="compact" title={t({ ko: '아직 그룹이 없어', en: 'No groups yet' })} />
  } else if (visibleGroups.length === 0) {
    body = <EmptyState size="compact" title={t({ ko: '맞는 그룹이 없어', en: 'No matching groups' })} />
  } else {
    body = (
      <HierarchyNav
        items={visibleGroups}
        expandable
        expandOnSelect={false}
        defaultExpandedIds={filterText.trim() ? expandedIds : hiddenAncestorIds}
        onSelect={toggle}
        isItemSelectable={(group) => enabled && (hidden.has(group.id) || !atLimit)}
        getId={getGroupId}
        getParentId={getGroupParentId}
        sortItems={sortGroupsByName}
        renderIcon={(group) => <RowCheckMark checked={hidden.has(group.id)} />}
        getLabel={(group) => (
          <span className="flex min-w-0 items-center gap-2">
            <GroupColorDot color={group.color} />
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
            {hidden.has(group.id) ? <span className="sr-only">{t({ ko: '숨김', en: 'Hidden' })}</span> : null}
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{getGroupHierarchyCountLabel(group, countMaps, formatNumber)}</span>
          </span>
        )}
      />
    )
  }

  return (
    <>
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <Text variant="title">{t({ ko: '갤러리에서 숨길 그룹', en: 'Groups hidden from the gallery' })}</Text>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label={t({ ko: '그룹 숨김', en: 'Hide groups' })} />
      </div>
      {groups.length > 0 ? (
        <div className="border-b border-line p-1.5">
          <SearchField value={filterText} onChange={setFilterText} placeholder={t({ ko: '그룹 검색', en: 'Search groups' })} />
        </div>
      ) : null}
      {/* Off: the ticked groups stay, dimmed, until hiding is switched back on. */}
      <div className={cn('max-h-80 overflow-y-auto p-1', !enabled && 'opacity-50')}>{body}</div>
    </>
  )
}

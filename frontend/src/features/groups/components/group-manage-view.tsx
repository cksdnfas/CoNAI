import { useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Bot, FolderOpen } from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { Checkbox } from '@/components/ui/checkbox'
import { DataCheckTd, DataCheckTh, DataTable, DataTd, DataTh, DataTr } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getGroupHierarchyTotalCount, type GroupCountMaps } from '@/features/groups/group-count-utils'
import type { GroupWithHierarchy } from '@/types/group'
import { GroupColorDot } from './group-color-dot'
import { filterGroupsByName } from './group-tree'

interface GroupManageViewProps {
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  selectedIds: number[]
  onSelectedIdsChange: (ids: number[]) => void
  onOpenGroup: (groupId: number) => void
}

/** The tree as rows in display order (parents before children, siblings by name) with each row's depth. */
function flattenGroupTree(groups: GroupWithHierarchy[]) {
  const ids = new Set(groups.map((group) => group.id))
  const childrenByParent = new Map<number | null, GroupWithHierarchy[]>()
  for (const group of groups) {
    // A group whose parent is filtered out still shows, at the top level.
    const parentId = group.parent_id != null && ids.has(group.parent_id) ? group.parent_id : null
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(group)
    childrenByParent.set(parentId, siblings)
  }

  const rows: Array<{ group: GroupWithHierarchy; depth: number }> = []
  const visit = (parentId: number | null, depth: number) => {
    const siblings = [...(childrenByParent.get(parentId) ?? [])].sort((left, right) => left.name.localeCompare(right.name))
    for (const group of siblings) {
      rows.push({ group, depth })
      visit(group.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

/** Every custom group as a checkable row, for deleting or moving many groups at once (Shift+click picks a range). */
export function GroupManageView({ groups, countMaps, selectedIds, onSelectedIdsChange, onOpenGroup }: GroupManageViewProps) {
  const { t, formatNumber } = useI18n()
  const [filterText, setFilterText] = useState('')
  const anchorIdRef = useRef<number | null>(null)
  const rows = useMemo(() => flattenGroupTree(filterGroupsByName(groups, filterText).visibleGroups), [filterText, groups])
  const selectedSet = new Set(selectedIds)
  const visibleIds = rows.map((row) => row.group.id)
  const selectedVisibleCount = visibleIds.filter((id) => selectedSet.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length

  const toggle = (groupId: number, extendRange: boolean) => {
    const next = new Set(selectedSet)
    const select = !next.has(groupId)
    const anchorIndex = anchorIdRef.current === null ? -1 : visibleIds.indexOf(anchorIdRef.current)
    const index = visibleIds.indexOf(groupId)
    const rangeIds = extendRange && anchorIndex >= 0
      ? visibleIds.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1)
      : [groupId]
    for (const id of rangeIds) {
      if (select) next.add(id)
      else next.delete(id)
    }
    anchorIdRef.current = groupId
    onSelectedIdsChange([...next])
  }

  const toggleAllVisible = () => {
    const next = new Set(selectedSet)
    for (const id of visibleIds) {
      if (allVisibleSelected) next.delete(id)
      else next.add(id)
    }
    onSelectedIdsChange([...next])
  }

  if (groups.length === 0) {
    return <EmptyState icon={FolderOpen} title={t({ ko: '아직 그룹이 없어', en: 'No groups yet' })} />
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField className="sm:max-w-80" value={filterText} onChange={setFilterText} placeholder={t({ ko: '그룹 검색', en: 'Search groups' })} />
      </div>

      {rows.length === 0 ? (
        <EmptyState size="compact" title={t({ ko: '맞는 그룹이 없어', en: 'No matching groups' })} />
      ) : (
        <DataTable
          head={(
            <>
              <DataCheckTh>
                <Checkbox
                  checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? 'indeterminate' : false}
                  onCheckedChange={toggleAllVisible}
                  aria-label={allVisibleSelected ? t({ ko: '선택 해제', en: 'Clear selection' }) : t({ ko: '모두 선택', en: 'Select all' })}
                />
              </DataCheckTh>
              <DataTh>{t({ ko: '이름', en: 'Name' })}</DataTh>
              <DataTh numeric>{t({ ko: '하위', en: 'Children' })}</DataTh>
              <DataTh numeric>{t({ ko: '이미지', en: 'Images' })}</DataTh>
              <DataTh className="w-10"><span className="sr-only">{t({ ko: '열기', en: 'Open' })}</span></DataTh>
            </>
          )}
        >
          {rows.map(({ group, depth }) => {
            const selected = selectedSet.has(group.id)
            return (
              <DataTr key={group.id} interactive selected={selected} className="cursor-pointer select-none" onClick={(event) => toggle(group.id, event.shiftKey)}>
                <DataCheckTd>
                  <Checkbox
                    checked={selected}
                    aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: group.name })}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggle(group.id, event.shiftKey)
                    }}
                  />
                </DataCheckTd>
                <DataTd>
                  <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 18}px` }}>
                    <GroupColorDot color={group.color} size="md" />
                    <span className="min-w-0 truncate font-medium">{group.name}</span>
                    {group.auto_collect_enabled ? (
                      <Tip content={t({ ko: '자동수집 켜짐', en: 'Auto-collect on' })}>
                        <Bot className="size-3.5 shrink-0 text-primary" aria-label={t({ ko: '자동수집 켜짐', en: 'Auto-collect on' })} />
                      </Tip>
                    ) : null}
                  </div>
                </DataTd>
                <DataTd numeric meta>{group.child_count > 0 ? formatNumber(group.child_count) : '-'}</DataTd>
                <DataTd numeric meta>{formatNumber(getGroupHierarchyTotalCount(group, countMaps))}</DataTd>
                <DataTd flush className="w-10">
                  <IconButton
                    label={t({ ko: '그룹 열기', en: 'Open group' })}
                    variant="ghost"
                    size="icon-sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenGroup(group.id)
                    }}
                  >
                    <ArrowUpRight />
                  </IconButton>
                </DataTd>
              </DataTr>
            )
          })}
        </DataTable>
      )}
    </section>
  )
}

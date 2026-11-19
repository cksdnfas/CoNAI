import { useState } from 'react'
import { ErrorState } from '@/components/ui/error-state'
import { SearchField } from '@/components/common/search-field'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageSidebar } from '@/components/ui/sidebar'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import type { GroupWithHierarchy } from '@/types/group'
import type { GroupCountMaps } from '@/features/groups/group-count-utils'
import { isGroupImageDrag, readGroupImageDrag } from '@/features/groups/group-image-drag'
import type { GroupSourceKey } from '@/features/groups/group-page-shared'
import { GroupTree } from './group-tree'
import { useI18n } from '@/i18n'
import { useDropTarget } from '@/lib/use-drop-target'

interface GroupExplorerSidebarPanelProps {
  sourceKey: GroupSourceKey
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  selectedGroupId?: number
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  onSelectSource: (sourceKey: GroupSourceKey) => void
  onSelectGroup: (groupId: number) => void
  /** Custom groups only: images dropped on a tree row. */
  onDropImages?: (groupId: number, compositeHashes: string[]) => void
  /** Custom groups only: a row's actions (edit, move, delete…), opened by right-click / long-press. */
  getGroupMenu?: (group: GroupWithHierarchy) => ActionMenuEntry[]
}

/**
 * Page sidebar content: source switch, name search, and the group tree (also an image drop target).
 * Rendered by PageWithSidebar in its column and, on narrow screens, in its drawer (which a pick closes).
 */
export function GroupExplorerSidebarPanel({
  sourceKey,
  groups,
  countMaps,
  selectedGroupId,
  isLoading,
  isError,
  errorMessage,
  onSelectSource,
  onSelectGroup,
  onDropImages,
  getGroupMenu,
}: GroupExplorerSidebarPanelProps) {
  const { t } = useI18n()
  const pageSidebar = usePageSidebar()
  const closeDrawer = () => {
    if (pageSidebar && !pageSidebar.isDesktop) {
      pageSidebar.setMobileOpen(false)
    }
  }
  const [filterText, setFilterText] = useState('')
  const canDrop = Boolean(onDropImages)
  const drop = useDropTarget({
    accepts: (_groupId, event) => canDrop && isGroupImageDrag(event.dataTransfer),
    dropEffect: 'copy',
    onDrop: (groupId, event) => {
      const compositeHashes = readGroupImageDrag(event.dataTransfer)
      if (compositeHashes.length > 0) {
        onDropImages?.(Number(groupId), compositeHashes)
      }
    },
  })

  const header = (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <SegmentedControl
          value={sourceKey}
          size="xs"
          fullWidth
          semantics="tabs"
          ariaLabel={t({ ko: '그룹 종류', en: 'Group source' })}
          className="min-w-0 flex-1"
          items={[
            { value: 'custom', label: t({ ko: '커스텀', en: 'Custom' }) },
            { value: 'folders', label: t({ ko: '감시 폴더', en: 'Watched folders' }) },
          ]}
          onChange={(value) => {
            closeDrawer()
            onSelectSource(value as GroupSourceKey)
          }}
        />
      </div>
      <SearchField value={filterText} onChange={setFilterText} placeholder={t({ ko: '그룹 검색', en: 'Search groups' })} />
    </div>
  )

  const content = (
    <>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} radius="sm" className="h-9 w-full" />
          ))}
        </div>
      ) : null}

      {isError ? (
        <ErrorState
          size="compact"
          title={t('groups.components.group.explorer.sidebar.panel.failed.to.load.the.group.tree')}
          error={errorMessage ?? undefined}
        />
      ) : null}

      {!isLoading && !isError ? (
        <div {...drop.containerProps}>
          <GroupTree
            groups={groups}
            countMaps={countMaps}
            selectedGroupId={selectedGroupId}
            filterText={filterText}
            dropTarget={drop}
            getGroupMenu={getGroupMenu}
            onSelectGroup={(groupId) => {
              closeDrawer()
              onSelectGroup(groupId)
            }}
          />
        </div>
      ) : null}
    </>
  )

  return (
    <div className="space-y-3">
      {header}
      {content}
    </div>
  )
}

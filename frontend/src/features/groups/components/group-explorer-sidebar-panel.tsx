import { useState, type DragEvent } from 'react'
import { Plus, Search } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageSidebar } from '@/components/ui/sidebar'
import type { GroupWithHierarchy } from '@/types/group'
import type { GroupCountMaps } from '@/features/groups/group-count-utils'
import { isGroupImageDrag, readGroupImageDrag } from '@/features/groups/group-image-drag'
import type { GroupSourceKey } from '@/features/groups/group-page-shared'
import { GROUP_DROP_ID_ATTRIBUTE, GroupTree } from './group-tree'
import { useI18n } from '@/i18n'

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
  /** Custom groups only: open the new-group editor. */
  onCreateGroup?: () => void
  /** Custom groups only: images dropped on a tree row. */
  onDropImages?: (groupId: number, compositeHashes: string[]) => void
}

/** Find the tree row under a drag event. */
function getDropGroupId(event: DragEvent<HTMLElement>) {
  const target = event.target instanceof Element ? event.target.closest(`[${GROUP_DROP_ID_ATTRIBUTE}]`) : null
  const groupId = Number(target?.getAttribute(GROUP_DROP_ID_ATTRIBUTE))
  return Number.isFinite(groupId) && groupId > 0 ? groupId : null
}

/**
 * Page sidebar content: source switch, name search, new-group action, and the group tree (also an image drop target).
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
  onCreateGroup,
  onDropImages,
}: GroupExplorerSidebarPanelProps) {
  const { t } = useI18n()
  const pageSidebar = usePageSidebar()
  const closeDrawer = () => {
    if (pageSidebar && !pageSidebar.isDesktop) {
      pageSidebar.setMobileOpen(false)
    }
  }
  const [filterText, setFilterText] = useState('')
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const canDrop = Boolean(onDropImages)

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canDrop || !isGroupImageDrag(event.dataTransfer)) return
    const groupId = getDropGroupId(event)
    if (groupId === null) {
      setDropTargetId(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropTargetId(groupId)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetId(null)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropTargetId(null)
    const groupId = getDropGroupId(event)
    if (!canDrop || groupId === null || !isGroupImageDrag(event.dataTransfer)) return
    event.preventDefault()
    const compositeHashes = readGroupImageDrag(event.dataTransfer)
    if (compositeHashes.length > 0) {
      onDropImages?.(groupId, compositeHashes)
    }
  }

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
            { value: 'folders', label: t({ ko: '감시폴더', en: 'Watched' }) },
          ]}
          onChange={(value) => {
            closeDrawer()
            onSelectSource(value as GroupSourceKey)
          }}
        />
        {onCreateGroup ? (
          <IconButton
            label={t({ ko: '새 그룹', en: 'New group' })}
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              closeDrawer()
              onCreateGroup()
            }}
          >
            <Plus />
          </IconButton>
        ) : null}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder={t({ ko: '그룹 검색', en: 'Search groups' })}
          aria-label={t({ ko: '그룹 이름으로 찾기', en: 'Filter groups by name' })}
          className="h-8 pl-8 text-xs"
        />
      </div>
    </div>
  )

  const content = (
    <>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-sm" />
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
        <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <GroupTree
            groups={groups}
            countMaps={countMaps}
            selectedGroupId={selectedGroupId}
            filterText={filterText}
            dropTargetId={dropTargetId}
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

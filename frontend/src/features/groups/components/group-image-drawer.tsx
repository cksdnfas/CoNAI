import type { ReactNode } from 'react'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Badge } from '@/components/ui/badge'
import type { GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import { GroupImageSection } from './group-image-section'

interface GroupImageDrawerProps {
  open: boolean
  group: GroupRecord
  groupImages: ImageRecord[]
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  selectable?: boolean
  selectedIds?: string[]
  onSelectedIdsChange?: (selectedIds: string[]) => void
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  onClose: () => void
}

export function GroupImageDrawer({
  open,
  group,
  groupImages,
  isLoading,
  isError,
  errorMessage,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectable = false,
  selectedIds = [],
  onSelectedIdsChange,
  renderItemOverlay,
  onClose,
}: GroupImageDrawerProps) {
  const shouldShowCollectionCounts = group.manual_added_count !== undefined || group.auto_collected_count !== undefined

  return (
    <BottomDrawerSheet
      open={open}
      title={group.name}
      subtitle={`${group.image_count.toLocaleString('ko-KR')}개 이미지`}
      ariaLabel="그룹 이미지 시트"
      headerActions={shouldShowCollectionCounts ? (
        <div className="hidden items-center gap-2 sm:flex">
          <Badge variant="outline">manual {group.manual_added_count?.toLocaleString('ko-KR') ?? 0}</Badge>
          <Badge variant="outline">auto {group.auto_collected_count?.toLocaleString('ko-KR') ?? 0}</Badge>
        </div>
      ) : undefined}
      bodyClassName="overflow-hidden"
      onClose={onClose}
    >
      <GroupImageSection
        group={group}
        groupImages={groupImages}
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={onLoadMore}
        hideHeader
        presentation="drawer"
        selectable={selectable}
        selectedIds={selectedIds}
        onSelectedIdsChange={onSelectedIdsChange}
        renderItemOverlay={renderItemOverlay}
      />
    </BottomDrawerSheet>
  )
}

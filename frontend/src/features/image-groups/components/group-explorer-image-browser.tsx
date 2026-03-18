import type { GroupWithStats } from '@conai/shared'
import type { ImageRecord, PageSize } from '@/types/image'
import GroupImageGridModal from './group-image-grid-modal'

interface GroupExplorerImageBrowserProps {
  panelKey: string
  currentGroup: GroupWithStats | null
  allGroups: GroupWithStats[]
  images: ImageRecord[]
  loading: boolean
  pageSize: PageSize
  currentPage: number
  totalPages: number
  total: number
  onClose: () => void
  onPageSizeChange: (size: PageSize) => void
  onPageChange: (page: number) => void
  hasMore: boolean
  onLoadMore: () => void
  onImagesRemoved?: (selectedImageIds: string[]) => void
  onImagesAssigned?: (targetGroupId: number, selectedImageIds: string[]) => void
  readOnly?: boolean
  groupType?: 'custom' | 'auto-folder'
  onShowSnackbar?: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void
}

export function GroupExplorerImageBrowser({
  panelKey,
  currentGroup,
  allGroups,
  images,
  loading,
  pageSize,
  currentPage,
  totalPages,
  total,
  onClose,
  onPageSizeChange,
  onPageChange,
  hasMore,
  onLoadMore,
  onImagesRemoved,
  onImagesAssigned,
  readOnly = false,
  groupType = 'custom',
  onShowSnackbar,
}: GroupExplorerImageBrowserProps) {
  if (!currentGroup) {
    return null
  }

  return (
    <GroupImageGridModal
      key={panelKey}
      open={true}
      embedded={true}
      onClose={onClose}
      images={images}
      loading={loading}
      currentGroup={currentGroup}
      allGroups={allGroups}
      pageSize={pageSize}
      onPageSizeChange={onPageSizeChange}
      currentPage={currentPage}
      totalPages={totalPages}
      total={total}
      onPageChange={onPageChange}
      infiniteScroll={{
        hasMore,
        loadMore: onLoadMore,
      }}
      onImagesRemoved={onImagesRemoved}
      onImagesAssigned={onImagesAssigned}
      readOnly={readOnly}
      groupType={groupType}
      onShowSnackbar={onShowSnackbar}
    />
  )
}

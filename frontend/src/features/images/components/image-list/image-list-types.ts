import type { ImageRecord } from '@/types/image'

export interface ImageListProps {
  items: ImageRecord[]
  getItemHref?: (image: ImageRecord) => string | undefined
  selectable?: boolean
  selectedIds?: string[]
  onSelectedIdsChange?: (selectedIds: string[]) => void
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => Promise<unknown> | void
  columnWidth?: number
  columnGutter?: number
  rowGutter?: number
  itemHeightEstimate?: number
  overscanBy?: number
  className?: string
}

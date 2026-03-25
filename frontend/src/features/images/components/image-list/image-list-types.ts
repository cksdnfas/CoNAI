import type { ImageRecord } from '@/types/image'

export type ImageListLayoutMode = 'grid' | 'masonry'

export interface ImageListProps {
  items: ImageRecord[]
  layout?: ImageListLayoutMode
  activationMode?: 'navigate' | 'modal' | 'modal-single'
  getItemHref?: (image: ImageRecord) => string | undefined
  selectable?: boolean
  selectedIds?: string[]
  onSelectedIdsChange?: (selectedIds: string[]) => void
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => Promise<unknown> | void
  minColumnWidth?: number
  columnGap?: number
  rowGap?: number
  gridItemHeight?: number
  className?: string
}

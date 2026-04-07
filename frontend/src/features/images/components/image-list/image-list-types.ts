import type { ReactNode } from 'react'
import type { ImageRecord } from '@/types/image'

export type ImageListLayoutMode = 'grid' | 'masonry'
export type ImageListScrollMode = 'window' | 'container'

export interface ImageListProps {
  items: ImageRecord[]
  layout?: ImageListLayoutMode
  activationMode?: 'navigate' | 'modal' | 'modal-single'
  getItemHref?: (image: ImageRecord) => string | undefined
  getItemId?: (image: ImageRecord) => string
  selectable?: boolean
  forceSelectionMode?: boolean
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
  scrollMode?: ImageListScrollMode
  viewportHeight?: number | string
  selectionAreaClass?: string
  renderItemOverlay?: (image: ImageRecord) => ReactNode
}

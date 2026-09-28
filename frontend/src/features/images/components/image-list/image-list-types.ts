import type { ReactNode } from 'react'
import type { ImageViewModalAccessOptions, ImageViewSequenceTotal } from '@/features/images/components/detail/image-view-modal-context'
import type { ImageRecord } from '@/types/image'

export type ImageListLayoutMode = 'grid' | 'masonry'
export type ImageListScrollMode = 'window' | 'container'

/** Keyboard modifiers that change what a tile click does (Shift extends the selection as a range). */
export interface ImageListActivateModifiers {
  shiftKey?: boolean
}

export type ImageListActivateHandler = (image: ImageRecord, imageId: string, href?: string, modifiers?: ImageListActivateModifiers) => void

export type ImageListToggleSelectHandler = (image: ImageRecord, imageId: string, modifiers?: ImageListActivateModifiers) => void

export interface ImageListProps {
  items: ImageRecord[]
  resetKey?: string
  layout?: ImageListLayoutMode
  activationMode?: 'none' | 'navigate' | 'modal' | 'modal-single'
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
  preferredColumnCount?: number
  columnGap?: number
  rowGap?: number
  gridItemHeight?: number
  className?: string
  scrollMode?: ImageListScrollMode
  viewportHeight?: number | string
  selectionAreaClass?: string
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  renderItemPersistentOverlay?: (image: ImageRecord) => ReactNode
  showDefaultQuickActions?: boolean
  shouldBlurItemPreview?: (image: ImageRecord) => boolean
  onPreviewIntent?: (image: ImageRecord) => void
  modalAccessOptions?: ImageViewModalAccessOptions
  /** Real total of the source list for the modal counter; omit when the source has none. */
  sequenceTotal?: ImageViewSequenceTotal
  /**
   * Desktop drag-out: holding the mouse still on a tile briefly arms a native HTML5 drag; fill `event.dataTransfer`
   * here. A plain press-and-move keeps starting the rubber-band selection.
   */
  onItemDragStart?: (itemId: string, event: DragEvent) => void
}

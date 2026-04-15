import type { ReactNode } from 'react'
import { VirtuosoMasonry, type ItemContent } from '@virtuoso.dev/masonry'
import type { ImageRecord } from '@/types/image'
import type { ImageListScrollMode } from './image-list-types'
import { ImageListItem } from './image-list-item'

interface ImageListMasonryProps {
  items: ImageRecord[]
  selectedIds: string[]
  selectionMode: boolean
  columnCount: number
  columnGap: number
  rowGap: number
  getItemHref?: (image: ImageRecord) => string | undefined
  getItemId?: (image: ImageRecord) => string
  onActivate: (image: ImageRecord, imageId: string, href?: string) => void
  scrollMode: ImageListScrollMode
  viewportHeight?: number | string
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  renderItemPersistentOverlay?: (image: ImageRecord) => ReactNode
  shouldBlurItemPreview?: (image: ImageRecord) => boolean
}

interface ImageListMasonryContext {
  rowGap: number
  selectedIds: string[]
  selectionMode: boolean
  getItemHref?: (image: ImageRecord) => string | undefined
  getItemId?: (image: ImageRecord) => string
  onActivate: (image: ImageRecord, imageId: string, href?: string) => void
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  renderItemPersistentOverlay?: (image: ImageRecord) => ReactNode
  shouldBlurItemPreview?: (image: ImageRecord) => boolean
}

const MasonryItemContent: ItemContent<ImageRecord, ImageListMasonryContext> = ({ data: image, context }) => {
  if (!image) {
    return null
  }

  const itemId = String(context.getItemId ? context.getItemId(image) : (image.composite_hash ?? image.id))

  return (
    <div style={{ paddingBottom: `${context.rowGap}px` }}>
      <ImageListItem
        image={image}
        itemId={itemId}
        href={context.getItemHref?.(image)}
        selected={context.selectedIds.includes(itemId)}
        selectionMode={context.selectionMode}
        onActivate={context.onActivate}
        renderOverlay={context.renderItemOverlay?.(image)}
        renderPersistentOverlay={context.renderItemPersistentOverlay?.(image)}
        blurPreview={context.shouldBlurItemPreview?.(image) ?? false}
      />
    </div>
  )
}

/** Render a reusable virtualized masonry layout with responsive column count. */
export function ImageListMasonry({
  items,
  selectedIds,
  selectionMode,
  columnCount,
  columnGap,
  rowGap,
  getItemHref,
  getItemId,
  onActivate,
  scrollMode,
  viewportHeight,
  renderItemOverlay,
  renderItemPersistentOverlay,
  shouldBlurItemPreview,
}: ImageListMasonryProps) {
  const usesWindowScroll = scrollMode === 'window'

  return (
    <VirtuosoMasonry<ImageRecord, ImageListMasonryContext>
      data={items}
      context={{
        rowGap,
        selectedIds,
        selectionMode,
        getItemHref,
        getItemId,
        onActivate,
        renderItemOverlay,
        renderItemPersistentOverlay,
        shouldBlurItemPreview,
      }}
      useWindowScroll={usesWindowScroll}
      columnCount={columnCount}
      initialItemCount={Math.min(items.length, Math.max(columnCount * 2, 8))}
      style={{
        columnGap: `${columnGap}px`,
        height: usesWindowScroll ? undefined : (viewportHeight ?? '100%'),
        overflowX: usesWindowScroll ? undefined : 'hidden',
        overflowY: usesWindowScroll ? undefined : 'auto',
        paddingRight: usesWindowScroll ? undefined : '4px',
      }}
      ItemContent={MasonryItemContent}
    />
  )
}

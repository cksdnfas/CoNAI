import type { ReactNode } from 'react'
import { VirtuosoMasonry } from '@virtuoso.dev/masonry'
import type { ImageRecord } from '@/types/image'
import type { ImageListScrollMode } from './image-list-types'
import { ImageListItem } from './image-list-item'
import { useImageListColumnCount } from './use-image-list-column-count'

interface ImageListMasonryProps {
  containerElement: HTMLDivElement | null
  items: ImageRecord[]
  selectedIds: string[]
  selectionMode: boolean
  minColumnWidth: number
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

/** Render a reusable virtualized masonry layout with responsive column count. */
export function ImageListMasonry({
  containerElement,
  items,
  selectedIds,
  selectionMode,
  minColumnWidth,
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
  const columnCount = useImageListColumnCount(containerElement, minColumnWidth, columnGap)
  const usesWindowScroll = scrollMode === 'window'

  return (
    <VirtuosoMasonry<ImageRecord, undefined>
      data={items}
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
      ItemContent={({ data: image }) => {
        if (!image) {
          return null
        }

        const itemId = String(getItemId ? getItemId(image) : (image.composite_hash ?? image.id))

        return (
          <div key={itemId} style={{ paddingBottom: `${rowGap}px` }}>
            <ImageListItem
              key={itemId}
              image={image}
              itemId={itemId}
              href={getItemHref?.(image)}
              selected={selectedIds.includes(itemId)}
              selectionMode={selectionMode}
              onActivate={onActivate}
              renderOverlay={renderItemOverlay?.(image)}
              renderPersistentOverlay={renderItemPersistentOverlay?.(image)}
              blurPreview={shouldBlurItemPreview?.(image) ?? false}
            />
          </div>
        )
      }}
    />
  )
}

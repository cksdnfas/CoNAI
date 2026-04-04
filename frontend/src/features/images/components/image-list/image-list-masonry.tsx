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
  onActivate: (imageId: string, href?: string) => void
  scrollMode: ImageListScrollMode
  viewportHeight?: number | string
  renderItemOverlay?: (image: ImageRecord) => ReactNode
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
  onActivate,
  scrollMode,
  viewportHeight,
  renderItemOverlay,
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

        return (
          <div style={{ paddingBottom: `${rowGap}px` }}>
            <ImageListItem
              image={image}
              href={getItemHref?.(image)}
              selected={selectedIds.includes(String(image.composite_hash ?? image.id))}
              selectionMode={selectionMode}
              onActivate={onActivate}
              renderOverlay={renderItemOverlay?.(image)}
            />
          </div>
        )
      }}
    />
  )
}

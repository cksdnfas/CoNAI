import type { ReactNode } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import type { ImageRecord } from '@/types/image'
import type { ImageListScrollMode } from './image-list-types'
import { ImageListItem } from './image-list-item'

interface ImageListGridProps {
  items: ImageRecord[]
  selectedIds: string[]
  selectionMode: boolean
  minColumnWidth: number
  columnGap: number
  rowGap: number
  gridItemHeight: number
  getItemHref?: (image: ImageRecord) => string | undefined
  onActivate: (imageId: string, href?: string) => void
  scrollMode: ImageListScrollMode
  viewportHeight?: number | string
  onEndReached?: () => void
  renderItemOverlay?: (image: ImageRecord) => ReactNode
}

/** Render a reusable virtualized grid layout with equally sized cards. */
export function ImageListGrid({
  items,
  selectedIds,
  selectionMode,
  minColumnWidth,
  columnGap,
  rowGap,
  gridItemHeight,
  getItemHref,
  onActivate,
  scrollMode,
  viewportHeight,
  onEndReached,
  renderItemOverlay,
}: ImageListGridProps) {
  const usesWindowScroll = scrollMode === 'window'

  return (
    <div
      style={{
        ['--image-list-min-column-width' as string]: `${minColumnWidth}px`,
        ['--image-list-column-gap' as string]: `${columnGap}px`,
        ['--image-list-row-gap' as string]: `${rowGap}px`,
        height: usesWindowScroll ? undefined : (viewportHeight ?? '100%'),
      }}
    >
      <VirtuosoGrid<ImageRecord>
        data={items}
        useWindowScroll={usesWindowScroll}
        style={usesWindowScroll ? undefined : { height: '100%' }}
        overscan={{ main: 1200, reverse: 600 }}
        endReached={onEndReached}
        listClassName="image-list-grid"
        itemClassName="image-list-grid-item"
        computeItemKey={(_, item) => String(item.composite_hash ?? item.id)}
        itemContent={(_, image) => (
          <ImageListItem
            image={image}
            href={getItemHref?.(image)}
            selected={selectedIds.includes(String(image.composite_hash ?? image.id))}
            selectionMode={selectionMode}
            gridItemHeight={gridItemHeight}
            onActivate={onActivate}
            renderOverlay={renderItemOverlay?.(image)}
          />
        )}
      />
    </div>
  )
}

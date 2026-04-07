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
  getItemId?: (image: ImageRecord) => string
  onActivate: (image: ImageRecord, imageId: string, href?: string) => void
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
  getItemId,
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
        overflowX: usesWindowScroll ? undefined : 'hidden',
        paddingRight: usesWindowScroll ? undefined : '4px',
      }}
    >
      <VirtuosoGrid<ImageRecord>
        data={items}
        useWindowScroll={usesWindowScroll}
        style={usesWindowScroll ? undefined : { height: '100%', overflowX: 'hidden', overflowY: 'auto' }}
        overscan={{ main: 1200, reverse: 600 }}
        endReached={onEndReached}
        listClassName="image-list-grid"
        itemClassName="image-list-grid-item"
        computeItemKey={(index, item) => item ? String(getItemId ? getItemId(item) : (item.composite_hash ?? item.id ?? index)) : String(index)}
        itemContent={(_, image) => {
          if (!image) {
            return null
          }

          const itemId = String(getItemId ? getItemId(image) : (image.composite_hash ?? image.id))

          return (
            <ImageListItem
              image={image}
              itemId={itemId}
              href={getItemHref?.(image)}
              selected={selectedIds.includes(itemId)}
              selectionMode={selectionMode}
              gridItemHeight={gridItemHeight}
              onActivate={onActivate}
              renderOverlay={renderItemOverlay?.(image)}
            />
          )
        }}
      />
    </div>
  )
}

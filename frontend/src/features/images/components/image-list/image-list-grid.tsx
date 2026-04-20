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
  columnCount: number
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
  renderItemPersistentOverlay?: (image: ImageRecord) => ReactNode
  shouldBlurItemPreview?: (image: ImageRecord) => boolean
}

/** Render a reusable virtualized grid layout with equally sized cards. */
export function ImageListGrid({
  items,
  selectedIds,
  selectionMode,
  minColumnWidth,
  columnCount,
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
  renderItemPersistentOverlay,
  shouldBlurItemPreview,
}: ImageListGridProps) {
  const usesWindowScroll = scrollMode === 'window'
  const resolvedContainerHeight = usesWindowScroll
    ? undefined
    : typeof viewportHeight === 'number'
      ? viewportHeight
      : typeof viewportHeight === 'string' && viewportHeight !== '100%'
        ? viewportHeight
        : undefined

  return (
    <div
      style={{
        ['--image-list-min-column-width' as string]: `${minColumnWidth}px`,
        ['--image-list-column-repeat' as string]: String(columnCount),
        ['--image-list-column-gap' as string]: `${columnGap}px`,
        ['--image-list-row-gap' as string]: `${rowGap}px`,
        height: resolvedContainerHeight,
        minHeight: usesWindowScroll ? undefined : 0,
        flex: usesWindowScroll ? undefined : 1,
        display: usesWindowScroll ? undefined : 'flex',
        flexDirection: usesWindowScroll ? undefined : 'column',
        overflowX: usesWindowScroll ? undefined : 'hidden',
        paddingRight: usesWindowScroll ? undefined : '4px',
      }}
    >
      <VirtuosoGrid<ImageRecord>
        data={items}
        useWindowScroll={usesWindowScroll}
        style={usesWindowScroll ? undefined : { height: '100%', minHeight: 0, flex: 1, overflowX: 'hidden', overflowY: 'auto' }}
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
              renderPersistentOverlay={renderItemPersistentOverlay?.(image)}
              blurPreview={shouldBlurItemPreview?.(image) ?? false}
            />
          )
        }}
      />
    </div>
  )
}

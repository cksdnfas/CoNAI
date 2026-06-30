import { useMemo, type ReactNode } from 'react'
import { VirtuosoGrid, type GridComputeItemKey, type GridItemContent } from 'react-virtuoso'
import type { ImageRecord } from '@/types/image'
import type { ImageListScrollMode } from './image-list-types'
import { ImageListItem } from './image-list-item'

interface ImageListGridProps {
  items: ImageRecord[]
  selectedIdSet: ReadonlySet<string>
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
  showDefaultQuickActions?: boolean
  interactive?: boolean
  shouldBlurItemPreview?: (image: ImageRecord) => boolean
  onPreviewIntent?: (image: ImageRecord) => void
}

interface ImageListGridContext {
  selectedIdSet: ReadonlySet<string>
  selectionMode: boolean
  gridItemHeight: number
  getItemHref?: (image: ImageRecord) => string | undefined
  getItemId?: (image: ImageRecord) => string
  onActivate: (image: ImageRecord, imageId: string, href?: string) => void
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  renderItemPersistentOverlay?: (image: ImageRecord) => ReactNode
  showDefaultQuickActions?: boolean
  interactive?: boolean
  shouldBlurItemPreview?: (image: ImageRecord) => boolean
  onPreviewIntent?: (image: ImageRecord) => void
}

const computeImageGridItemKey: GridComputeItemKey<ImageRecord, ImageListGridContext> = (index, item, context) => (
  item ? String(context.getItemId ? context.getItemId(item) : (item.composite_hash ?? item.id ?? index)) : String(index)
)

const ImageGridItemContent: GridItemContent<ImageRecord, ImageListGridContext> = (_, image, context) => {
  if (!image) {
    return null
  }

  const itemId = String(context.getItemId ? context.getItemId(image) : (image.composite_hash ?? image.id))

  return (
    <ImageListItem
      image={image}
      itemId={itemId}
      href={context.getItemHref?.(image)}
      selected={context.selectedIdSet.has(itemId)}
      selectionMode={context.selectionMode}
      gridItemHeight={context.gridItemHeight}
      onActivate={context.onActivate}
      renderOverlay={context.renderItemOverlay?.(image)}
      renderPersistentOverlay={context.renderItemPersistentOverlay?.(image)}
      showDefaultQuickActions={context.showDefaultQuickActions}
      interactive={context.interactive}
      blurPreview={context.shouldBlurItemPreview?.(image) ?? false}
      onPreviewIntent={context.onPreviewIntent}
    />
  )
}

/** Render a reusable virtualized grid layout with equally sized cards. */
export function ImageListGrid({
  items,
  selectedIdSet,
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
  showDefaultQuickActions,
  interactive,
  shouldBlurItemPreview,
  onPreviewIntent,
}: ImageListGridProps) {
  const usesWindowScroll = scrollMode === 'window'
  const resolvedContainerHeight = usesWindowScroll
    ? undefined
    : typeof viewportHeight === 'number'
      ? viewportHeight
      : typeof viewportHeight === 'string' && viewportHeight !== '100%'
        ? viewportHeight
        : undefined
  const gridContext = useMemo<ImageListGridContext>(() => ({
    selectedIdSet,
    selectionMode,
    gridItemHeight,
    getItemHref,
    getItemId,
    onActivate,
    renderItemOverlay,
    renderItemPersistentOverlay,
    showDefaultQuickActions,
    interactive,
    shouldBlurItemPreview,
    onPreviewIntent,
  }), [
    selectedIdSet,
    selectionMode,
    gridItemHeight,
    getItemHref,
    getItemId,
    onActivate,
    renderItemOverlay,
    renderItemPersistentOverlay,
    showDefaultQuickActions,
    interactive,
    shouldBlurItemPreview,
    onPreviewIntent,
  ])

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
      <VirtuosoGrid<ImageRecord, ImageListGridContext>
        data={items}
        context={gridContext}
        useWindowScroll={usesWindowScroll}
        style={usesWindowScroll ? undefined : { height: '100%', minHeight: 0, flex: 1, overflowX: 'hidden', overflowY: 'auto' }}
        overscan={{ main: 1200, reverse: 600 }}
        endReached={onEndReached}
        listClassName="image-list-grid"
        itemClassName="image-list-grid-item"
        computeItemKey={computeImageGridItemKey}
        itemContent={ImageGridItemContent}
      />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, type ReactNode, type UIEvent } from 'react'
import { VirtuosoMasonry, type ItemContent } from '@virtuoso.dev/masonry'
import type { ImageRecord } from '@/types/image'
import type { ImageListScrollMode } from './image-list-types'
import { ImageListItem } from './image-list-item'

const CONTAINER_SCROLL_END_REACHED_THRESHOLD_PX = 800
const CONTAINER_UNFILLED_PANE_CHECK_MS = 300

interface ImageListMasonryProps {
  items: ImageRecord[]
  selectedIdSet: ReadonlySet<string>
  selectionMode: boolean
  columnCount: number
  columnGap: number
  rowGap: number
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

interface ImageListMasonryContext {
  rowGap: number
  selectedIdSet: ReadonlySet<string>
  selectionMode: boolean
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
        selected={context.selectedIdSet.has(itemId)}
        selectionMode={context.selectionMode}
        onActivate={context.onActivate}
        renderOverlay={context.renderItemOverlay?.(image)}
        renderPersistentOverlay={context.renderItemPersistentOverlay?.(image)}
        showDefaultQuickActions={context.showDefaultQuickActions}
        interactive={context.interactive}
        blurPreview={context.shouldBlurItemPreview?.(image) ?? false}
        onPreviewIntent={context.onPreviewIntent}
      />
    </div>
  )
}

/** Render a reusable virtualized masonry layout with responsive column count. */
export function ImageListMasonry({
  items,
  selectedIdSet,
  selectionMode,
  columnCount,
  columnGap,
  rowGap,
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
}: ImageListMasonryProps) {
  const usesWindowScroll = scrollMode === 'window'
  const itemCount = items.length
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onEndReachedRef = useRef(onEndReached)
  const endReachedItemCountRef = useRef(-1)

  useEffect(() => {
    onEndReachedRef.current = onEndReached
  }, [onEndReached])

  /**
   * Fire once per loaded item count. Masonry republishes column heights while items are measured,
   * so scrollHeight is not a stable dedupe key and would restart the in-flight page request.
   */
  const fireContainerEndReached = useCallback(() => {
    if (endReachedItemCountRef.current === itemCount) {
      return
    }

    endReachedItemCountRef.current = itemCount
    onEndReachedRef.current?.()
  }, [itemCount])

  /** Mirror VirtuosoGrid endReached for container scrolling since VirtuosoMasonry has no endReached API. */
  const handleContainerScrollCapture = useCallback((event: UIEvent<HTMLDivElement>) => {
    const scroller = event.target
    if (!(scroller instanceof HTMLElement) || scroller.parentElement !== event.currentTarget) {
      return
    }

    const distanceToEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (distanceToEnd > CONTAINER_SCROLL_END_REACHED_THRESHOLD_PX) {
      return
    }

    fireContainerEndReached()
  }, [fireContainerEndReached])

  /**
   * A page that does not fill the split pane never emits a scroll event, so auto-pagination would
   * never start. Re-check once the masonry settled; fireContainerEndReached changes per item count.
   */
  useEffect(() => {
    if (usesWindowScroll) {
      return
    }

    const settleTimeout = window.setTimeout(() => {
      const scroller = containerRef.current?.firstElementChild
      if (!(scroller instanceof HTMLElement) || scroller.scrollHeight === 0) {
        return
      }

      if (scroller.scrollHeight > scroller.clientHeight) {
        return
      }

      fireContainerEndReached()
    }, CONTAINER_UNFILLED_PANE_CHECK_MS)

    return () => window.clearTimeout(settleTimeout)
  }, [fireContainerEndReached, usesWindowScroll])
  const resolvedContainerHeight = usesWindowScroll
    ? undefined
    : typeof viewportHeight === 'number'
      ? viewportHeight
      : typeof viewportHeight === 'string' && viewportHeight !== '100%'
        ? viewportHeight
        : undefined
  const masonryContext = useMemo<ImageListMasonryContext>(() => ({
    rowGap,
    selectedIdSet,
    selectionMode,
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
    rowGap,
    selectedIdSet,
    selectionMode,
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

  const masonry = (
    <VirtuosoMasonry<ImageRecord, ImageListMasonryContext>
      data={items}
      context={masonryContext}
      useWindowScroll={usesWindowScroll}
      columnCount={columnCount}
      initialItemCount={Math.min(items.length, Math.max(columnCount * 2, 8))}
      style={{
        columnGap: `${columnGap}px`,
        height: resolvedContainerHeight,
        minHeight: usesWindowScroll ? undefined : 0,
        flex: usesWindowScroll ? undefined : 1,
        overflowX: usesWindowScroll ? undefined : 'hidden',
        overflowY: usesWindowScroll ? undefined : 'auto',
        paddingRight: usesWindowScroll ? undefined : '4px',
      }}
      ItemContent={MasonryItemContent}
    />
  )

  if (usesWindowScroll) {
    return masonry
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden" onScrollCapture={handleContainerScrollCapture}>
      {masonry}
    </div>
  )
}

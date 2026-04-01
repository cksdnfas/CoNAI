import { useCallback, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { markHomeScrollRestorePending } from '@/features/home/use-home-scroll-restoration'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { ImageListGrid } from './image-list-grid'
import { ImageListMasonry } from './image-list-masonry'
import type { ImageListProps } from './image-list-types'
import { useImageListLoadMore } from './use-image-list-load-more'
import { useImageListSelection } from './use-image-list-selection'

/** Render the reusable CoNAI image list using Virtuoso rendering + ViSelect selection. */
export function ImageList({
  items,
  layout = 'masonry',
  activationMode = 'navigate',
  getItemHref,
  selectable = false,
  forceSelectionMode = false,
  selectedIds = [],
  onSelectedIdsChange,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  minColumnWidth = 300,
  columnGap = 24,
  rowGap = 24,
  gridItemHeight = 280,
  className,
  scrollMode = 'window',
  viewportHeight,
  selectionAreaClass = 'image-list-selection-area',
  renderItemOverlay,
}: ImageListProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const imageViewModal = useImageViewModal()
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const selectionMode = selectable && (forceSelectionMode || selectedIds.length > 0)
  const itemCompositeHashes = useMemo(
    () => items.map((item) => item.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0),
    [items],
  )
  const loadMoreSentinelRef = useImageListLoadMore({
    hasMore: scrollMode === 'window' && hasMore,
    isLoadingMore,
    onLoadMore,
  })

  const handleEndReached = useCallback(() => {
    if (scrollMode !== 'container' || !hasMore || isLoadingMore || !onLoadMore) {
      return
    }

    void onLoadMore()
  }, [hasMore, isLoadingMore, onLoadMore, scrollMode])

  const { shouldSuppressClick } = useImageListSelection({
    containerElement,
    selectable,
    selectedIds,
    onSelectedIdsChange,
    onDragStateChange: setIsDraggingSelection,
    selectionAreaClass,
  })

  /** Handle item activation without forcing drag-preview rerender loops. */
  const handleActivate = useCallback(
    (imageId: string, href?: string) => {
      if (shouldSuppressClick()) {
        return
      }

      if (selectionMode && onSelectedIdsChange) {
        const nextSelectedIds = selectedIds.includes(imageId)
          ? selectedIds.filter((selectedId) => selectedId !== imageId)
          : [...selectedIds, imageId]
        onSelectedIdsChange(nextSelectedIds)
        return
      }

      if ((activationMode === 'modal' || activationMode === 'modal-single') && imageViewModal) {
        const modalCompositeHash = itemCompositeHashes.includes(imageId) ? imageId : null

        if (modalCompositeHash) {
          imageViewModal.openImageView(
            activationMode === 'modal'
              ? {
                  compositeHash: modalCompositeHash,
                  compositeHashes: itemCompositeHashes,
                }
              : {
                  compositeHash: modalCompositeHash,
                },
          )
          return
        }
      }

      if (href) {
        if (location.pathname === '/') {
          markHomeScrollRestorePending()
        }

        navigate(href, {
          state: {
            fromFeed: location.pathname === '/',
            sourcePath: location.pathname,
          },
        })
      }
    },
    [activationMode, imageViewModal, itemCompositeHashes, location.pathname, navigate, onSelectedIdsChange, selectedIds, selectionMode, shouldSuppressClick],
  )

  return (
    <div
      ref={setContainerElement}
      className={cn('relative image-list-root', className)}
      onMouseDown={(event) => {
        if (selectionMode && !isDraggingSelection && event.target === event.currentTarget) {
          onSelectedIdsChange?.([])
        }
      }}
    >
      {layout === 'grid' ? (
        <ImageListGrid
          items={items}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          minColumnWidth={minColumnWidth}
          columnGap={columnGap}
          rowGap={rowGap}
          gridItemHeight={gridItemHeight}
          getItemHref={getItemHref}
          onActivate={handleActivate}
          scrollMode={scrollMode}
          viewportHeight={viewportHeight}
          onEndReached={handleEndReached}
          renderItemOverlay={renderItemOverlay}
        />
      ) : (
        <ImageListMasonry
          containerElement={containerElement}
          items={items}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          minColumnWidth={minColumnWidth}
          columnGap={columnGap}
          rowGap={rowGap}
          getItemHref={getItemHref}
          onActivate={handleActivate}
          scrollMode={scrollMode}
          viewportHeight={viewportHeight}
          renderItemOverlay={renderItemOverlay}
        />
      )}

      {scrollMode === 'window' ? <div ref={loadMoreSentinelRef} className="h-px w-full" aria-hidden="true" /> : null}
    </div>
  )
}

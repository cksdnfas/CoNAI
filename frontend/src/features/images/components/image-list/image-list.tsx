import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { markHomeScrollRestorePending } from '@/features/home/use-home-scroll-restoration'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import type { ImageRecord } from '@/types/image'
const ImageListGridLazy = lazy(async () => {
  const module = await import('./image-list-grid')
  return { default: module.ImageListGrid }
})

const ImageListMasonryLazy = lazy(async () => {
  const module = await import('./image-list-masonry')
  return { default: module.ImageListMasonry }
})
import type { ImageListProps } from './image-list-types'
import { useImageListLoadMore } from './use-image-list-load-more'
import { useImageListSelection } from './use-image-list-selection'

function ImageListFallback() {
  return <div className="min-h-[18rem] rounded-sm bg-surface-low animate-pulse" />
}

/** Render the reusable CoNAI image list using Virtuoso rendering + ViSelect selection. */
export function ImageList({
  items,
  layout = 'masonry',
  activationMode = 'navigate',
  getItemHref,
  getItemId,
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
  renderItemPersistentOverlay,
  shouldBlurItemPreview,
  modalAccessOptions,
}: ImageListProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const imageViewModal = useImageViewModal()
  const modalNavigationSourceId = useId()
  const modalLoadMoreRequestKeyRef = useRef<string | null>(null)
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
    (image: ImageRecord, imageId: string, href?: string) => {
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
        const modalCompositeHash = typeof image.composite_hash === 'string' && image.composite_hash.trim().length > 0
          ? image.composite_hash
          : null

        if (modalCompositeHash) {
          imageViewModal.openImageView(
            activationMode === 'modal'
              ? {
                  compositeHash: modalCompositeHash,
                  compositeHashes: itemCompositeHashes,
                  sourceId: modalNavigationSourceId,
                  sourceItems: items,
                  accessOptions: modalAccessOptions,
                }
              : {
                  compositeHash: modalCompositeHash,
                  accessOptions: modalAccessOptions,
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
    [activationMode, imageViewModal, itemCompositeHashes, items, location.pathname, modalAccessOptions, modalNavigationSourceId, navigate, onSelectedIdsChange, selectedIds, selectionMode, shouldSuppressClick],
  )

  const activeModalIndexInList = useMemo(() => {
    const activeCompositeHash = imageViewModal?.activeCompositeHash
    if (activationMode !== 'modal' || !activeCompositeHash) {
      return -1
    }

    return itemCompositeHashes.indexOf(activeCompositeHash)
  }, [activationMode, imageViewModal?.activeCompositeHash, itemCompositeHashes])

  useEffect(() => {
    if (activationMode !== 'modal' || !imageViewModal?.activeCompositeHash || activeModalIndexInList < 0) {
      return
    }

    imageViewModal.syncImageViewSequence({
      compositeHashes: itemCompositeHashes,
      sourceId: modalNavigationSourceId,
      sourceItems: items,
    })
  }, [activationMode, activeModalIndexInList, imageViewModal, itemCompositeHashes, items, modalNavigationSourceId])

  useEffect(() => {
    if (activationMode !== 'modal') {
      modalLoadMoreRequestKeyRef.current = null
      return
    }

    const activeCompositeHash = imageViewModal?.activeCompositeHash
    if (!activeCompositeHash) {
      modalLoadMoreRequestKeyRef.current = null
      return
    }

    if (activeModalIndexInList < 0 || !hasMore || isLoadingMore || !onLoadMore) {
      return
    }

    const remainingItems = itemCompositeHashes.length - activeModalIndexInList - 1
    if (remainingItems > 8) {
      return
    }

    const requestKey = `${activeCompositeHash}:${itemCompositeHashes.length}`
    if (modalLoadMoreRequestKeyRef.current === requestKey) {
      return
    }

    modalLoadMoreRequestKeyRef.current = requestKey
    void onLoadMore()
  }, [activationMode, activeModalIndexInList, hasMore, imageViewModal?.activeCompositeHash, isLoadingMore, itemCompositeHashes.length, onLoadMore])

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
      <Suspense fallback={<ImageListFallback />}>
        {layout === 'grid' ? (
          <ImageListGridLazy
            items={items}
            selectedIds={selectedIds}
            getItemId={getItemId}
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
            renderItemPersistentOverlay={renderItemPersistentOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
          />
        ) : (
          <ImageListMasonryLazy
            containerElement={containerElement}
            items={items}
            selectedIds={selectedIds}
            getItemId={getItemId}
            selectionMode={selectionMode}
            minColumnWidth={minColumnWidth}
            columnGap={columnGap}
            rowGap={rowGap}
            getItemHref={getItemHref}
            onActivate={handleActivate}
            scrollMode={scrollMode}
            viewportHeight={viewportHeight}
            renderItemOverlay={renderItemOverlay}
            renderItemPersistentOverlay={renderItemPersistentOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
          />
        )}
      </Suspense>

      {scrollMode === 'window' ? <div ref={loadMoreSentinelRef} className="h-px w-full" aria-hidden="true" /> : null}
    </div>
  )
}

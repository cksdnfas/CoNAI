import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useImageViewModal, type ImageViewSequenceTotal } from '@/features/images/components/detail/image-view-modal-context'
import { prepareImageSourceState } from '@/features/images/image-source-navigation'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import type { ImageRecord } from '@/types/image'
const ImageListGridLazy = lazy(async () => {
  const module = await import('./image-list-grid')
  return { default: module.ImageListGrid }
})

const ImageListMasonryLazy = lazy(async () => {
  const module = await import('./image-list-masonry')
  return { default: module.ImageListMasonry }
})
import type { ImageListActivateModifiers, ImageListProps } from './image-list-types'
import { useImageListColumnCount } from './use-image-list-column-count'
import { useImageListLoadMore } from './use-image-list-load-more'
import { useImageListDragOut } from './use-image-list-drag-out'
import { useImageListSelection } from './use-image-list-selection'

/** Match the id the grid/masonry cells use so selection, ranges, and select-all agree. */
function resolveImageListItemId(image: ImageRecord, getItemId?: (image: ImageRecord) => string) {
  return String(getItemId ? getItemId(image) : (image.composite_hash ?? image.id))
}

function isKeyboardEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable
}

/** Any open dialog, drawer, or the image viewer owns Esc / Ctrl+A while it is up. */
function hasOpenDialog() {
  // Closed bottom drawers stay mounted with pointer-events off, so skip anything inert.
  for (const element of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
    if (element.dataset.state === 'closed' || window.getComputedStyle(element).pointerEvents === 'none') {
      continue
    }
    return true
  }
  return false
}

function ImageListFallback() {
  return <div className="min-h-[18rem] rounded-sm bg-surface-low animate-pulse" />
}

/** Render the reusable CoNAI image list using Virtuoso rendering + ViSelect selection. */
export function ImageList({
  items,
  resetKey,
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
  preferredColumnCount,
  columnGap = 24,
  rowGap = 24,
  gridItemHeight = 280,
  className,
  scrollMode = 'window',
  viewportHeight,
  selectionAreaClass = 'image-list-selection-area',
  renderItemOverlay,
  renderItemPersistentOverlay,
  showDefaultQuickActions = true,
  shouldBlurItemPreview,
  onPreviewIntent,
  modalAccessOptions,
  sequenceTotal,
  onItemDragStart,
}: ImageListProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const imageViewModal = useImageViewModal()
  const modalNavigationSourceId = useId()
  const modalLoadMoreRequestKeyRef = useRef<string | null>(null)
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const selectionMode = selectable && (forceSelectionMode || selectedIds.length > 0)
  const isCoarsePointer = useIsCoarsePointer()
  const canSelect = selectable && Boolean(onSelectedIdsChange)
  const alwaysShowSelectionControl = selectionMode || isCoarsePointer
  // Anchor for Shift+click ranges: the last tile toggled on its own.
  const selectionAnchorIdRef = useRef<string | null>(null)
  const itemIds = useMemo(() => items.map((item) => resolveImageListItemId(item, getItemId)), [getItemId, items])
  const itemIdIndex = useMemo(() => new Map(itemIds.map((itemId, index) => [itemId, index] as const)), [itemIds])
  const itemCompositeHashes = useMemo(
    () => items.map((item) => item.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0),
    [items],
  )
  // Keep modal next-page sync from scanning large media lists on every active image change.
  const itemCompositeHashIndex = useMemo(
    () => new Map(itemCompositeHashes.map((compositeHash, index) => [compositeHash, index] as const)),
    [itemCompositeHashes],
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // Rebuild from primitives so callers passing a fresh object each render do not re-run modal sync.
  const sequenceTotalStatus = sequenceTotal?.status
  const sequenceTotalCount = sequenceTotal?.status === 'known' ? sequenceTotal.count : null
  const stableSequenceTotal = useMemo<ImageViewSequenceTotal | undefined>(() => {
    if (sequenceTotalStatus === 'known') {
      return { status: 'known', count: sequenceTotalCount ?? 0 }
    }

    return sequenceTotalStatus ? { status: sequenceTotalStatus } : undefined
  }, [sequenceTotalCount, sequenceTotalStatus])
  const resolvedColumnCount = useImageListColumnCount(containerElement, minColumnWidth, columnGap, preferredColumnCount)
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

  /** Toggle one tile, or with Shift add every loaded tile between the anchor and it. */
  const handleToggleSelect = useCallback((_image: ImageRecord | null, imageId: string, modifiers?: ImageListActivateModifiers): void => {
    if (!onSelectedIdsChange) {
      return
    }

    const anchorId = selectionAnchorIdRef.current
    const anchorIndex = modifiers?.shiftKey && anchorId !== null && selectedIdSet.has(anchorId) ? itemIdIndex.get(anchorId) : undefined
    const targetIndex = itemIdIndex.get(imageId)
    if (anchorIndex !== undefined && targetIndex !== undefined) {
      const nextSelectedIds = [...selectedIds]
      const nextSelectedIdSet = new Set(selectedIds)
      const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
      for (let index = start; index <= end; index += 1) {
        const rangeId = itemIds[index]
        if (!nextSelectedIdSet.has(rangeId)) {
          nextSelectedIdSet.add(rangeId)
          nextSelectedIds.push(rangeId)
        }
      }
      onSelectedIdsChange(nextSelectedIds)
      return
    }

    selectionAnchorIdRef.current = imageId
    onSelectedIdsChange(selectedIdSet.has(imageId)
      ? selectedIds.filter((selectedId) => selectedId !== imageId)
      : [...selectedIds, imageId])
  }, [itemIdIndex, itemIds, onSelectedIdsChange, selectedIdSet, selectedIds])

  const handleLongPressSelect = useCallback((imageId: string) => {
    handleToggleSelect(null, imageId)
  }, [handleToggleSelect])

  const { isDragArmed } = useImageListDragOut({ containerElement, onItemDragStart })

  const { shouldSuppressClick } = useImageListSelection({
    containerElement,
    selectable,
    selectedIds,
    onSelectedIdsChange,
    onDragStateChange: setIsDraggingSelection,
    selectionAreaClass,
    onLongPressSelect: handleLongPressSelect,
    isDragArmed,
  })

  // Esc clears the selection; Ctrl/Cmd+A selects every loaded tile. Both yield to text fields and open dialogs.
  const keyboardStateRef = useRef({ itemIds, selectedCount: selectedIds.length, onSelectedIdsChange })
  useEffect(() => {
    keyboardStateRef.current = { itemIds, selectedCount: selectedIds.length, onSelectedIdsChange }
  }, [itemIds, onSelectedIdsChange, selectedIds.length])

  useEffect(() => {
    if (!canSelect) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isKeyboardEditingTarget(event.target) || hasOpenDialog()) {
        return
      }

      const { itemIds: currentItemIds, selectedCount, onSelectedIdsChange: commit } = keyboardStateRef.current
      if (!commit) {
        return
      }

      if (event.key === 'Escape' && selectedCount > 0) {
        event.preventDefault()
        selectionAnchorIdRef.current = null
        commit([])
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a' && currentItemIds.length > 0) {
        event.preventDefault()
        commit(Array.from(new Set(currentItemIds)))
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [canSelect])

  /** Handle item activation without forcing drag-preview rerender loops. */
  const handleActivate = useCallback(
    (image: ImageRecord, imageId: string, href?: string, modifiers?: ImageListActivateModifiers) => {
      if (shouldSuppressClick()) {
        return
      }

      // Shift+click starts or extends a selection even outside selection mode.
      if (canSelect && (selectionMode || modifiers?.shiftKey)) {
        handleToggleSelect(image, imageId, modifiers)
        return
      }

      if (activationMode === 'none') {
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
                  sequenceTotal: stableSequenceTotal,
                  sequenceHasMore: hasMore,
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
        navigate(href, { state: prepareImageSourceState({ pathname: location.pathname, search: location.search }) })
      }
    },
    [activationMode, canSelect, handleToggleSelect, hasMore, imageViewModal, itemCompositeHashes, items, location.pathname, location.search, modalAccessOptions, modalNavigationSourceId, navigate, selectionMode, shouldSuppressClick, stableSequenceTotal],
  )

  const handlePreviewIntent = useCallback((image: ImageRecord) => {
    onPreviewIntent?.(image)

    if (activationMode === 'none' || selectionMode || isDraggingSelection) {
      return
    }

    const compositeHash = typeof image.composite_hash === 'string' && image.composite_hash.trim().length > 0
      ? image.composite_hash
      : null

    if (!compositeHash) {
      return
    }

    void queryClient.prefetchQuery({
      queryKey: getImageDetailQueryKey(compositeHash, image),
      queryFn: ({ signal }) => getImage(compositeHash, { signal }, image),
      staleTime: 30_000,
    })
  }, [activationMode, isDraggingSelection, onPreviewIntent, queryClient, selectionMode])

  const activeModalIndexInList = useMemo(() => {
    const activeCompositeHash = imageViewModal?.activeCompositeHash
    if (activationMode !== 'modal' || !activeCompositeHash) {
      return -1
    }

    return itemCompositeHashIndex.get(activeCompositeHash) ?? -1
  }, [activationMode, imageViewModal?.activeCompositeHash, itemCompositeHashIndex])

  useEffect(() => {
    if (activationMode !== 'modal' || !imageViewModal?.activeCompositeHash || activeModalIndexInList < 0) {
      return
    }

    imageViewModal.syncImageViewSequence({
      compositeHashes: itemCompositeHashes,
      sourceId: modalNavigationSourceId,
      sourceItems: items,
      sequenceTotal: stableSequenceTotal,
      sequenceHasMore: hasMore,
    })
  }, [activationMode, activeModalIndexInList, hasMore, imageViewModal, itemCompositeHashes, items, modalNavigationSourceId, stableSequenceTotal])

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
      className={cn(
        'relative min-h-0 image-list-root',
        scrollMode === 'container' && 'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
        className,
      )}
      onMouseDown={(event) => {
        if (selectionMode && !isDraggingSelection && event.target === event.currentTarget) {
          selectionAnchorIdRef.current = null
          onSelectedIdsChange?.([])
        }
      }}
    >
      <div className={cn(scrollMode === 'container' && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        <Suspense fallback={<ImageListFallback />}>
          {layout === 'grid' ? (
            <ImageListGridLazy
              key={`grid:${resetKey ?? 'stable'}`}
              items={items}
              selectedIdSet={selectedIdSet}
              getItemId={getItemId}
              selectionMode={selectionMode}
              minColumnWidth={minColumnWidth}
              columnCount={resolvedColumnCount}
              columnGap={columnGap}
              rowGap={rowGap}
              gridItemHeight={gridItemHeight}
              getItemHref={getItemHref}
              onActivate={handleActivate}
              selectable={canSelect}
              alwaysShowSelectionControl={alwaysShowSelectionControl}
              onToggleSelect={handleToggleSelect}
              scrollMode={scrollMode}
              viewportHeight={viewportHeight}
              onEndReached={handleEndReached}
              renderItemOverlay={renderItemOverlay}
              renderItemPersistentOverlay={renderItemPersistentOverlay}
              showDefaultQuickActions={showDefaultQuickActions}
              interactive={activationMode !== 'none' || selectionMode}
              shouldBlurItemPreview={shouldBlurItemPreview}
              onPreviewIntent={handlePreviewIntent}
            />
          ) : (
            <ImageListMasonryLazy
              key={`masonry:${resetKey ?? 'stable'}`}
              items={items}
              selectedIdSet={selectedIdSet}
              getItemId={getItemId}
              selectionMode={selectionMode}
              columnCount={resolvedColumnCount}
              columnGap={columnGap}
              rowGap={rowGap}
              getItemHref={getItemHref}
              onActivate={handleActivate}
              selectable={canSelect}
              alwaysShowSelectionControl={alwaysShowSelectionControl}
              onToggleSelect={handleToggleSelect}
              scrollMode={scrollMode}
              viewportHeight={viewportHeight}
              onEndReached={handleEndReached}
              renderItemOverlay={renderItemOverlay}
              renderItemPersistentOverlay={renderItemPersistentOverlay}
              showDefaultQuickActions={showDefaultQuickActions}
              interactive={activationMode !== 'none' || selectionMode}
              shouldBlurItemPreview={shouldBlurItemPreview}
              onPreviewIntent={handlePreviewIntent}
            />
          )}
        </Suspense>
      </div>

      {scrollMode === 'window' ? <div ref={loadMoreSentinelRef} className="h-px w-full" aria-hidden="true" /> : null}
    </div>
  )
}

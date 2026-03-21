import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Masonry, type RenderComponentProps, useInfiniteLoader } from 'masonic'
import Selecto from 'react-selecto'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { ImageListItem } from './image-list-item'
import { getImageListItemId } from './image-list-utils'
import type { ImageListProps } from './image-list-types'

/** Check whether the selected id state actually changed before updating React state. */
function hasSelectedIdChange(currentSelectedIds: string[], nextSelectedIdSet: Set<string>) {
  if (currentSelectedIds.length !== nextSelectedIdSet.size) {
    return true
  }

  for (const selectedId of currentSelectedIds) {
    if (!nextSelectedIdSet.has(selectedId)) {
      return true
    }
  }

  return false
}

/** Build a stable selected id set from rendered DOM elements. */
function getSelectedIdSetFromElements(elements: Element[]) {
  const nextSelectedIds = new Set<string>()

  for (const element of elements) {
    const imageId = (element as HTMLElement).dataset.imageId
    if (imageId) {
      nextSelectedIds.add(imageId)
    }
  }

  return nextSelectedIds
}

/** Render a reusable virtualized image list with optional drag selection support. */
export function ImageList({
  items,
  getItemHref,
  selectable = false,
  selectedIds = [],
  onSelectedIdsChange,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  columnWidth = 320,
  columnGutter = 24,
  rowGutter = 24,
  itemHeightEstimate = 320,
  overscanBy = 2,
  className,
}: ImageListProps) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectionEnabled = selectable && Boolean(onSelectedIdsChange)
  const selectionMode = selectionEnabled && selectedIds.length > 0
  const pendingSelectedIdSetRef = useRef<Set<string> | null>(null)

  /** Bridge visible render progress to the parent paging mechanism. */
  const loadMoreItems = useCallback(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return
    return onLoadMore()
  }, [hasMore, isLoadingMore, onLoadMore])

  const maybeLoadMore = useInfiniteLoader(loadMoreItems, {
    isItemLoaded: (index, currentItems) => !hasMore || index < currentItems.length,
    minimumBatchSize: 24,
    threshold: 12,
    totalItems: hasMore ? items.length + 24 : items.length,
  })

  /** Update the pending selection set during drag without forcing React updates every frame. */
  const handleSelect = useCallback(
    (event: { selected: Element[] }) => {
      if (!selectionEnabled) return
      pendingSelectedIdSetRef.current = getSelectedIdSetFromElements(event.selected)
    },
    [selectionEnabled],
  )

  /** Commit the final selection only after drag selection ends. */
  const handleSelectEnd = useCallback(
    (event: { selected: Element[] }) => {
      if (!selectionEnabled || !onSelectedIdsChange) return

      const nextSelectedIds = pendingSelectedIdSetRef.current ?? getSelectedIdSetFromElements(event.selected)
      pendingSelectedIdSetRef.current = null

      if (!hasSelectedIdChange(selectedIds, nextSelectedIds)) {
        return
      }

      onSelectedIdsChange(Array.from(nextSelectedIds))
    },
    [onSelectedIdsChange, selectedIds, selectionEnabled],
  )

  /** Toggle a single selected image id while selection mode is active. */
  const handleToggleSelect = useCallback(
    (imageId: string) => {
      if (!selectionEnabled || !onSelectedIdsChange) return

      const nextSelectedIds = new Set(selectedIdSet)
      if (nextSelectedIds.has(imageId)) {
        nextSelectedIds.delete(imageId)
      } else {
        nextSelectedIds.add(imageId)
      }

      if (!hasSelectedIdChange(selectedIds, nextSelectedIds)) {
        return
      }

      onSelectedIdsChange(Array.from(nextSelectedIds))
    },
    [onSelectedIdsChange, selectedIdSet, selectedIds, selectionEnabled],
  )

  /** Block drag gestures from interactive elements that should not start selection. */
  const dragCondition = useCallback((event: { inputEvent?: MouseEvent | TouchEvent }) => {
    const target = event.inputEvent?.target
    return !(target instanceof HTMLElement && target.closest('[data-no-select-drag="true"]'))
  }, [])

  /** Clear active selection when the user presses Escape. */
  useEffect(() => {
    if (!selectionMode || !onSelectedIdsChange) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onSelectedIdsChange([])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSelectedIdsChange, selectionMode])

  /** Render an individual image list cell for Masonic. */
  const renderImageListItem = useCallback(
    ({ data }: RenderComponentProps<ImageRecord>) => {
      const imageId = getImageListItemId(data)
      return (
        <ImageListItem
          image={data}
          href={getItemHref?.(data)}
          selected={selectedIdSet.has(imageId)}
          selectionMode={selectionMode}
          onToggleSelect={handleToggleSelect}
        />
      )
    },
    [getItemHref, handleToggleSelect, selectedIdSet, selectionMode],
  )

  return (
    <div
      ref={setContainerElement}
      className={cn('relative', className)}
      onMouseDown={(event) => {
        if (selectionMode && event.target === event.currentTarget) {
          onSelectedIdsChange?.([])
        }
      }}
    >
      {selectionEnabled && containerElement ? (
        <Selecto
          container={containerElement}
          rootContainer={containerElement}
          dragContainer={containerElement}
          selectableTargets={['.image-list-item']}
          hitRate={8}
          selectByClick={false}
          selectFromInside={true}
          preventDragFromInside={true}
          preventDefault={true}
          preventClickEventOnDragStart={true}
          preventClickEventOnDrag={true}
          toggleContinueSelect="shift"
          dragCondition={dragCondition}
          onSelect={handleSelect}
          onSelectEnd={handleSelectEnd}
        />
      ) : null}

      <Masonry<ImageRecord>
        items={items}
        render={renderImageListItem}
        itemKey={(item) => getImageListItemId(item)}
        columnWidth={columnWidth}
        columnGutter={columnGutter}
        rowGutter={rowGutter}
        itemHeightEstimate={itemHeightEstimate}
        overscanBy={overscanBy}
        onRender={maybeLoadMore}
        className="image-list-masonry"
      />
    </div>
  )
}

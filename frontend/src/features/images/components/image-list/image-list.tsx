import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ImageListGrid } from './image-list-grid'
import { ImageListMasonry } from './image-list-masonry'
import type { ImageListProps } from './image-list-types'
import { useImageListLoadMore } from './use-image-list-load-more'
import { useImageListSelection } from './use-image-list-selection'

/** Render the reusable CoNAI image list using Virtuoso rendering + ViSelect selection. */
export function ImageList({
  items,
  layout = 'masonry',
  getItemHref,
  selectable = false,
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
}: ImageListProps) {
  const navigate = useNavigate()
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const selectionMode = selectable && selectedIds.length > 0
  const loadMoreSentinelRef = useImageListLoadMore({
    hasMore,
    isLoadingMore,
    onLoadMore,
  })

  const { shouldSuppressClick } = useImageListSelection({
    containerElement,
    selectable,
    selectedIds,
    onSelectedIdsChange,
    onDragStateChange: setIsDraggingSelection,
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

      if (href) {
        navigate(href, { state: { fromFeed: true } })
      }
    },
    [navigate, onSelectedIdsChange, selectedIds, selectionMode, shouldSuppressClick],
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
        />
      )}

      <div ref={loadMoreSentinelRef} className="h-px w-full" aria-hidden="true" />
    </div>
  )
}

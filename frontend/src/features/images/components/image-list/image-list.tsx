import { useCallback, useMemo, useState } from 'react'
import { Masonry, type RenderComponentProps, useInfiniteLoader } from 'masonic'
import Selecto from 'react-selecto'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { ImageListItem } from './image-list-item'
import { getImageListItemId } from './image-list-utils'
import type { ImageListProps } from './image-list-types'

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

  /** Convert drag-selected DOM nodes into stable image ids. */
  const handleSelect = useCallback(
    (event: { added: Element[]; removed: Element[] }) => {
      if (!selectable || !onSelectedIdsChange) return

      const nextSelectedIds = new Set(selectedIdSet)

      for (const element of event.added) {
        const imageId = (element as HTMLElement).dataset.imageId
        if (imageId) nextSelectedIds.add(imageId)
      }

      for (const element of event.removed) {
        const imageId = (element as HTMLElement).dataset.imageId
        if (imageId) nextSelectedIds.delete(imageId)
      }

      onSelectedIdsChange(Array.from(nextSelectedIds))
    },
    [onSelectedIdsChange, selectable, selectedIdSet],
  )

  /** Render an individual image list cell for Masonic. */
  const renderImageListItem = useCallback(
    ({ data }: RenderComponentProps<ImageRecord>) => {
      const imageId = getImageListItemId(data)
      return (
        <ImageListItem
          image={data}
          href={getItemHref?.(data)}
          selected={selectedIdSet.has(imageId)}
        />
      )
    },
    [getItemHref, selectedIdSet],
  )

  return (
    <div ref={setContainerElement} className={cn('relative', className)}>
      {selectable && containerElement ? (
        <Selecto
          dragContainer={containerElement}
          selectableTargets={['.image-list-item']}
          hitRate={20}
          selectByClick={false}
          selectFromInside={true}
          toggleContinueSelect="shift"
          onSelect={handleSelect}
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

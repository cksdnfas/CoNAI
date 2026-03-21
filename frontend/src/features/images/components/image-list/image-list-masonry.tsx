import { VirtuosoMasonry } from '@virtuoso.dev/masonry'
import type { ImageRecord } from '@/types/image'
import { ImageListItem } from './image-list-item'
import { useImageListColumnCount } from './use-image-list-column-count'

interface ImageListMasonryProps {
  containerElement: HTMLDivElement | null
  items: ImageRecord[]
  selectedIds: string[]
  selectionMode: boolean
  minColumnWidth: number
  columnGap: number
  rowGap: number
  getItemHref?: (image: ImageRecord) => string | undefined
  onActivate: (imageId: string, href?: string) => void
}

/** Render a reusable virtualized masonry layout with responsive column count. */
export function ImageListMasonry({
  containerElement,
  items,
  selectedIds,
  selectionMode,
  minColumnWidth,
  columnGap,
  rowGap,
  getItemHref,
  onActivate,
}: ImageListMasonryProps) {
  const columnCount = useImageListColumnCount(containerElement, minColumnWidth, columnGap)

  return (
    <VirtuosoMasonry<ImageRecord, undefined>
      data={items}
      useWindowScroll
      columnCount={columnCount}
      initialItemCount={Math.min(items.length, Math.max(columnCount * 2, 8))}
      style={{ columnGap: `${columnGap}px` }}
      ItemContent={({ data: image }) => (
        <div style={{ paddingBottom: `${rowGap}px` }}>
          <ImageListItem
            image={image}
            href={getItemHref?.(image)}
            selected={selectedIds.includes(String(image.composite_hash ?? image.id))}
            selectionMode={selectionMode}
            onActivate={onActivate}
          />
        </div>
      )}
    />
  )
}

import { ImageOff } from 'lucide-react'
import { memo, type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useState } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { ImageEditAction } from '@/features/images/components/detail/image-edit-action'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import {
  getImageListDisplayName,
  getImageListItemId,
  getImageListPreviewUrl,
} from './image-list-utils'

interface ImageListItemProps {
  image: ImageRecord
  href?: string
  selected?: boolean
  selectionMode?: boolean
  gridItemHeight?: number
  gridItemAspectRatio?: string
  itemId?: string
  onActivate?: (image: ImageRecord, itemId: string, href?: string) => void
  renderOverlay?: ReactNode
}

/** Prevent native media dragging so drag gestures can be used for selection. */
function preventNativeDrag(event: DragEvent<HTMLElement>) {
  event.preventDefault()
}

/** Render a reusable image list cell that supports image, GIF, and video previews. */
const ImageListItemComponent = memo(function ImageListItemComponent({
  image,
  href,
  selected = false,
  selectionMode = false,
  gridItemHeight,
  gridItemAspectRatio,
  itemId,
  onActivate,
  renderOverlay,
}: ImageListItemProps) {
  const previewUrl = getImageListPreviewUrl(image)
  const imageId = itemId ?? getImageListItemId(image)
  const displayName = getImageListDisplayName(image)
  const [hasPreviewError, setHasPreviewError] = useState(false)
  const aspectRatio = image.width && image.height ? `${image.width} / ${image.height}` : undefined
  const mediaFrameStyle = gridItemHeight
    ? { height: gridItemHeight }
    : gridItemAspectRatio
      ? { aspectRatio: gridItemAspectRatio }
      : aspectRatio
        ? { aspectRatio }
        : { aspectRatio: '4 / 5', minHeight: 240 }

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewUrl, image.is_processing, image.width, image.height, image.composite_hash, image.original_file_path])

  const placeholderLabel = image.is_processing
    ? '이미지 준비 중'
    : previewUrl && hasPreviewError
      ? '파일을 표시할 수 없어'
      : '미리보기 없음'

  const content = previewUrl && !hasPreviewError ? (
    <ImagePreviewMedia
      image={image}
      alt={displayName}
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
      style={mediaFrameStyle}
      loading="lazy"
      draggable={false}
      onDragStart={preventNativeDrag}
      onError={() => setHasPreviewError(true)}
    />
  ) : (
    <div
      className="flex flex-col items-center justify-center gap-2 bg-surface-lowest px-4 text-center text-sm text-muted-foreground"
      style={mediaFrameStyle}
    >
      <ImageOff className="h-10 w-10 opacity-70" />
      <span>{placeholderLabel}</span>
    </div>
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate?.(image, imageId, href)
    }
  }

  const quickActions = !selectionMode ? (
    <div
      className="absolute right-2 top-2 z-30 flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <ImageEditAction image={image} />
      {renderOverlay}
    </div>
  ) : renderOverlay ? <div className="absolute right-2 top-2 z-30">{renderOverlay}</div> : null

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'theme-list-shadow image-list-selectable group relative isolate block w-full overflow-hidden rounded-sm bg-surface-low text-left transition-transform duration-300 focus:outline-none focus:ring-2 focus:ring-primary/60',
        selected && 'is-selected',
        selectionMode ? 'cursor-default' : 'cursor-pointer',
      )}
      data-image-id={imageId}
      data-selected={selected ? 'true' : 'false'}
      aria-label={`${displayName} ${selectionMode ? 'select' : 'detail'}`}
      aria-pressed={selected}
      draggable={false}
      onDragStart={preventNativeDrag}
      onClick={() => onActivate?.(image, imageId, href)}
      onKeyDown={handleKeyDown}
    >
      <div className="relative bg-surface-lowest select-none">
        {content}
        {quickActions}
        <div className="image-list-selection-frame pointer-events-none absolute inset-0 z-20 rounded-sm" />
      </div>
    </div>
  )
})

ImageListItemComponent.displayName = 'ImageListItem'

export { ImageListItemComponent as ImageListItem }

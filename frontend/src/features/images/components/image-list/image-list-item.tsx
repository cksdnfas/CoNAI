import { memo, type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useState } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
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
  renderPersistentOverlay?: ReactNode
  blurPreview?: boolean
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
  renderPersistentOverlay,
  blurPreview = false,
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
  }, [previewUrl, image.is_processing, image.preview_status, image.file_status, image.width, image.height, image.composite_hash, image.original_file_path])

  const previewState = resolveImagePreviewState({
    image,
    hasPreviewUrl: Boolean(previewUrl),
    hasPreviewError,
  })
  const placeholderLabel = getImagePreviewStateLabel(previewState)

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
    <ImagePreviewPlaceholder
      label={placeholderLabel}
      className="text-sm"
      iconClassName="h-10 w-10"
      labelClassName="text-sm"
      style={mediaFrameStyle}
    />
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
        'theme-list-shadow image-list-selectable group relative isolate block w-full rounded-sm bg-surface-low text-left transition-transform duration-300 focus:outline-none focus:ring-2 focus:ring-primary/60 hover:z-10 focus-within:z-10',
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
      <div className="relative overflow-hidden rounded-sm bg-surface-lowest select-none">
        <div className={cn('transition duration-300', blurPreview && 'scale-[1.03] blur-2xl saturate-[0.55]')}>
          {content}
        </div>
        {blurPreview ? <div className="pointer-events-none absolute inset-0 z-10 bg-black/18" /> : null}
      </div>
      {renderPersistentOverlay ? <div className="image-list-persistent-overlay absolute inset-x-0 bottom-0 z-30 p-2">{renderPersistentOverlay}</div> : null}
      {quickActions}
      <div className="image-list-selection-frame pointer-events-none absolute inset-0 z-20 rounded-sm" />
    </div>
  )
})

ImageListItemComponent.displayName = 'ImageListItem'

export { ImageListItemComponent as ImageListItem }

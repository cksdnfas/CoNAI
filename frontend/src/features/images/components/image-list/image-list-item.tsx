import { memo, type DragEvent } from 'react'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import {
  getImageListDisplayName,
  getImageListItemId,
  getImageListMediaKind,
  getImageListPreviewUrl,
} from './image-list-utils'

interface ImageListItemProps {
  image: ImageRecord
  href?: string
  selected?: boolean
  selectionMode?: boolean
  gridItemHeight?: number
  gridItemAspectRatio?: string
  onActivate?: (imageId: string, href?: string) => void
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
  onActivate,
}: ImageListItemProps) {
  const previewUrl = getImageListPreviewUrl(image)
  const mediaKind = getImageListMediaKind(image)
  const imageId = getImageListItemId(image)
  const displayName = getImageListDisplayName(image)
  const aspectRatio = image.width && image.height ? `${image.width} / ${image.height}` : undefined
  const mediaFrameStyle = gridItemHeight
    ? { height: gridItemHeight }
    : gridItemAspectRatio
      ? { aspectRatio: gridItemAspectRatio }
      : aspectRatio
        ? { aspectRatio }
        : { aspectRatio: '4 / 5', minHeight: 240 }

  const content = previewUrl ? (
    mediaKind === 'video' ? (
      <video
        src={previewUrl}
        className="block h-full w-full object-cover"
        style={mediaFrameStyle}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        draggable={false}
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onDragStart={preventNativeDrag}
      />
    ) : (
      <img
        src={previewUrl}
        alt={displayName}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        style={mediaFrameStyle}
        loading="lazy"
        draggable={false}
        onDragStart={preventNativeDrag}
      />
    )
  ) : (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground"
      style={mediaFrameStyle}
    >
      미리보기 없음
    </div>
  )

  return (
    <button
      type="button"
      className={cn(
        'theme-list-shadow image-list-selectable group relative isolate block w-full overflow-hidden rounded-sm bg-surface-low text-left transition-transform duration-300',
        selected && 'is-selected',
        selectionMode ? 'cursor-default' : 'cursor-pointer',
      )}
      data-image-id={imageId}
      data-selected={selected ? 'true' : 'false'}
      aria-label={`${displayName} ${selectionMode ? 'select' : 'detail'}`}
      aria-pressed={selected}
      draggable={false}
      onDragStart={preventNativeDrag}
      onClick={() => onActivate?.(imageId, href)}
    >
      <div className="relative bg-surface-lowest select-none">
        {content}
        <div className="image-list-selection-frame pointer-events-none absolute inset-0 z-20 rounded-sm" />
      </div>
    </button>
  )
})

ImageListItemComponent.displayName = 'ImageListItem'

export { ImageListItemComponent as ImageListItem }

import type { DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import {
  getImageListDisplayName,
  getImageListItemId,
  getImageListMediaKind,
  getImageListPosterUrl,
  getImageListPreviewUrl,
} from './image-list-utils'

interface ImageListItemProps {
  image: ImageRecord
  href?: string
  selected?: boolean
  selectionMode?: boolean
  onToggleSelect?: (imageId: string) => void
}

/** Prevent native media/link dragging so drag gestures can be used for selection. */
function preventNativeDrag(event: DragEvent<HTMLElement>) {
  event.preventDefault()
}

/** Render a reusable image list cell that supports image, GIF, and video previews. */
export function ImageListItem({
  image,
  href,
  selected = false,
  selectionMode = false,
  onToggleSelect,
}: ImageListItemProps) {
  const previewUrl = getImageListPreviewUrl(image)
  const posterUrl = getImageListPosterUrl(image)
  const mediaKind = getImageListMediaKind(image)
  const imageId = getImageListItemId(image)
  const aspectRatio = image.width && image.height ? `${image.width} / ${image.height}` : undefined

  const content = previewUrl ? (
    mediaKind === 'video' ? (
      <video
        src={previewUrl}
        poster={posterUrl ?? undefined}
        className="block w-full object-cover"
        style={aspectRatio ? { aspectRatio } : undefined}
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
        alt={getImageListDisplayName(image)}
        className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        style={aspectRatio ? { aspectRatio } : undefined}
        loading="lazy"
        draggable={false}
        onDragStart={preventNativeDrag}
      />
    )
  ) : (
    <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">미리보기 없음</div>
  )

  const className = cn(
    'image-list-item group block overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.18)] transition-transform duration-300',
    selected && 'ring-[3px] ring-primary/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(255,181,154,0.16),0_0_32px_rgba(249,94,20,0.22)]',
  )

  const inner = <div className="bg-surface-lowest select-none">{content}</div>

  if (selectionMode) {
    return (
      <button
        type="button"
        className={cn(className, 'w-full cursor-default text-left')}
        data-image-id={imageId}
        data-selected={selected ? 'true' : 'false'}
        aria-label={`${getImageListDisplayName(image)} select`}
        draggable={false}
        onDragStart={preventNativeDrag}
        onClick={() => onToggleSelect?.(imageId)}
      >
        {inner}
      </button>
    )
  }

  if (!href) {
    return (
      <div
        className={className}
        data-image-id={imageId}
        data-selected={selected ? 'true' : 'false'}
        onDragStart={preventNativeDrag}
      >
        {inner}
      </div>
    )
  }

  return (
    <Link
      to={href}
      className={className}
      data-image-id={imageId}
      data-selected={selected ? 'true' : 'false'}
      aria-label={`${getImageListDisplayName(image)} detail`}
      draggable={false}
      onDragStart={preventNativeDrag}
    >
      {inner}
    </Link>
  )
}

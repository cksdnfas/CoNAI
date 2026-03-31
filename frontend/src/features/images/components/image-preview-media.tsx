import type { CSSProperties, DragEventHandler } from 'react'
import type { ImageRecord } from '@/types/image'
import {
  getImageListDisplayName,
  getImageListMediaKind,
  getImageListPreviewUrl,
} from './image-list/image-list-utils'

interface ImagePreviewMediaProps {
  image: ImageRecord | null | undefined
  className?: string
  style?: CSSProperties
  alt?: string
  loading?: 'lazy' | 'eager'
  draggable?: boolean
  onDragStart?: DragEventHandler<HTMLImageElement | HTMLVideoElement>
  onError?: () => void
}

/** Render preview media with shared image/GIF/video handling for card UIs. */
export function ImagePreviewMedia({
  image,
  className,
  style,
  alt,
  loading = 'lazy',
  draggable = false,
  onDragStart,
  onError,
}: ImagePreviewMediaProps) {
  if (!image) {
    return null
  }

  const previewUrl = getImageListPreviewUrl(image)
  if (!previewUrl) {
    return null
  }

  const mediaKind = getImageListMediaKind(image)
  const displayName = alt ?? getImageListDisplayName(image)

  if (mediaKind === 'video') {
    return (
      <video
        src={previewUrl}
        className={className}
        style={style}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        draggable={draggable}
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onDragStart={onDragStart}
        onError={() => onError?.()}
      />
    )
  }

  return (
    <img
      src={previewUrl}
      alt={displayName}
      className={className}
      style={style}
      loading={loading}
      draggable={draggable}
      onDragStart={onDragStart}
      onError={() => onError?.()}
    />
  )
}

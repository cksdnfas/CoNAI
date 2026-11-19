import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { isChatResultMedia } from '@/lib/chat-result-media'
import { useInView } from '@/lib/use-in-view'
import { useEffect, type CSSProperties, type DragEventHandler } from 'react'
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

/**
 * One <video> that only carries its source near the viewport; away from it the poster shows.
 * The element itself is the observed box (no wrapper), so the caller's sizing and positioning classes keep applying to it.
 */
function ViewportGatedVideoPreview({
  src,
  poster,
  className,
  style,
  draggable,
  onDragStart,
  onError,
}: {
  src: string
  poster?: string
  className?: string
  style?: CSSProperties
  draggable: boolean
  onDragStart?: DragEventHandler<HTMLImageElement | HTMLVideoElement>
  onError?: () => void
}) {
  const [ref, { visible: isInView }] = useInView<HTMLVideoElement>('200px 0px')

  // Removing `src` alone keeps the loaded stream playing; load() releases it and brings the poster back.
  useEffect(() => {
    const video = ref.current
    if (!isInView && video?.currentSrc) {
      video.load()
    }
  }, [isInView, ref])

  return (
    <video
      ref={ref}
      src={isInView ? src : undefined}
      poster={poster}
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
  const { canViewImages } = useImagePermissions()
  // Items with their own authorized detail scope (chat results, public workflow runs) are reauthorized by the server.
  if (!image || (!canViewImages && !isChatResultMedia(image) && !image.detail_url)) {
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
      <ViewportGatedVideoPreview
        src={previewUrl}
        poster={image.thumbnail_url ?? undefined}
        className={className}
        style={style}
        draggable={draggable}
        onDragStart={onDragStart}
        onError={onError}
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
      decoding="async"
      draggable={draggable}
      onDragStart={onDragStart}
      onError={() => onError?.()}
    />
  )
}

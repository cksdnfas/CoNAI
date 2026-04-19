import { type CSSProperties, type DragEventHandler, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { getImageListPreviewUrl } from './image-list-utils'

interface ImageListVideoPreviewProps {
  image: ImageRecord
  className?: string
  style?: CSSProperties
  draggable?: boolean
  onDragStart?: DragEventHandler<HTMLVideoElement>
  onError?: () => void
}

/** Render one list video preview without viewport-gated source attachment so nearby scroll does not retrigger loads. */
export function ImageListVideoPreview({
  image,
  className,
  style,
  draggable = false,
  onDragStart,
  onError,
}: ImageListVideoPreviewProps) {
  const previewUrl = getImageListPreviewUrl(image)
  const [hasLoadedFrame, setHasLoadedFrame] = useState(false)

  useEffect(() => {
    setHasLoadedFrame(false)
  }, [previewUrl])

  if (!previewUrl) {
    return null
  }

  const handlePreviewReady = () => {
    setHasLoadedFrame(true)
  }

  return (
    <div className="relative" style={style}>
      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[inherit] bg-surface-lowest transition-opacity duration-200',
          hasLoadedFrame ? 'opacity-0' : 'animate-pulse opacity-100',
        )}
      />
      <video
        src={previewUrl}
        className={cn(
          className,
          'transition-opacity duration-200',
          !hasLoadedFrame && 'opacity-0',
        )}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        draggable={draggable}
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onLoadedData={handlePreviewReady}
        onCanPlay={handlePreviewReady}
        onError={onError}
        onDragStart={onDragStart}
      />
    </div>
  )
}

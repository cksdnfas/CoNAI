import type { ImageRecord } from '@/types/image'
import { cn } from '@/lib/utils'
import { getImageListMediaKind } from '@/features/images/components/image-list/image-list-utils'

interface ImageDetailMediaProps {
  image: ImageRecord
  renderUrl: string | null
  className?: string
}

/** Render the main detail media using the correct element for image, GIF, or video files. */
export function ImageDetailMedia({ image, renderUrl, className }: ImageDetailMediaProps) {
  if (!renderUrl) {
    return <div className="text-sm text-muted-foreground">표시할 이미지가 없어</div>
  }

  const mediaKind = getImageListMediaKind(image)
  const altText = image.composite_hash || String(image.id)

  const mediaClassName = className ?? 'max-h-[80vh] w-full object-contain'

  if (mediaKind === 'video') {
    return (
      <video
        src={renderUrl}
        className={cn('bg-black', className ?? 'max-h-[80vh] w-full object-contain')}
        controls
        playsInline
        preload="metadata"
      />
    )
  }

  return <img src={renderUrl} alt={altText} className={mediaClassName} />
}

import type { ImageRecord } from '@/types/image'
import { getImageListMediaKind } from '@/features/images/components/image-list/image-list-utils'

interface ImageDetailMediaProps {
  image: ImageRecord
  renderUrl: string | null
}

/** Render the main detail media using the correct element for image, GIF, or video files. */
export function ImageDetailMedia({ image, renderUrl }: ImageDetailMediaProps) {
  if (!renderUrl) {
    return <div className="text-sm text-muted-foreground">표시할 이미지가 없어</div>
  }

  const mediaKind = getImageListMediaKind(image)
  const altText = image.composite_hash || String(image.id)

  if (mediaKind === 'video') {
    return (
      <video
        src={renderUrl}
        className="max-h-[80vh] w-full bg-black object-contain"
        controls
        playsInline
        preload="metadata"
      />
    )
  }

  return <img src={renderUrl} alt={altText} className="max-h-[80vh] w-full object-contain" />
}

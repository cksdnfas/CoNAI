import { useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import type { ChatAvatarCrop } from '@/lib/api-codex-chat'

/** Crop positions are percentages of the scaled cover image's overflow. */
export function chatAvatarCropStyle(crop?: ChatAvatarCrop | null): CSSProperties | undefined {
  if (!crop) return undefined
  const position = `${crop.x}% ${crop.y}%`
  return { objectPosition: position, transformOrigin: position, transform: `scale(${crop.scale})` }
}

/** Failed assets keep the placeholder; the server alone may supply a safe legacy fallback. */
export function ChatProfileImage({ src, thumbnailSrc, crop, fallback, className = 'size-full object-cover', onLoad }: {
  src?: string | null
  thumbnailSrc?: string | null
  crop?: ChatAvatarCrop | null
  fallback?: ReactNode
  className?: string
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void
}) {
  const { canViewImages } = useImagePermissions()
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null)
  const imageSrc = thumbnailSrc && thumbnailSrc !== failedThumbnail ? thumbnailSrc : src
  return canViewImages && src && failedSrc !== src
    ? <img key={imageSrc} src={imageSrc ?? undefined} alt="" draggable={false} className={className} style={chatAvatarCropStyle(crop)} onLoad={onLoad} onError={() => { if (thumbnailSrc && imageSrc === thumbnailSrc) setFailedThumbnail(thumbnailSrc); else setFailedSrc(src) }} />
    : fallback ?? null
}

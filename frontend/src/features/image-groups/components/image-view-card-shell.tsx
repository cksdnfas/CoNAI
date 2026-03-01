import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { ImageRecord } from '@/types/image'
import { getBackendOrigin } from '@/utils/backend'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'
import { useGroupPreviewImage } from '@/features/image-groups/hooks/use-group-preview-image'
import { ThumbnailCard } from '@/features/image-groups/components/thumbnail-card'

type PreviewImagesResponse = {
  success: boolean
  data?: ImageRecord[]
}

interface ImageViewCardShellProps {
  groupId: number
  ariaLabel: string
  onClick: () => void
  title: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  fetchPreviewImages: (groupId: number) => Promise<PreviewImagesResponse>
  onPreviewError?: (error: unknown) => void
}

export function ImageViewCardShell({
  groupId,
  ariaLabel,
  onClick,
  title,
  subtitle,
  badges,
  fetchPreviewImages,
  onPreviewError,
}: ImageViewCardShellProps) {
  const backendOrigin = getBackendOrigin()
  const preview = useGroupPreviewImage({
    groupId,
    fetchPreviewImages,
    onError: onPreviewError,
  })

  const previewUrl = useMemo(() => {
    if (!preview) {
      return null
    }

    const mediaUrl = buildPreviewMediaUrl(preview, backendOrigin)
    const isThumbnailCase = !preview.is_processing && Boolean(preview.composite_hash) && preview.file_type !== 'video' && preview.file_type !== 'animated'
    if (!isThumbnailCase) {
      return mediaUrl
    }

    const cacheBuster = preview.thumbnail_path ? `?v=${Date.parse(preview.first_seen_date)}` : ''
    return `${mediaUrl}${cacheBuster}`
  }, [backendOrigin, preview])

  const isVideo = preview?.file_type === 'video'
  const previewNode = useMemo(() => {
    if (!previewUrl) {
      return null
    }

    if (isVideo) {
      return <video className="h-full w-full object-cover" src={previewUrl} muted loop autoPlay playsInline />
    }

    return <img className="h-full w-full object-cover" src={previewUrl} alt={ariaLabel} loading="lazy" />
  }, [ariaLabel, isVideo, previewUrl])

  return (
    <ThumbnailCard
      ariaLabel={ariaLabel}
      onClick={onClick}
      title={title}
      subtitle={subtitle}
      badges={badges}
      preview={previewNode}
      className="border-2 border-primary"
    />
  )
}

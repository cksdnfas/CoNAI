import { useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import type { ImageRecord } from '@/types/image'
import { groupApi } from '@/services/group-api'
import { getBackendOrigin } from '@/utils/backend'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'
import { Badge } from '@/components/ui/badge'

interface ImageViewCardProps {
  group: GroupWithStats
  onClick: () => void
}

export function ImageViewCard({ group, onClick }: ImageViewCardProps) {
  const { t } = useTranslation('imageGroups')
  const backendOrigin = getBackendOrigin()
  const [preview, setPreview] = useState<ImageRecord | null>(null)

  useEffect(() => {
    let disposed = false

    const loadPreview = async () => {
      try {
        const response = await groupApi.getPreviewImages(group.id, 1, false)
        if (!disposed) {
          setPreview(response.success && response.data && response.data.length > 0 ? response.data[0] : null)
        }
      } catch (error) {
        if (!disposed) {
          console.error(`Failed to load direct preview image for group ${group.id}:`, error)
          setPreview(null)
        }
      }
    }

    void loadPreview()

    return () => {
      disposed = true
    }
  }, [group.id])

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

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-[5/7] w-full overflow-hidden rounded-md border-2 border-primary bg-card text-left transition hover:-translate-y-1 hover:shadow-lg"
    >
      {previewUrl ? (
        isVideo ? (
          <video className="absolute inset-0 h-full w-full object-cover" src={previewUrl} muted loop autoPlay playsInline />
        ) : (
          <img className="absolute inset-0 h-full w-full object-cover" src={previewUrl} alt={t('imageView.viewImages')} loading="lazy" />
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-muted/20 to-muted/60">
          <ImageIcon className="h-12 w-12 text-muted-foreground" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent" />

      <div className="absolute right-0 bottom-0 left-0 z-10 space-y-1 p-2">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="h-4 w-4 text-primary" />
          <p className="truncate text-sm font-medium text-white">{t('imageView.viewImages')}</p>
        </div>
        <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
          {t('groupCard.imageCount', { count: group.image_count || 0 })}
        </Badge>
      </div>
    </button>
  )
}

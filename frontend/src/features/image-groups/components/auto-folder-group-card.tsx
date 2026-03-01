import { useEffect, useMemo, useState } from 'react'
import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AutoFolderGroupWithStats } from '@comfyui-image-manager/shared'
import type { ImageRecord } from '@/types/image'
import { autoFolderGroupsApi } from '@/services/auto-folder-groups-api'
import { getBackendOrigin } from '@/utils/backend'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'
import { Badge } from '@/components/ui/badge'

interface AutoFolderGroupCardProps {
  group: AutoFolderGroupWithStats
  onClick: () => void
}

export function AutoFolderGroupCard({ group, onClick }: AutoFolderGroupCardProps) {
  const { t } = useTranslation('imageGroups')
  const backendOrigin = getBackendOrigin()
  const [preview, setPreview] = useState<ImageRecord | null>(null)

  useEffect(() => {
    let disposed = false

    const loadPreview = async () => {
      try {
        const response = await autoFolderGroupsApi.getPreviewImages(group.id, 1, true)
        if (!disposed) {
          setPreview(response.success && response.data && response.data.length > 0 ? response.data[0] : null)
        }
      } catch (error) {
        if (!disposed) {
          console.error(`Failed to load auto-folder preview for group ${group.id}:`, error)
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
      className="group relative aspect-[5/7] w-full overflow-hidden rounded-md border bg-card text-left transition hover:-translate-y-1 hover:shadow-lg"
    >
      {previewUrl ? (
        isVideo ? (
          <video className="absolute inset-0 h-full w-full object-cover" src={previewUrl} muted loop autoPlay playsInline />
        ) : (
          <img className="absolute inset-0 h-full w-full object-cover" src={previewUrl} alt={group.display_name} loading="lazy" />
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-muted/20 to-muted/60">
          <Folder className="h-12 w-12 text-muted-foreground" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent" />

      <div className="absolute right-0 bottom-0 left-0 z-10 space-y-1 p-2">
        <div className="flex items-center gap-1.5">
          <Folder className="h-4 w-4 text-primary" />
          <p className="truncate text-sm font-medium text-white">{group.display_name}</p>
        </div>

        <p className="truncate text-[11px] text-white/80">{group.folder_path}</p>

        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
            {t('groupCard.imageCount', { count: group.image_count || 0 })}
          </Badge>
          {group.child_count && group.child_count > 0 ? (
            <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
              {t('groupCard.folderCount', { count: group.child_count })}
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  )
}

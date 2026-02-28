import { useCallback, useEffect, useMemo, useState } from 'react'
import { Folder, Settings, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import type { ImageRecord } from '@/types/image'
import { groupApi } from '@/services/group-api'
import { getBackendOrigin } from '@/utils/backend'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface GroupCardProps {
  group: GroupWithStats & { child_count?: number; has_children?: boolean }
  onClick: () => void
  onSettingsClick?: (groupId: number) => void
}

function getPreviewMediaUrl(image: ImageRecord | null, backendOrigin: string) {
  if (!image) return null

  const isProcessing = image.is_processing || !image.composite_hash
  if (isProcessing) {
    return `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path || '')}`
  }

  if (image.file_type === 'video' || image.file_type === 'animated') {
    return `${backendOrigin}/api/images/${image.composite_hash}/file`
  }

  const cacheBuster = image.thumbnail_path ? `?v=${Date.parse(image.first_seen_date)}` : ''
  return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail${cacheBuster}`
}

export function GroupCard({ group, onClick, onSettingsClick }: GroupCardProps) {
  const { t } = useTranslation('imageGroups')
  const backendOrigin = getBackendOrigin()
  const [preview, setPreview] = useState<ImageRecord | null>(null)

  useEffect(() => {
    let disposed = false

    const loadPreview = async () => {
      try {
        const response = await groupApi.getPreviewImages(group.id, 1, true)
        if (!disposed) {
          setPreview(response.success && response.data && response.data.length > 0 ? response.data[0] : null)
        }
      } catch (error) {
        if (!disposed) {
          console.error(`Failed to load preview image for group ${group.id}:`, error)
          setPreview(null)
        }
      }
    }

    void loadPreview()

    return () => {
      disposed = true
    }
  }, [group.id])

  const previewUrl = useMemo(() => getPreviewMediaUrl(preview, backendOrigin), [backendOrigin, preview])
  const isVideo = preview?.file_type === 'video'

  const handleSettingsClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      onSettingsClick?.(group.id)
    },
    [group.id, onSettingsClick],
  )

  return (
    <div
      className="group relative aspect-[5/7] w-full overflow-hidden rounded-md border bg-card text-left transition hover:-translate-y-1 hover:shadow-lg"
    >
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={group.name}
      />

      {previewUrl ? (
        isVideo ? (
          <video className="pointer-events-none absolute inset-0 h-full w-full object-cover" src={previewUrl} muted loop autoPlay playsInline />
        ) : (
          <img className="pointer-events-none absolute inset-0 h-full w-full object-cover" src={previewUrl} alt={group.name} loading="lazy" />
        )
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-b from-muted/20 to-muted/60">
          <Folder className="h-12 w-12 text-muted-foreground" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent" />

      {onSettingsClick ? (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="absolute right-2 bottom-2 z-20 h-7 w-7 bg-black/60 text-white hover:bg-black/80"
          onClick={handleSettingsClick}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 space-y-1 p-2">
        <div className="flex items-center gap-1.5">
          <Folder className="h-4 w-4" style={{ color: group.color || 'hsl(var(--primary))' }} />
          <p className="truncate text-sm font-medium text-white">{group.name}</p>
        </div>

        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
            {t('groupCard.imageCount', { count: group.image_count || 0 })}
          </Badge>

          {group.child_count !== undefined && group.child_count > 0 ? (
            <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
              {t('groupCard.subgroupCount', { count: group.child_count })}
            </Badge>
          ) : null}

          {group.auto_collect_enabled ? (
            <Badge className="bg-primary/90 text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  )
}

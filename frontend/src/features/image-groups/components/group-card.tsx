import { useCallback, useMemo } from 'react'
import { Folder, Settings, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@conai/shared'
import { groupApi } from '@/services/group-api'
import { getBackendOrigin } from '@/utils/backend'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'
import { useGroupPreviewImage } from '@/features/image-groups/hooks/use-group-preview-image'
import { GroupTileBase } from '@/features/image-groups/components/group-tile-base'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface GroupCardProps {
  group: GroupWithStats & { child_count?: number; has_children?: boolean }
  onClick: () => void
  onSettingsClick?: (groupId: number) => void
}

export function GroupCard({ group, onClick, onSettingsClick }: GroupCardProps) {
  const { t } = useTranslation('imageGroups')
  const backendOrigin = getBackendOrigin()
  const fetchPreviewImages = useCallback((groupId: number) => groupApi.getPreviewImages(groupId, 1, true), [])
  const handlePreviewError = useCallback(
    (error: unknown) => {
      console.error(`Failed to load preview image for group ${group.id}:`, error)
    },
    [group.id],
  )
  const preview = useGroupPreviewImage({
    groupId: group.id,
    fetchPreviewImages,
    onError: handlePreviewError,
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

    return <img className="h-full w-full object-cover" src={previewUrl} alt={group.name} loading="lazy" />
  }, [group.name, isVideo, previewUrl])

  const handleSettingsClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      onSettingsClick?.(group.id)
    },
    [group.id, onSettingsClick],
  )

  return (
    <GroupTileBase
      ariaLabel={group.name}
      onClick={onClick}
      preview={previewNode}
      title={
        <div className="flex items-center gap-1.5">
          <Folder className="h-4 w-4" style={{ color: group.color || 'hsl(var(--primary))' }} />
          <p className="truncate text-sm font-medium text-white">{group.name}</p>
        </div>
      }
      badges={
        <>
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
        </>
      }
      secondaryAction={
        onSettingsClick ? (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="h-7 w-7 bg-black/60 text-white hover:bg-black/80"
            onClick={handleSettingsClick}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        ) : undefined
      }
    />
  )
}

import { useCallback } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import { groupApi } from '@/services/group-api'
import { Badge } from '@/components/ui/badge'
import { ImageViewCardShell } from '@/features/image-groups/components/image-view-card-shell'

interface ImageViewCardProps {
  group: GroupWithStats
  onClick: () => void
}

export function ImageViewCard({ group, onClick }: ImageViewCardProps) {
  const { t } = useTranslation('imageGroups')
  const fetchPreviewImages = useCallback((groupId: number) => groupApi.getPreviewImages(groupId, 1, false), [])
  const handlePreviewError = useCallback(
    (error: unknown) => {
      console.error(`Failed to load direct preview image for group ${group.id}:`, error)
    },
    [group.id],
  )

  return (
    <ImageViewCardShell
      groupId={group.id}
      ariaLabel={t('imageView.viewImages')}
      onClick={onClick}
      fetchPreviewImages={fetchPreviewImages}
      onPreviewError={handlePreviewError}
      title={
        <div className="flex items-center gap-1.5">
          <ImageIcon className="h-4 w-4 text-primary" />
          <p className="truncate text-sm font-medium text-white">{t('imageView.viewImages')}</p>
        </div>
      }
      badges={
        <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
          {t('groupCard.imageCount', { count: group.image_count || 0 })}
        </Badge>
      }
    />
  )
}

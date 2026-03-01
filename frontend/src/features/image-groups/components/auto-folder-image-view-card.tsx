import { useCallback } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AutoFolderGroupWithStats } from '@comfyui-image-manager/shared'
import { autoFolderGroupsApi } from '@/services/auto-folder-groups-api'
import { Badge } from '@/components/ui/badge'
import { ImageViewCardShell } from '@/features/image-groups/components/image-view-card-shell'

interface AutoFolderImageViewCardProps {
  group: AutoFolderGroupWithStats
  onClick: () => void
}

export function AutoFolderImageViewCard({ group, onClick }: AutoFolderImageViewCardProps) {
  const { t } = useTranslation('imageGroups')
  const fetchPreviewImages = useCallback((groupId: number) => autoFolderGroupsApi.getPreviewImages(groupId, 1, false), [])
  const handlePreviewError = useCallback(
    (error: unknown) => {
      console.error(`Failed to load direct auto-folder preview for group ${group.id}:`, error)
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

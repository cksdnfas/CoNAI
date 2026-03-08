import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { AutoFolderGroupWithStats } from '@conai/shared'
import { autoFolderGroupsApi } from '@/services/auto-folder-groups-api'
import { ImageViewCardShell } from '@/features/image-groups/components/image-view-card-shell'
import { createImageViewCardMeta } from '@/features/image-groups/components/image-view-card-meta'

interface AutoFolderImageViewCardProps {
  group: AutoFolderGroupWithStats
  onClick: () => void
}

export function AutoFolderImageViewCard({ group, onClick }: AutoFolderImageViewCardProps) {
  const { t } = useTranslation('imageGroups')
  const fetchPreviewImages = useCallback((groupId: number) => autoFolderGroupsApi.getPreviewImages(groupId, 1, false), [])
  const meta = createImageViewCardMeta({
    title: t('imageView.viewImages'),
    imageCountLabel: t('groupCard.imageCount', { count: group.image_count || 0 }),
  })
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
      title={meta.title}
      badges={meta.badges}
    />
  )
}

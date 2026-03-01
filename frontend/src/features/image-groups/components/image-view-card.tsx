import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import { groupApi } from '@/services/group-api'
import { ImageViewCardShell } from '@/features/image-groups/components/image-view-card-shell'
import { createImageViewCardMeta } from '@/features/image-groups/components/image-view-card-meta'

interface ImageViewCardProps {
  group: GroupWithStats
  onClick: () => void
}

export function ImageViewCard({ group, onClick }: ImageViewCardProps) {
  const { t } = useTranslation('imageGroups')
  const fetchPreviewImages = useCallback((groupId: number) => groupApi.getPreviewImages(groupId, 1, false), [])
  const meta = createImageViewCardMeta({
    title: t('imageView.viewImages'),
    imageCountLabel: t('groupCard.imageCount', { count: group.image_count || 0 }),
  })
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
      title={meta.title}
      badges={meta.badges}
    />
  )
}

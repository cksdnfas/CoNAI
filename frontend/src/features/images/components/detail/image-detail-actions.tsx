import { ArrowLeft, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import { ImageDeleteAction } from './image-delete-action'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'

interface ImageDetailActionsProps {
  downloadUrl?: string | null
  downloadName: string
  image?: ImageRecord
  isRefreshing: boolean
  onBack: () => void
  onRefresh: () => void
  /** Leave the page once the image is in the Recycle Bin. */
  onDeleted?: () => void
}

export function ImageDetailActions({ downloadUrl, image, isRefreshing, onBack, onRefresh, onDeleted }: ImageDetailActionsProps) {
  const { t } = useI18n()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-sm" variant="secondary" onClick={onBack} aria-label={t('images.components.detail.image.detail.actions.back.to.feed')} title={t('images.components.detail.image.detail.actions.back.to.feed')}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="secondary" onClick={onRefresh} disabled={isRefreshing} aria-label={t('images.components.detail.image.detail.actions.refresh')} title={t('images.components.detail.image.detail.actions.refresh')}>
        <RefreshCcw className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      </Button>
      <ImageEditAction image={image} />
      <ImageGroupAssignAction image={image} />
      {downloadUrl ? <ImageDownloadTriggerButton image={image} /> : null}
      <ImageDeleteAction image={image} onDeleted={onDeleted} />
    </div>
  )
}

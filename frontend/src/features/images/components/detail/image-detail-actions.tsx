import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCcw, ScanSearch } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import type { ImageDetailSequence } from '../../use-image-detail-sequence'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import { ImageDeleteAction } from './image-delete-action'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'
import { ImageMetadataEditAction } from './image-metadata-edit-action'

interface ImageDetailActionsProps {
  downloadUrl?: string | null
  downloadName: string
  image?: ImageRecord
  isRefreshing: boolean
  onBack: () => void
  onRefresh: () => void
  /** Leave the page once the image is in the Recycle Bin. */
  onDeleted?: () => void
  /** Previous / next within the list the page was opened from; null hides the stepper. */
  sequence?: ImageDetailSequence | null
  /** Similar / duplicate scan: shown when the image can be scanned. */
  similarity?: { available: boolean; active: boolean; onRequest: () => void }
}

/**
 * Top bar of the image page, same arrangement as the viewer: back · ‹ N / total › on the left, icon actions on the
 * right (similar scan, group, metadata, editor, download, delete). Flat row with a hairline below.
 */
export function ImageDetailActions({ downloadUrl, image, isRefreshing, onBack, onRefresh, onDeleted, sequence, similarity }: ImageDetailActionsProps) {
  const { t, formatNumber } = useI18n()
  const positionLabel = sequence
    ? `${formatNumber(sequence.index + 1)} / ${formatNumber(Math.max(sequence.total ?? 0, sequence.loadedCount))}${sequence.total === null && sequence.hasMore ? '+' : ''}`
    : null

  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-1 gap-y-2 border-b border-line py-2">
      <IconButton size="icon-sm" variant="ghost" onClick={onBack} label={t('images.components.detail.image.detail.actions.back.to.feed')}>
        <ArrowLeft className="size-4" />
      </IconButton>

      {sequence ? (
        <div className="flex items-center">
          <IconButton size="icon-sm" variant="ghost" onClick={sequence.goPrevious} disabled={!sequence.previousHash} label={t('images.components.detail.image.view.modal.overlay.previous.images')}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <span className="min-w-14 px-1 text-center text-sm tabular-nums text-muted-foreground">{positionLabel}</span>
          <IconButton size="icon-sm" variant="ghost" onClick={sequence.goNext} disabled={!sequence.nextHash} label={t('images.components.detail.image.view.modal.overlay.next.images')}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {image?.is_processing ? (
          <IconButton size="icon-sm" variant="ghost" onClick={onRefresh} disabled={isRefreshing} label={t('images.components.detail.image.detail.actions.refresh')}>
            <RefreshCcw className={isRefreshing ? 'size-4 animate-spin' : 'size-4'} />
          </IconButton>
        ) : null}
        {similarity?.available ? (
          <IconButton
            size="icon-sm"
            variant="ghost"
            active={similarity.active}
            onClick={similarity.onRequest}
            label={t({ ko: '유사/중복 검사', en: 'Check similar/duplicates' })}
          >
            <ScanSearch className="size-4" />
          </IconButton>
        ) : null}
        <ImageGroupAssignAction image={image} variant="ghost" />
        <ImageMetadataEditAction image={image} />
        <ImageEditAction image={image} variant="ghost" />
        {downloadUrl ? <ImageDownloadTriggerButton image={image} variant="ghost" size="icon-sm" /> : null}
        <ImageDeleteAction image={image} variant="ghost" onDeleted={onDeleted} />
      </div>
    </div>
  )
}

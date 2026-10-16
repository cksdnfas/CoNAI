import type { ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCcw, ScanSearch } from 'lucide-react'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import type { ImageDetailSequence } from '../../use-image-detail-sequence'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import { useImageDeleteMenuAction } from './image-delete-action'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'
import { useImageMetadataEditMenuAction } from './image-metadata-edit-action'
import { useImageSpriteMenuAction } from './image-sprite-action'

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
  /** Extra controls at the end of the row (the page's layout preset picker). */
  trailing?: ReactNode
}

/**
 * Top bar of the image page, same arrangement as the viewer: back · ‹ N / total › on the left, icon actions on the
 * right (group, editor, download, then ⋯ with metadata, similar scan, sprites and delete). Flat row with a hairline below.
 */
export function ImageDetailActions({ downloadUrl, image, isRefreshing, onBack, onRefresh, onDeleted, sequence, similarity, trailing }: ImageDetailActionsProps) {
  const { t, formatNumber } = useI18n()
  const positionLabel = sequence
    ? `${formatNumber(sequence.index + 1)} / ${formatNumber(Math.max(sequence.total ?? 0, sequence.loadedCount))}${sequence.total === null && sequence.hasMore ? '+' : ''}`
    : null
  const metadataAction = useImageMetadataEditMenuAction(image)
  const spriteAction = useImageSpriteMenuAction(image)
  const deleteAction = useImageDeleteMenuAction(image, onDeleted)
  const moreEntries: ActionMenuEntry[] = [
    metadataAction,
    similarity?.available ? { key: 'similarity', icon: ScanSearch, label: t({ ko: '유사/중복 검사', en: 'Check similar/duplicates' }), onSelect: similarity.onRequest } : null,
    spriteAction,
    '-',
    deleteAction,
  ]

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
        <ImageGroupAssignAction image={image} variant="ghost" />
        <ImageEditAction image={image} variant="ghost" />
        {downloadUrl ? <ImageDownloadTriggerButton image={image} variant="ghost" size="icon-sm" /> : null}
        <ActionMenuButton entries={moreEntries} label={t({ ko: '더 보기', en: 'More' })} variant="ghost" size="icon-sm" />
        {trailing}
      </div>
    </div>
  )
}

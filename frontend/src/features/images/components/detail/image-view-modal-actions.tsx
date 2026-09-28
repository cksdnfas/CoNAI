import { useLocation, useNavigate } from 'react-router-dom'
import { ExternalLink, RefreshCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { formatCountDisplay } from '@/lib/count-display'
import { type ImageDetailViewHeaderControls } from '@/features/images/image-detail-view'
import { prepareImageSourceState } from '@/features/images/image-source-navigation'
import { GenerationHistoryReuseActions } from '@/features/image-generation/components/generation-history-reuse-actions'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import type { ImageViewModalAccessOptions, ImageViewSequenceTotal } from './image-view-modal-context'

interface ImageViewModalActionsProps {
  compositeHash: string
  activeIndex: number
  /** Number of loaded items the modal can step through. */
  totalCount: number
  sequenceTotal?: ImageViewSequenceTotal | null
  sequenceHasMore?: boolean
  controls: ImageDetailViewHeaderControls
  accessOptions?: ImageViewModalAccessOptions
  onClose: () => void
}

/** Render the header action area shared by the full and medium modal surfaces. */
export function ImageViewModalActions({
  compositeHash,
  activeIndex,
  totalCount,
  sequenceTotal = null,
  sequenceHasMore = false,
  controls,
  accessOptions,
  onClose,
}: ImageViewModalActionsProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { t, formatNumber } = useI18n()
  const showCounter = activeIndex >= 0 && (
    totalCount > 1
    || sequenceHasMore
    || (sequenceTotal !== null && (sequenceTotal.status !== 'known' || sequenceTotal.count > 1))
  )
  // The denominator is the source's real total, never just the loaded page. Without a total
  // source, a trailing "+" marks that more items can still be loaded.
  const counterLabel = sequenceTotal
    ? formatCountDisplay({
      total: sequenceTotal.status === 'known' ? Math.max(sequenceTotal.count, totalCount) : null,
      status: sequenceTotal.status === 'unavailable' ? 'error' : sequenceTotal.status,
      position: activeIndex + 1,
    }, { t, formatNumber }).text
    : `${formatNumber(activeIndex + 1)} / ${formatNumber(totalCount)}${sequenceHasMore ? '+' : ''}`

  const allowDetailNavigation = accessOptions?.allowDetailNavigation !== false
  const allowEditAction = accessOptions?.allowEditAction !== false
  const allowGroupAssignAction = accessOptions?.allowGroupAssignAction !== false
  const historyReuseId = accessOptions?.allowHistoryReuseActions === true && typeof controls.image?.generation_history_id === 'number'
    ? controls.image.generation_history_id
    : null

  const openDetailPage = () => {
    navigate(`/images/${compositeHash}`, { state: prepareImageSourceState(location) })
    onClose()
  }

  const overlayButtonClassName = 'border-white/14 bg-black/42 text-white shadow-[0_12px_32px_rgba(0,0,0,0.38)] hover:bg-black/62 hover:text-white'

  const navigationButtons = (
    <>
      <Button size="icon-sm" variant="secondary" className={overlayButtonClassName} onClick={onClose} aria-label={t('images.components.detail.image.view.modal.actions.close')} title={t('images.components.detail.image.view.modal.actions.close')}>
        <X className="h-4 w-4" />
      </Button>
      {showCounter ? <div className="shrink-0 px-2 text-xs text-muted-foreground">{counterLabel}</div> : null}
      {allowDetailNavigation ? (
        <Button size="icon-sm" variant="outline" className={overlayButtonClassName} onClick={openDetailPage} aria-label={t('images.components.detail.image.view.modal.actions.open.detail.page')} title={t('images.components.detail.image.view.modal.actions.detail.page')}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      ) : null}
      <Button size="icon-sm" variant="outline" className={overlayButtonClassName} onClick={controls.refresh} disabled={controls.isRefreshing} aria-label={t('images.components.detail.image.view.modal.actions.refresh')} title={t('images.components.detail.image.view.modal.actions.refresh')}>
        <RefreshCcw className={controls.isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      </Button>
    </>
  )

  const historyReuseButtons = historyReuseId !== null ? <GenerationHistoryReuseActions key={historyReuseId} historyId={historyReuseId} /> : null
  const groupAssignButton = allowGroupAssignAction ? <ImageGroupAssignAction image={controls.image} /> : null
  const editButton = allowEditAction ? <ImageEditAction image={controls.image} /> : null
  const downloadButton = controls.downloadUrl ? <ImageDownloadTriggerButton image={controls.image} variant="outline" className={overlayButtonClassName} /> : null

  return (
    <div className="image-detail-modal-toolbar-actions flex w-full min-w-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-center gap-2">
        {navigationButtons}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {historyReuseButtons}
        {editButton}
        {groupAssignButton}
        {downloadButton}
      </div>
    </div>
  )
}

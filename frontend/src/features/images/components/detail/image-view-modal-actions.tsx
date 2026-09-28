import { useLocation, useNavigate } from 'react-router-dom'
import { ExternalLink, RefreshCcw, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { formatCountDisplay } from '@/lib/count-display'
import { type ImageDetailViewHeaderControls } from '@/features/images/image-detail-view'
import { prepareImageSourceState } from '@/features/images/image-source-navigation'
import { GenerationHistoryReuseActions } from '@/features/image-generation/components/generation-history-reuse-actions'
import { ImageDeleteAction } from './image-delete-action'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import { useImageViewModal, type ImageViewModalAccessOptions, type ImageViewSequenceTotal } from './image-view-modal-context'

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
  const imageViewModal = useImageViewModal()
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
  const allowDeleteAction = accessOptions?.allowDeleteAction === true
  const historyReuseId = accessOptions?.allowHistoryReuseActions === true && typeof controls.image?.generation_history_id === 'number'
    ? controls.image.generation_history_id
    : null

  const openDetailPage = () => {
    navigate(`/images/${compositeHash}`, { state: prepareImageSourceState(location) })
    onClose()
  }

  // The toolbar floats over the photo stage, so its buttons use a translucent backdrop scrim instead of a surface tone.
  const overlayButtonClassName = 'bg-backdrop/50 text-white shadow-elevation-1 backdrop-blur-md hover:bg-backdrop/80 hover:text-white'

  const navigationButtons = (
    <>
      <IconButton size="icon-sm" variant="ghost" className={overlayButtonClassName} onClick={onClose} label={t('images.components.detail.image.view.modal.actions.close')}>
        <X className="h-4 w-4" />
      </IconButton>
      {showCounter ? <div className="shrink-0 px-2 text-xs tabular-nums text-white/80">{counterLabel}</div> : null}
      {allowDetailNavigation ? (
        <IconButton size="icon-sm" variant="ghost" className={overlayButtonClassName} onClick={openDetailPage} label={t('images.components.detail.image.view.modal.actions.open.detail.page')}>
          <ExternalLink className="h-4 w-4" />
        </IconButton>
      ) : null}
      {/* The record is refetched every time the viewer opens (staleTime 0); a manual refresh only helps while it is still processing. */}
      {controls.image?.is_processing ? (
        <IconButton size="icon-sm" variant="ghost" className={overlayButtonClassName} onClick={controls.refresh} disabled={controls.isRefreshing} label={t('images.components.detail.image.view.modal.actions.refresh')}>
          <RefreshCcw className={controls.isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </IconButton>
      ) : null}
    </>
  )

  const historyReuseButtons = historyReuseId !== null ? <GenerationHistoryReuseActions key={historyReuseId} historyId={historyReuseId} /> : null
  const groupAssignButton = allowGroupAssignAction ? <ImageGroupAssignAction image={controls.image} /> : null
  const editButton = allowEditAction ? <ImageEditAction image={controls.image} /> : null
  const downloadButton = controls.downloadUrl ? <ImageDownloadTriggerButton image={controls.image} variant="ghost" className={overlayButtonClassName} /> : null
  const deleteButton = allowDeleteAction ? (
    <ImageDeleteAction
      image={controls.image}
      className={overlayButtonClassName}
      onDeleted={(deletedCompositeHash) => (imageViewModal ? imageViewModal.removeImageFromView(deletedCompositeHash) : onClose())}
    />
  ) : null

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
        {deleteButton}
      </div>
    </div>
  )
}

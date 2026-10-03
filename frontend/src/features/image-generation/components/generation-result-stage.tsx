import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, ImageIcon, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Progress } from '@/components/ui/progress'
import { ImageDeleteAction } from '@/features/images/components/detail/image-delete-action'
import { ImageGroupAssignAction } from '@/features/images/components/detail/image-group-assign-action'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { ImageDownloadTriggerButton } from '@/features/images/components/image-download-trigger-button'
import { getImageListMediaKind } from '@/features/images/components/image-list/image-list-utils'
import { useI18n } from '@/i18n'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { GenerationHistoryReuseActions } from './generation-history-reuse-actions'
import {
  getGenerationQueueLaneLabel,
  getGenerationQueueProgressPercent,
  getGenerationQueueProgressStageLabel,
  getGenerationQueueRemainingLabel,
  getGenerationQueueStatusLabel,
  getGenerationQueueWaitLabel,
} from './generation-queue-ui'

type GenerationResultStageProps = {
  items: ImageRecord[]
  selected: ImageRecord | null
  onSelect: (id: string) => void
  isLoading: boolean
  activeJob: GenerationQueueJobRecord | null
  activeJobCount: number
  nowMs: number
  /** Stacks the actions under the image and shortens the stage (narrow layout). */
  compact?: boolean
  allowReuse?: boolean
  shouldBlur?: (image: ImageRecord) => boolean
  onDeleted?: () => void
  onShowHistory?: () => void
}

/**
 * Progress for the requester's running or queued job on this provider.
 * `inline` sits in the meta-line slot under the media so it never covers video controls;
 * the floating card is only used on an empty stage.
 */
function StageJobProgress({ job, jobCount, nowMs, inline = false }: { job: GenerationQueueJobRecord; jobCount: number; nowMs: number; inline?: boolean }) {
  const { t, formatNumber } = useI18n()
  const isRunning = job.status === 'running'
  const percent = getGenerationQueueProgressPercent(job, nowMs)
  const title = isRunning
    ? getGenerationQueueProgressStageLabel(job, t, formatNumber)
    : getGenerationQueueStatusLabel(job, t)
  const detail = isRunning
    ? getGenerationQueueRemainingLabel(job, t, formatNumber, nowMs)
    : getGenerationQueueWaitLabel(job, t, formatNumber) ?? getGenerationQueueLaneLabel(job, t, formatNumber)

  return (
    <div
      role="status"
      className={cn(
        'w-full',
        inline ? 'space-y-1.5' : 'max-w-sm space-y-2 rounded-md bg-surface-container/90 p-3 shadow-elevation-2 backdrop-blur-md',
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-foreground">
          {title}
          {jobCount > 1 ? <span className="ml-1.5 text-muted-foreground">+{formatNumber(jobCount - 1)}</span> : null}
        </span>
        {detail ? <span className="shrink-0 tabular-nums text-muted-foreground">{detail}</span> : null}
      </div>
      <Progress size="sm" value={isRunning ? percent : null} aria-label={title ?? undefined} />
    </div>
  )
}

/** One compact line of the selected result's size and sampling settings, read from its image metadata. */
function StageMetaLine({ image }: { image: ImageRecord }) {
  const { formatNumber } = useI18n()
  const compositeHash = image.composite_hash
  const detailQuery = useQuery({
    queryKey: getImageDetailQueryKey(compositeHash ?? '', image),
    queryFn: ({ signal }) => getImage(compositeHash as string, { signal }, image),
    enabled: Boolean(compositeHash),
    staleTime: 60_000,
  })
  const detail = detailQuery.data
  const params = detail?.ai_metadata?.generation_params
  const width = detail?.width ?? image.width
  const height = detail?.height ?? image.height
  const parts = [
    width && height ? `${formatNumber(width)}×${formatNumber(height)}` : null,
    params?.steps != null ? `${formatNumber(params.steps)} steps` : null,
    params?.sampler || null,
    params?.seed != null ? `seed ${params.seed}` : null,
  ].filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  return <div className="truncate text-xs tabular-nums text-muted-foreground">{parts.join(' · ')}</div>
}

/** Large view of the latest (or picked) generation result with its actions and a filmstrip of recent results. */
export function GenerationResultStage({
  items,
  selected,
  onSelect,
  isLoading,
  activeJob,
  activeJobCount,
  nowMs,
  compact = false,
  allowReuse = true,
  shouldBlur,
  onDeleted,
  onShowHistory,
}: GenerationResultStageProps) {
  const { t } = useI18n()
  const imageViewModal = useImageViewModal()
  const stripRef = useRef<HTMLDivElement | null>(null)
  const selectedId = selected ? String(selected.id) : null
  const isBlurred = selected ? shouldBlur?.(selected) ?? false : false
  const isVideo = selected ? getImageListMediaKind(selected) === 'video' : false

  useEffect(() => {
    if (!selectedId || !stripRef.current) {
      return
    }

    const thumb = stripRef.current.querySelector<HTMLElement>(`[data-stage-id="${CSS.escape(selectedId)}"]`)
    thumb?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId])

  const handleStripKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    const index = items.findIndex((item) => String(item.id) === selectedId)
    const next = items[index + (event.key === 'ArrowRight' ? 1 : -1)]
    if (!next) {
      return
    }

    event.preventDefault()
    onSelect(String(next.id))
    stripRef.current?.querySelector<HTMLElement>(`[data-stage-id="${CSS.escape(String(next.id))}"]`)?.focus()
  }

  const handleOpenDetail = () => {
    if (!selected?.composite_hash || !imageViewModal) {
      return
    }

    const sourceItems = items.filter((item) => Boolean(item.composite_hash))
    imageViewModal.openImageView({
      compositeHash: selected.composite_hash,
      compositeHashes: sourceItems.map((item) => item.composite_hash as string),
      sourceId: 'generation-result-stage',
      sourceItems,
      accessOptions: {
        allowDetailNavigation: false,
        allowEditAction: allowReuse,
        allowGroupAssignAction: allowReuse,
        allowHistoryReuseActions: allowReuse,
      },
    })
  }

  if (isLoading && items.length === 0) {
    return <LoadingState variant="inline" label={t('image-generation.components.generation.history.panel.loading.history')} />
  }

  const historyId = typeof selected?.generation_history_id === 'number' ? selected.generation_history_id : null
  const actions = selected ? (
    <div className={cn('flex shrink-0 gap-1.5', compact ? 'flex-row flex-wrap justify-end' : 'flex-col')}>
      {allowReuse ? <ImageGroupAssignAction key={`group-${selectedId}`} image={selected} /> : null}
      {allowReuse && historyId !== null ? <GenerationHistoryReuseActions key={historyId} historyId={historyId} /> : null}
      <ImageDownloadTriggerButton image={selected} size="icon-sm" variant="secondary" />
      <IconButton size="icon-sm" variant="secondary" onClick={handleOpenDetail} label={t({ ko: '크게 보기', en: 'Open viewer' })}>
        <Maximize2 />
      </IconButton>
      {allowReuse ? <ImageDeleteAction key={`delete-${selectedId}`} image={selected} onDeleted={() => onDeleted?.()} /> : null}
    </div>
  ) : null

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', !compact && 'flex-1')}>
      <div className={cn('flex min-h-0 gap-3', compact ? 'flex-col' : 'flex-1')}>
        <div
          className={cn(
            // No frame: the image (on its checkerboard) is the object on the page background.
            'relative flex min-w-0 items-center justify-center overflow-hidden',
            compact ? 'min-h-48' : 'min-h-[16rem] flex-1',
          )}
        >
          {selected ? (
            isVideo ? (
              <video
                key={selectedId}
                src={selected.image_url ?? undefined}
                poster={selected.thumbnail_url ?? undefined}
                controls
                className={cn('max-w-full object-contain', compact ? 'max-h-[62vh]' : 'max-h-full', isBlurred && 'blur-2xl saturate-[0.55]')}
              />
            ) : (
              <img
                key={selectedId}
                src={selected.image_url ?? selected.thumbnail_url ?? undefined}
                alt=""
                className={cn('bg-checker max-w-full object-contain', compact ? 'max-h-[62vh]' : 'max-h-full', isBlurred && 'blur-2xl saturate-[0.55]')}
              />
            )
          ) : activeJob ? null : (
            <EmptyState
              className="h-full bg-transparent"
              icon={ImageIcon}
              title={t('image-generation.components.generation.history.panel.no.generation.results.to.display.yet')}
            />
          )}

          {activeJob && !selected ? (
            <div className="pointer-events-none absolute inset-3 flex items-center justify-center">
              <StageJobProgress job={activeJob} jobCount={activeJobCount} nowMs={nowMs} />
            </div>
          ) : null}
        </div>
        {actions}
      </div>

      {activeJob && selected ? <StageJobProgress job={activeJob} jobCount={activeJobCount} nowMs={nowMs} inline /> : null}
      {selected ? <StageMetaLine key={selectedId} image={selected} /> : null}

      {items.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2">
          <div
            ref={stripRef}
            role="listbox"
            aria-label={t({ ko: '최근 결과', en: 'Recent results' })}
            aria-orientation="horizontal"
            onKeyDown={handleStripKeyDown}
            className="flex min-w-0 flex-1 gap-2 overflow-x-auto p-1"
          >
            {items.map((item) => {
              const id = String(item.id)
              const isActive = id === selectedId
              return (
                <Button
                  key={id}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={isActive}
                  tabIndex={isActive || (selectedId === null && item === items[0]) ? 0 : -1}
                  data-stage-id={id}
                  onClick={() => onSelect(id)}
                  className={cn(
                    'relative h-16 w-auto shrink-0 overflow-hidden rounded-sm p-0 opacity-70 hover:opacity-100 sm:h-20',
                    isActive && 'opacity-100 ring-2 ring-primary ring-offset-2 ring-offset-background',
                  )}
                >
                  <img
                    src={item.thumbnail_url ?? undefined}
                    alt=""
                    loading="lazy"
                    className={cn('h-full w-auto max-w-none object-contain', shouldBlur?.(item) && 'blur-md')}
                    style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
                  />
                </Button>
              )
            })}
          </div>
          {onShowHistory ? (
            <IconButton size="icon-sm" variant="ghost" onClick={onShowHistory} label={t({ ko: '전체 기록', en: 'All history' })}>
              <History />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

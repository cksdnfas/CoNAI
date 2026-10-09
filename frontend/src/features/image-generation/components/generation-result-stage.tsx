import { useEffect, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AudioLines, ChevronLeft, ChevronRight, History, ImageIcon, Info, Maximize2 } from 'lucide-react'
import { useHorizontalDragScroll } from '@/components/common/use-horizontal-drag-scroll'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Progress } from '@/components/ui/progress'
import { Tip } from '@/components/ui/tooltip'
import { DownloadSoundButton, HistoryAudioResult, HistorySoundBar, OpenSoundsInAudioTab } from '@/features/audio/history-audio-result'
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
 * `inline` is a bare gauge under the media (the stage/ETA text moves to its tooltip) so it never covers video controls;
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

  if (inline) {
    const label = [title, jobCount > 1 ? `+${formatNumber(jobCount - 1)}` : null, detail].filter(Boolean).join(' · ')
    return (
      <Tip content={label || null}>
        <Progress size="sm" value={isRunning ? percent : null} aria-label={label || undefined} />
      </Tip>
    )
  }

  return (
    <div role="status" className="w-full max-w-sm space-y-2 rounded-md bg-surface-container/90 p-3 shadow-elevation-2 backdrop-blur-md">
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

/** Info icon whose tooltip lists the selected result's size and sampling settings, read from its image metadata. */
function StageMetaInfo({ image }: { image: ImageRecord }) {
  const { t, formatNumber } = useI18n()
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

  const summary = parts.join('\n')
  return (
    <Tip content={summary} side="left" className="whitespace-pre-line tabular-nums">
      <span
        tabIndex={0}
        aria-label={`${t({ ko: '생성 설정', en: 'Generation settings' })}: ${parts.join(', ')}`}
        className="inline-flex size-8 shrink-0 cursor-help items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <Info className="size-4" />
      </span>
    </Tip>
  )
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
  const {
    scrollRef: stripRef,
    canScrollLeft,
    canScrollRight,
    isDragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleItemClick,
  } = useHorizontalDragScroll(items.length)
  const selectedId = selected ? String(selected.id) : null
  const isBlurred = selected ? shouldBlur?.(selected) ?? false : false
  const isVideo = selected ? getImageListMediaKind(selected) === 'video' : false
  // Sounds instead of a picture take the stage; sounds beside a picture play from a row under it.
  const sounds = selected?.audio?.length && !selected.composite_hash ? selected.audio : null
  const extraSounds = selected?.audio?.length && selected.composite_hash ? selected.audio : null

  useEffect(() => {
    if (!selectedId || !stripRef.current) {
      return
    }

    const thumb = stripRef.current.querySelector<HTMLElement>(`[data-stage-id="${CSS.escape(selectedId)}"]`)
    thumb?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, stripRef])

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
  // A sound-only run has no picture: the image actions (group, viewer, delete) do not apply.
  const actions = selected && sounds ? (
    <div className={cn('flex shrink-0 gap-1.5', compact ? 'flex-row flex-wrap justify-end' : 'flex-col')}>
      {allowReuse && historyId !== null ? <GenerationHistoryReuseActions key={historyId} historyId={historyId} /> : null}
      <DownloadSoundButton sound={sounds[0]} />
      <OpenSoundsInAudioTab sounds={sounds} />
    </div>
  ) : selected ? (
    <div className={cn('flex shrink-0 gap-1.5', compact ? 'flex-row flex-wrap justify-end' : 'flex-col')}>
      {allowReuse ? <ImageGroupAssignAction key={`group-${selectedId}`} image={selected} /> : null}
      {allowReuse && historyId !== null ? <GenerationHistoryReuseActions key={historyId} historyId={historyId} /> : null}
      <ImageDownloadTriggerButton image={selected} size="icon-sm" variant="secondary" />
      <IconButton size="icon-sm" variant="secondary" onClick={handleOpenDetail} label={t({ ko: '크게 보기', en: 'Open viewer' })}>
        <Maximize2 />
      </IconButton>
      {allowReuse ? <ImageDeleteAction key={`delete-${selectedId}`} image={selected} onDeleted={() => onDeleted?.()} /> : null}
      <StageMetaInfo key={`meta-${selectedId}`} image={selected} />
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
            sounds ? (
              <HistoryAudioResult key={selectedId} sounds={sounds} size="stage" />
            ) : isVideo ? (
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

      {/* Fixed-height slot: the gauge coming and going must not resize the media above it. */}
      {selected ? (
        <div className="flex h-1 shrink-0 items-center">
          {activeJob ? <StageJobProgress job={activeJob} jobCount={activeJobCount} nowMs={nowMs} inline /> : null}
        </div>
      ) : null}
      {extraSounds ? (
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1"><HistorySoundBar key={selectedId} sounds={extraSounds} /></div>
          <OpenSoundsInAudioTab sounds={extraSounds} />
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
          <div
            ref={stripRef}
            role="listbox"
            aria-label={t({ ko: '최근 결과', en: 'Recent results' })}
            aria-orientation="horizontal"
            onKeyDown={handleStripKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
            onClickCapture={handleItemClick}
            style={{ touchAction: 'pan-y pinch-zoom' }}
            // Scrollbar hidden (it ran into the active thumb's ring); edge chevrons + drag replace it.
            className={cn('theme-nav-scroll flex gap-2 overflow-x-auto p-1.5', isDragging && 'cursor-grabbing select-none')}
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
                  draggable={false}
                  className={cn(
                    'relative h-16 w-auto shrink-0 overflow-hidden rounded-sm p-0 opacity-70 hover:opacity-100 sm:h-20',
                    isDragging && 'pointer-events-none',
                    isActive && 'opacity-100 ring-2 ring-primary ring-offset-2 ring-offset-background',
                  )}
                >
                  {item.audio?.length && !item.composite_hash ? (
                    <span className="flex aspect-square h-full items-center justify-center bg-surface-low text-muted-foreground">
                      <AudioLines className="size-6" />
                    </span>
                  ) : (
                    <img
                      src={item.thumbnail_url ?? undefined}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className={cn('h-full w-auto max-w-none object-contain', shouldBlur?.(item) && 'blur-md')}
                      style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
                    />
                  )}
                  {item.audio?.length && item.composite_hash ? (
                    <span className="absolute right-1 bottom-1 rounded-sm bg-backdrop/70 p-0.5 text-white">
                      <AudioLines className="size-3" />
                    </span>
                  ) : null}
                </Button>
              )
            })}
          </div>
          {canScrollLeft ? (
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center bg-gradient-to-r from-background via-background/90 to-transparent pr-4 pl-1 text-foreground/45">
              <ChevronLeft className="h-4 w-4" />
            </div>
          ) : null}
          {canScrollRight ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center bg-gradient-to-l from-background via-background/90 to-transparent pl-4 pr-1 text-foreground/55">
              <ChevronRight className="h-4 w-4" />
            </div>
          ) : null}
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

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Ban, ChevronDown, CircleX, ClipboardCopy, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { useI18n } from '@/i18n'
import type { GenerationHistoryRecord, GenerationServiceType } from '@/lib/api-image-generation-types'
import { copyTextToClipboard } from '@/lib/clipboard'
import { parseServerDate } from '@/lib/server-time'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { canRetryHistoryQueueJob, getErrorMessage, getRetryableHistoryQueueJobId, resolveHistoryDisplayStatus } from '../image-generation-shared'
import { getHistoryRecordStatusSummary, mapHistoryRecordToImageRecord } from './generation-history-panel-helpers'
import { GenerationHistoryHeader } from './generation-history-header'
import { useGenerationHistoryReuse } from './generation-history-reuse-actions'
import { useGenerationHistoryActions } from './use-generation-history-actions'
import type { GenerationHistoryFeed } from './use-generation-history-feed'

export type GenerationLogStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** One status per log row; a run that ended without a result is failed unless the queue says it was cancelled. */
export function getGenerationLogStatus(record: GenerationHistoryRecord): GenerationLogStatus {
  const status = resolveHistoryDisplayStatus(record)
  if (status === 'pending' || status === 'processing') return 'running'
  if (status === 'completed') return 'completed'
  return record.queue_status === 'cancelled' ? 'cancelled' : 'failed'
}

const NO_RECORDS: GenerationHistoryRecord[] = []
const NO_IDS: number[] = []
const noop = () => {}

function secondsBetween(from?: string | null, to?: string | null) {
  if (!from || !to) return null
  const seconds = Math.round((parseServerDate(to).getTime() - parseServerDate(from).getTime()) / 1000)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

type GenerationLogPanelProps = {
  feed: GenerationHistoryFeed
  serviceType: GenerationServiceType
  workflowId?: number | null
  publicWorkflowSlug?: string | null
  splitPaneScroll?: boolean
  onBack?: () => void
  headerLeading?: ReactNode
  shouldBlur?: (image: ImageRecord) => boolean
}

/** Generation log: one hairline row per run; failed and cancelled rows open to the full error, timing and a rerun. */
export function GenerationLogPanel({ feed, serviceType, workflowId, publicWorkflowSlug, splitPaneScroll = false, onBack, headerLeading, shouldBlur }: GenerationLogPanelProps) {
  const { t, formatNumber, formatDate, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const imageViewModal = useImageViewModal()
  const reuse = useGenerationHistoryReuse()
  const { historyQuery, historyRecords, refreshHistory, isAdmin, isPublicView, isHistoryLoading } = feed
  const [filter, setFilter] = useState<'all' | 'failed'>('all')
  const [openId, setOpenId] = useState<number | null>(null)
  const { inFlight, cleanupFailed } = useMemo(() => getHistoryRecordStatusSummary(historyRecords), [historyRecords])
  const {
    isCleaningFailed,
    isClearingHistory,
    retryingQueueJobIds,
    isRetryingRunRecovery,
    handleCleanupFailed,
    handleClearHistory,
    handleRetryHistoryRecord,
  } = useGenerationHistoryActions({
    serviceType,
    workflowId,
    publicWorkflowSlug,
    isAdmin,
    isPublicView,
    refreshHistory,
    setSelectedHistoryIds: noop,
    selectedHistoryRecords: NO_RECORDS,
    selectedRetryableHistoryRecords: NO_RECORDS,
    downloadableHistoryRecords: NO_RECORDS,
    downloadableHistoryIds: NO_IDS,
  })

  const rows = useMemo(
    () => historyRecords.map((record) => ({ record, status: getGenerationLogStatus(record), image: mapHistoryRecordToImageRecord(record) })),
    [historyRecords],
  )
  const visibleRows = useMemo(() => {
    const filtered = filter === 'failed' ? rows.filter((row) => row.status === 'failed' || row.status === 'cancelled') : rows
    const dated = filtered.map((row) => {
      const created = row.record.created_at ? parseServerDate(row.record.created_at) : null
      return { ...row, created, day: created ? formatDate(created) : '' }
    })
    return dated.map((row, index) => ({ ...row, dayHeading: index === 0 || row.day !== dated[index - 1].day ? row.day : null }))
  }, [filter, formatDate, rows])
  const resultImages = useMemo(() => rows.map((row) => row.image).filter((image) => Boolean(image.composite_hash)), [rows])

  const formatSeconds = (seconds: number) => seconds < 60
    ? t({ ko: '{s}초', en: '{s}s' }, { s: formatNumber(seconds) })
    : t({ ko: '{m}분 {s}초', en: '{m}m {s}s' }, { m: formatNumber(Math.floor(seconds / 60)), s: formatNumber(seconds % 60) })

  const formatStage = (raw?: string | null) => {
    if (!raw) return null
    try {
      const stage = JSON.parse(raw) as { phase?: string; node_id?: string | null; node_label?: string | null }
      const phaseLabels: Record<string, string> = {
        preparing: t({ ko: '준비', en: 'Preparing' }),
        executing: t({ ko: '실행', en: 'Executing' }),
        sampling: t({ ko: '샘플링', en: 'Sampling' }),
        finalizing: t({ ko: '마무리', en: 'Finalizing' }),
        submitting: t({ ko: '요청 전송', en: 'Submitting' }),
        generating: t({ ko: '생성', en: 'Generating' }),
      }
      const phase = (stage.phase && phaseLabels[stage.phase]) || stage.phase || null
      const node = stage.node_label || stage.node_id
        ? `${stage.node_label ?? ''}${stage.node_id ? ` (#${stage.node_id})` : ''}`.trim()
        : null
      return [phase, node].filter(Boolean).join(' · ') || null
    } catch {
      return null
    }
  }

  const providerLabel = (record: GenerationHistoryRecord) => (
    record.service_type === 'novelai' ? 'NAI' : record.service_type === 'codex' ? 'Codex' : 'ComfyUI'
  )

  const openImage = (image: ImageRecord) => {
    if (!image.composite_hash || !imageViewModal) return
    imageViewModal.openImageView({
      compositeHash: image.composite_hash,
      compositeHashes: resultImages.map((item) => item.composite_hash as string),
      sourceId: 'generation-log',
      sourceItems: resultImages,
      accessOptions: {
        allowDetailNavigation: false,
        allowEditAction: !isPublicView,
        allowGroupAssignAction: !isPublicView,
        allowHistoryReuseActions: !isPublicView,
      },
    })
  }

  const copyError = async (text: string) => {
    try {
      await copyTextToClipboard(text)
      showSnackbar({ message: t({ ko: '오류를 복사했어.', en: 'Copied the error.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' })
    }
  }

  if (!feed.canViewResults) return <ImagePermissionNotice />

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-3 ring-room-clip' : 'space-y-3')}>
      <GenerationHistoryHeader
        onBack={onBack}
        leading={headerLeading}
        trailing={(
          <SegmentedControl
            value={filter}
            items={[
              { value: 'all', label: t({ ko: '전체', en: 'All' }) },
              { value: 'failed', label: t({ ko: '실패', en: 'Failed' }) },
            ]}
            onChange={(next) => setFilter(next === 'failed' ? 'failed' : 'all')}
            size="xs"
            ariaLabel={t({ ko: '로그 필터', en: 'Log filter' })}
          />
        )}
        historyLabel=""
        isPublicView={isPublicView}
        isAdmin={isAdmin}
        historyTotalLabel=""
        hasHiddenHistoryItems={false}
        isRefreshing={historyQuery.isRefetching && !historyQuery.isFetchingNextPage}
        isFetching={historyQuery.isFetching}
        inFlightHistoryCount={inFlight}
        historyRecordCount={historyRecords.length}
        cleanupFailedHistoryCount={cleanupFailed}
        isClearingHistory={isClearingHistory}
        isCleaningFailed={isCleaningFailed}
        handleClearHistory={handleClearHistory}
        handleCleanupFailed={handleCleanupFailed}
        refreshHistory={refreshHistory}
      />

      {historyQuery.isError ? (
        <ErrorState
          title={t('image-generation.components.generation.history.panel.could.not.load.history')}
          description={getErrorMessage(historyQuery.error, t('image-generation.components.generation.history.panel.failed.to.fetch.generation.history'))}
        />
      ) : null}

      {isHistoryLoading ? <LoadingState variant="inline" label={t('image-generation.components.generation.history.panel.loading.history')} /> : null}

      {!isHistoryLoading && visibleRows.length === 0 && !historyQuery.isError ? (
        <EmptyState title={filter === 'failed' ? t({ ko: '실패한 생성이 없어', en: 'No failed runs' }) : t({ ko: '생성 기록이 없어', en: 'No runs yet' })} />
      ) : null}

      <div className={cn(splitPaneScroll && 'ring-room-scroll min-h-0 flex-1 overflow-y-auto pr-3 pb-1')}>
        {visibleRows.map(({ record, status, image, created, dayHeading }) => {
          const isProblem = status === 'failed' || status === 'cancelled'
          const isOpen = isProblem && openId === record.id
          const error = record.error_message?.trim() || null
          const title = record.workflow_name?.trim() || record.nai_model || null
          const width = image.width
          const height = image.height
          const time = created ? formatDateTime(created, { timeStyle: 'medium' }) : null
          const duration = status === 'completed' ? secondsBetween(record.created_at, record.completed_at) : null
          const waitSeconds = secondsBetween(record.queue_queued_at, record.queue_started_at)
          const runSeconds = secondsBetween(record.queue_started_at, record.queue_completed_at)
          const stage = formatStage(record.queue_failure_stage)
          const server = record.assigned_server_name || record.requested_server_name || null
          const queueJobId = getRetryableHistoryQueueJobId(record)
          const isRetrying = queueJobId !== null && retryingQueueJobIds.has(queueJobId)
          const subLine = isProblem
            ? (status === 'cancelled' ? t({ ko: '취소됨', en: 'Cancelled' }) : error?.split('\n')[0]) ?? null
            : [time, duration !== null ? formatSeconds(duration) : status === 'running' ? t({ ko: '생성 중', en: 'Generating' }) : null].filter(Boolean).join(' · ')
          const statusLabel = status === 'running'
            ? t({ ko: '진행 중', en: 'Running' })
            : status === 'completed'
              ? t({ ko: '완료', en: 'Done' })
              : status === 'cancelled'
                ? t({ ko: '취소', en: 'Cancelled' })
                : t({ ko: '실패', en: 'Failed' })
          const load = reuse.getMenuActions(record.id).load

          const lead = image.thumbnail_url ? (
            <span className="size-11 overflow-hidden rounded-sm bg-surface-container">
              <img src={image.thumbnail_url} alt="" loading="lazy" className={cn('size-full object-cover', shouldBlur?.(image) && 'blur-md saturate-50')} />
            </span>
          ) : (
            <span className={cn(
              'flex size-11 items-center justify-center rounded-sm bg-surface-container',
              status === 'failed' ? 'text-destructive' : status === 'running' ? 'text-primary' : 'text-muted-foreground',
            )}
            >
              {status === 'running' ? <Loader2 className="size-4 animate-spin" /> : status === 'cancelled' ? <Ban className="size-4" /> : <CircleX className="size-4" />}
            </span>
          )
          const main = (
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-semibold">{[providerLabel(record), title].filter(Boolean).join(' · ')}</span>
                {width && height ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatNumber(width)}×{formatNumber(height)}</span> : null}
              </span>
              {subLine ? (
                <span className={cn('mt-0.5 block truncate text-xs', status === 'failed' && !isOpen ? 'text-destructive' : 'text-muted-foreground')}>
                  {isProblem && time ? `${time} · ${subLine}` : subLine}
                </span>
              ) : null}
            </span>
          )
          const trailing = (
            <span className={cn('flex items-center gap-1 text-xs', status === 'failed' ? 'text-destructive' : status === 'running' ? 'text-primary' : 'text-muted-foreground')}>
              {statusLabel}
              {isProblem ? <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} /> : null}
            </span>
          )

          return (
            <Fragment key={record.id}>
              {dayHeading ? <div className="pt-3 pb-1 text-xs text-muted-foreground first:pt-0">{dayHeading}</div> : null}
              {isProblem ? (
                <ListRow asChild interactive size="lg" leading={lead} trailing={trailing} selected={isOpen}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : record.id)}>{main}</button>
                </ListRow>
              ) : image.composite_hash ? (
                <ListRow asChild interactive size="lg" leading={lead} trailing={trailing}>
                  <button type="button" onClick={() => openImage(image)}>{main}</button>
                </ListRow>
              ) : (
                <ListRow size="lg" leading={lead} trailing={trailing} selected={false}>{main}</ListRow>
              )}
              {isOpen ? (
                <div className="space-y-2 border-b border-line pt-2 pr-2 pb-3 pl-16">
                  {error ? (
                    <p className="border-l-2 border-destructive py-0.5 pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground">{error}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {stage ? <span>{t({ ko: '단계', en: 'Stage' })} <span className="text-foreground">{stage}</span></span> : null}
                    {server ? <span>{t({ ko: '서버', en: 'Server' })} <span className="text-foreground">{server}</span></span> : null}
                    {record.queue_job_id ? <span>{t({ ko: '큐', en: 'Queue' })} <span className="text-foreground tabular-nums">#{record.queue_job_id}</span></span> : null}
                    {record.queue_attempt_number ? <span>{t({ ko: '시도', en: 'Attempt' })} <span className="text-foreground tabular-nums">{formatNumber(record.queue_attempt_number)}</span></span> : null}
                    {waitSeconds !== null ? <span>{t({ ko: '대기', en: 'Waited' })} <span className="text-foreground tabular-nums">{formatSeconds(waitSeconds)}</span></span> : null}
                    {runSeconds !== null ? <span>{t({ ko: '실행', en: 'Ran' })} <span className="text-foreground tabular-nums">{formatSeconds(runSeconds)}</span></span> : null}
                  </div>
                  <div className="-ml-2 flex items-center gap-0.5">
                    {canRetryHistoryQueueJob(record) ? (
                      <IconButton
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => void handleRetryHistoryRecord(record)}
                        disabled={isRetryingRunRecovery}
                        label={t({ ko: '같은 입력으로 다시 실행', en: 'Rerun with the same inputs' })}
                      >
                        <RotateCcw className={cn(isRetrying && 'animate-spin')} />
                      </IconButton>
                    ) : null}
                    {isPublicView ? null : (
                      <IconButton size="icon-sm" variant="ghost" onClick={load.onSelect} disabled={load.disabled} label={load.label}>
                        <SlidersHorizontal />
                      </IconButton>
                    )}
                    {error ? (
                      <IconButton size="icon-sm" variant="ghost" onClick={() => void copyError(error)} label={t({ ko: '오류 복사', en: 'Copy error' })}>
                        <ClipboardCopy />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Fragment>
          )
        })}

        {historyQuery.hasNextPage ? (
          <div className="flex justify-center py-3">
            <Button size="sm" variant="ghost" onClick={() => void historyQuery.fetchNextPage()} disabled={historyQuery.isFetchingNextPage}>
              {historyQuery.isFetchingNextPage ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '더 보기', en: 'Load more' })}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

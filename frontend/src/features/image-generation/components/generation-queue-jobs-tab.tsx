import { memo, useEffect, useState } from 'react'
import { Square, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { GenerationQueueJobRecord, GenerationWorkflow } from '@/lib/api-image-generation-types'
import { getErrorMessage } from '../image-generation-shared'
import {
  canRetryGenerationQueueCancellation,
  getGenerationQueueDurationLabel,
  getGenerationQueueElapsedLabel,
  getGenerationQueueLaneLabel,
  getGenerationQueueProgressPercent,
  getGenerationQueueProgressStageLabel,
  getGenerationQueueRemainingLabel,
  getGenerationQueueRequesterLabel,
  getGenerationQueueStartLabel,
  getGenerationQueueStatusLabel,
  getGenerationQueueWaitLabel,
  getGenerationQueueWorkflowLabel,
  hasGenerationQueueLiveProgress,
} from './generation-queue-ui'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'

const QUEUE_ROW_CLOCK_INTERVAL_MS = 1_000

export type QueueFilterValue = 'all' | 'novelai' | 'codex' | 'comfyui' | `workflow:${number}`

type QueueJobRowProps = {
  record: GenerationQueueJobRecord
  isBusy: boolean
  isAdmin: boolean
  onCancel: (record: GenerationQueueJobRecord) => void
  t: ReturnType<typeof useI18n>['t']
  formatNumber: ReturnType<typeof useI18n>['formatNumber']
  locale: string
}

/** Tick a local clock for time-derived labels; only the row that needs it re-renders, so the memoized list stays cheap. */
function useQueueRowNow(enabled: boolean) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) {
      return
    }

    const timer = window.setInterval(() => setNowMs(Date.now()), QUEUE_ROW_CLOCK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [enabled])

  return nowMs
}

/**
 * 진행률 이벤트가 레코드 하나만 patch 해도 나머지 행이 리렌더되지 않도록 행 단위로 memo 한다.
 * react-query 구조 공유와 브리지의 단일 레코드 교체가 무변경 레코드의 identity 를 보존하므로
 * 얕은 비교로 충분하다.
 */
const QueueJobRow = memo(function QueueJobRow({ record, isBusy, isAdmin, onCancel, t, formatNumber, locale }: QueueJobRowProps) {
  const isCancelRequested = record.cancel_requested > 0
  const workflowLabel = getGenerationQueueWorkflowLabel(record, t)
  const creatorLabel = getGenerationQueueRequesterLabel(record, t)
  const isRunning = record.status === 'running'
  const nowMs = useQueueRowNow(isRunning)
  const isLiveProgress = hasGenerationQueueLiveProgress(record)
  const progressPercent = getGenerationQueueProgressPercent(record, nowMs)
  const progressStageLabel = getGenerationQueueProgressStageLabel(record, t, formatNumber)
  // CR-3: 업스트림 취소가 실패했을 때 사용자가 재시도할 수 있어야 한다.
  const canRetryCancel = canRetryGenerationQueueCancellation(record)
  const hasRecordPermission = isAdmin || record.is_mine === true
  const canManageRecord = (!isCancelRequested || canRetryCancel) && hasRecordPermission
  const statusLabel = isCancelRequested ? t('image-generation.components.generation.queue.header.widget.cancel.requested') : getGenerationQueueStatusLabel(record, t)
  // 대기 작업은 위치/예상 대기/예상 시작을, 실행 작업은 단계/경과/남은 시간을 보여 준다. 추정치가 없으면 해당 조각은 빠진다.
  const detailLabel = isRunning
    ? [
        progressStageLabel,
        getGenerationQueueElapsedLabel(record, t, formatNumber, nowMs),
        getGenerationQueueRemainingLabel(record, t, formatNumber, nowMs),
      ].filter(Boolean).join(' · ')
    : [
        getGenerationQueueLaneLabel(record, t, formatNumber) ?? statusLabel,
        getGenerationQueueWaitLabel(record, t, formatNumber),
        getGenerationQueueStartLabel(record, t, locale),
      ].filter(Boolean).join(' · ')
  const durationLabel = getGenerationQueueDurationLabel(record, t, formatNumber)
  const detailTitle = [detailLabel, durationLabel].filter(Boolean).join(' · ')

  return (
    <div className="ui-tone-plinth rounded-sm px-3 py-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-2xs">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={isCancelRequested ? 'warning' : isRunning ? 'info' : 'secondary'}>
              {statusLabel}
            </Badge>
            <span className="truncate font-medium text-foreground" title={workflowLabel}>{workflowLabel}</span>
          </div>
          {isRunning ? (
            <div className="shrink-0 text-2xs font-medium text-foreground">
              {progressPercent != null
                ? (isLiveProgress
                  ? t({ ko: '{percent}%', en: '{percent}%' }, { percent: formatNumber(progressPercent) })
                  : t({ ko: '예상 {percent}%', en: 'Est. {percent}%' }, { percent: formatNumber(progressPercent) }))
                : t({ ko: '진행 중', en: 'In progress' })}
            </div>
          ) : null}
        </div>

        {isRunning ? (
          <Progress
            size="lg"
            value={progressPercent}
            aria-label={t({ ko: '{label} 진행률', en: '{label} progress' }, { label: workflowLabel })}
          />
        ) : null}

        <div className="flex items-center justify-between gap-3 text-2xs text-muted-foreground">
          <span className="min-w-0 truncate" title={detailTitle || undefined}>
            {detailLabel}
          </span>
          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            <span className="max-w-28 truncate">{record.is_mine ? t('image-generation.components.generation.queue.header.widget.value.me', { creatorLabel }) : creatorLabel}</span>
            {canManageRecord ? (
              <IconButton
                size="icon-xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => onCancel(record)}
                disabled={isBusy}
                tooltipSide="left"
                label={canRetryCancel
                  ? t({ ko: '큐 작업 {id} 취소 재시도', en: 'Retry cancelling queue job {id}' }, { id: record.id })
                  : isRunning
                    ? t('image-generation.components.generation.queue.header.widget.queue.job.value.request.stop', { id: record.id })
                    : t('image-generation.components.generation.queue.header.widget.queue.job.value.delete', { id: record.id })}
              >
                {isRunning ? <Square className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              </IconButton>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
})

type GenerationQueueJobsTabProps = {
  selectedFilter: QueueFilterValue
  onFilterChange: (value: QueueFilterValue) => void
  workflows: GenerationWorkflow[]
  showWorkflowListError: boolean
  filteredActiveCount: number
  records: readonly GenerationQueueJobRecord[]
  isPending: boolean
  isError: boolean
  error: unknown
  pendingJobId: number | null
  isAdmin: boolean
  onCancel: (record: GenerationQueueJobRecord) => void
  /** Scroll-area classes shared with the reservations tab so both tabs size the popup the same way. */
  listClassName: string
}

/** Render the header queue popup's jobs tab: scope filter and live job rows. The widget owns the queries. */
export function GenerationQueueJobsTab({
  selectedFilter,
  onFilterChange,
  workflows,
  showWorkflowListError,
  filteredActiveCount,
  records,
  isPending,
  isError,
  error,
  pendingJobId,
  isAdmin,
  onCancel,
  listClassName,
}: GenerationQueueJobsTabProps) {
  const { t, locale, formatNumber } = useI18n()

  return (
    <>
      <div className="space-y-2 px-3 pb-1 sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <Text as="div" variant="overline" className="font-semibold">{t({ ko: '범위', en: 'Scope' })}</Text>
          <Badge variant={filteredActiveCount > 0 ? 'secondary' : 'outline'} className="w-fit max-w-full">{t({ ko: '작업 큐 · {count}', en: 'Job Queue · {count}' }, { count: formatNumber(filteredActiveCount) })}</Badge>
        </div>
        <Select value={selectedFilter} onChange={(event) => onFilterChange(event.target.value as QueueFilterValue)} className="h-9 w-full min-w-0">
          <option value="all">{t('image-generation.components.generation.queue.header.widget.all.queues')}</option>
          <option value="novelai">NAI</option>
          <option value="codex">Codex</option>
          <option value="comfyui">{t('image-generation.components.generation.queue.header.widget.all.comfyui')}</option>
          {workflows.map((workflow) => (
            <option key={workflow.id} value={`workflow:${workflow.id}`}>{workflow.name}</option>
          ))}
        </Select>
        {showWorkflowListError ? <div className="text-2xs text-warning">{t('image-generation.components.generation.queue.header.widget.could.not.load.the.workflow.list.so')}</div> : null}
      </div>

      <div className={listClassName}>
        {isError ? (
          <ErrorState size="compact" title={getErrorMessage(error, t('image-generation.components.generation.queue.header.widget.could.not.load.the.queue'))} />
        ) : null}

        {!isError && isPending ? <LoadingState variant="inline" label={t('image-generation.components.generation.queue.header.widget.loading.queue')} /> : null}

        {!isPending && !isError && records.length === 0 ? (
          <EmptyState size="compact" title={t({ ko: '지금 진행 중인 큐 작업이 없어.', en: 'No queue jobs are currently running.' })} />
        ) : null}

        {records.length > 0 ? (
          <div className="space-y-2">
            {records.map((record) => (
              <QueueJobRow
                key={record.id}
                record={record}
                isBusy={pendingJobId === record.id}
                isAdmin={isAdmin}
                onCancel={onCancel}
                t={t}
                formatNumber={formatNumber}
                locale={locale}
              />
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}

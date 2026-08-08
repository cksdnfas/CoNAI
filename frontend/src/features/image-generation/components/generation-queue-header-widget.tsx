import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTodo, RefreshCw, Square, Trash2 } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import { getGenerationWorkflows } from '@/lib/api-image-generation-workflows'
import { cancelGenerationQueueJob, getGenerationQueue } from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import { getGraphWorkflowNames, getGraphWorkflowSchedules } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'
import { getGraphWorkflowScheduleStatusLabel, getGraphWorkflowStopReasonLabel } from '@/features/module-graph/module-graph-shared'
import { runGenerationQueueMutation } from './generation-queue-actions'
import {
  canRetryGenerationQueueCancellation,
  getGenerationQueueHeaderQuerySnapshot,
  getGenerationQueueHeaderRefreshTargets,
  getGenerationQueueProgressPercent,
  getGenerationQueueProgressStageLabel,
  getGenerationQueueRequesterLabel,
  getGenerationQueueStatusLabel,
  getGenerationQueueWorkflowLabel,
  hasGenerationQueueLiveProgress,
  shouldEnableFilteredQueueHeaderQuery,
} from './generation-queue-ui'
import {
  formatReservationTimestamp,
  getActiveWorkflowReservationScheduleCount,
  getReservationRunSummaryLabel,
  getReservationStatusVariant,
  getReservationTimingLabel,
  getReservationTypeLabel,
  sortWorkflowReservationSchedules,
} from './workflow-reservations-ui'

const ACTIVE_QUEUE_STATUSES: Array<GenerationQueueJobRecord['status']> = ['queued', 'dispatching', 'running']
const ACTIVE_QUEUE_REFETCH_INTERVAL_MS = 3_000
const IDLE_QUEUE_REFETCH_INTERVAL_MS = 30_000
const LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY = 'conai:image-generation-queue:last-seen-job-id'

type QueueFilterValue = 'all' | 'novelai' | 'codex' | 'comfyui' | `workflow:${number}`
type HeaderPopupTab = 'jobs' | 'reservations'

function readLastSeenQueueJobId() {
  if (typeof window === 'undefined') {
    return null
  }

  let rawValue: string | null
  try {
    rawValue = window.sessionStorage.getItem(LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY)
  } catch {
    return null
  }

  if (rawValue === null) {
    return null
  }

  const parsedValue = Number(rawValue)
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : null
}

function persistLastSeenQueueJobId(value: number) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY, String(Math.max(0, Math.trunc(value))))
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function getGenerationQueueHeaderRefetchInterval(activeCount: number, isOpen: boolean) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false
  }

  return activeCount > 0 || isOpen ? ACTIVE_QUEUE_REFETCH_INTERVAL_MS : IDLE_QUEUE_REFETCH_INTERVAL_MS
}

function parseQueueFilter(value: QueueFilterValue) {
  if (value === 'all') {
    return { serviceType: undefined, workflowId: undefined }
  }

  if (value === 'novelai') {
    return { serviceType: 'novelai' as const, workflowId: undefined }
  }

  if (value === 'codex') {
    return { serviceType: 'codex' as const, workflowId: undefined }
  }

  if (value === 'comfyui') {
    return { serviceType: 'comfyui' as const, workflowId: undefined }
  }

  if (value.startsWith('workflow:')) {
    const workflowId = Number(value.slice('workflow:'.length))
    if (Number.isInteger(workflowId) && workflowId > 0) {
      return { serviceType: 'comfyui' as const, workflowId }
    }
  }

  return { serviceType: undefined, workflowId: undefined }
}

type QueueJobRowProps = {
  record: GenerationQueueJobRecord
  isBusy: boolean
  isAdmin: boolean
  onCancel: (jobId: number) => void
  t: ReturnType<typeof useI18n>['t']
  formatNumber: ReturnType<typeof useI18n>['formatNumber']
}

/**
 * 진행률 이벤트가 레코드 하나만 patch 해도 나머지 행이 리렌더되지 않도록 행 단위로 memo 한다.
 * react-query 구조 공유와 브리지의 단일 레코드 교체가 무변경 레코드의 identity 를 보존하므로
 * 얕은 비교로 충분하다.
 */
const QueueJobRow = memo(function QueueJobRow({ record, isBusy, isAdmin, onCancel, t, formatNumber }: QueueJobRowProps) {
  const isCancelRequested = record.cancel_requested > 0
  const workflowLabel = getGenerationQueueWorkflowLabel(record, t)
  const creatorLabel = getGenerationQueueRequesterLabel(record, t)
  const isRunning = record.status === 'running'
  const isLiveProgress = hasGenerationQueueLiveProgress(record)
  const progressPercent = getGenerationQueueProgressPercent(record)
  const progressStageLabel = getGenerationQueueProgressStageLabel(record, t, formatNumber)
  // CR-3: 업스트림 취소가 실패했을 때 사용자가 재시도할 수 있어야 한다.
  const canRetryCancel = canRetryGenerationQueueCancellation(record)
  const hasRecordPermission = isAdmin || record.is_mine === true
  const canManageRecord = (!isCancelRequested || canRetryCancel) && hasRecordPermission
  const statusLabel = isCancelRequested ? t('image-generation.components.generation.queue.header.widget.cancel.requested') : getGenerationQueueStatusLabel(record, t)
  const queueLabel = record.queue_position != null && record.queue_position > 0
    ? t({ ko: '대기열 {position}', en: 'Queue {position}' }, { position: formatNumber(record.queue_position) })
    : statusLabel

  return (
    <div className="rounded-sm border border-border bg-surface-low px-3 py-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={isCancelRequested ? 'outline' : 'secondary'} className={cn(isCancelRequested ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : '')}>{statusLabel}</Badge>
            <span className="truncate font-medium text-foreground" title={workflowLabel}>{workflowLabel}</span>
          </div>
          {isRunning ? (
            <div className="shrink-0 text-[11px] font-medium text-foreground">
              {progressPercent != null
                ? (isLiveProgress
                  ? t({ ko: '{percent}%', en: '{percent}%' }, { percent: formatNumber(progressPercent) })
                  : t({ ko: '예상 {percent}%', en: 'Est. {percent}%' }, { percent: formatNumber(progressPercent) }))
                : t({ ko: '진행 중', en: 'In progress' })}
            </div>
          ) : null}
        </div>

        {isRunning ? (
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-background/60">
            {progressPercent != null ? (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
          <span className="min-w-0 truncate" title={isRunning ? progressStageLabel ?? undefined : queueLabel}>
            {isRunning ? progressStageLabel : queueLabel}
          </span>
          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            <span className="max-w-28 truncate">{record.is_mine ? t('image-generation.components.generation.queue.header.widget.value.me', { creatorLabel }) : creatorLabel}</span>
            {canManageRecord ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => onCancel(record.id)}
                disabled={isBusy}
                aria-label={canRetryCancel
                  ? t({ ko: '큐 작업 {id} 취소 재시도', en: 'Retry cancelling queue job {id}' }, { id: record.id })
                  : isRunning
                    ? t('image-generation.components.generation.queue.header.widget.queue.job.value.request.stop', { id: record.id })
                    : t('image-generation.components.generation.queue.header.widget.queue.job.value.delete', { id: record.id })}
                title={canRetryCancel
                  ? t({ ko: '취소 재시도', en: 'Retry cancel' })
                  : isRunning
                    ? t('image-generation.components.generation.queue.header.widget.request.stop')
                    : t('image-generation.components.generation.queue.header.widget.delete')}
              >
                {isRunning ? <Square className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
})

/** Render the global generation queue widget beside the header search action. */
export function GenerationQueueHeaderWidget() {
  const { showSnackbar } = useSnackbar()
  const { t, locale, formatNumber } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  // SSE 가 살아 있으면 폴링을 끄고, 끊기면 아래 기존 interval 로직이 그대로 되살아난다.
  const { status: runtimeStreamStatus } = useRuntimeEventStream()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<HeaderPopupTab>('jobs')
  const [pendingJobId, setPendingJobId] = useState<number | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<QueueFilterValue>('all')
  const initialLastSeenQueueJobId = useMemo(() => readLastSeenQueueJobId(), [])
  const [lastSeenQueueJobId, setLastSeenQueueJobId] = useState<number | null>(initialLastSeenQueueJobId)
  const [isNotificationBaselineReady, setIsNotificationBaselineReady] = useState(initialLastSeenQueueJobId !== null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useOverlayBackClose({ open: isOpen, onClose: () => setIsOpen(false) })

  const hasGenerationPermission = (authStatusQuery.data?.permissionKeys ?? []).includes('page.generation.view')

  const workflowsQuery = useQuery({
    queryKey: ['generation-workflows', 'header-widget'],
    queryFn: () => getGenerationWorkflows(true),
    staleTime: 60_000,
    enabled: hasGenerationPermission,
  })

  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data])
  const filterParams = useMemo(() => parseQueueFilter(selectedFilter), [selectedFilter])
  const isFilteredQueueView = selectedFilter !== 'all'
  const isFilteredQueueQueryEnabled = shouldEnableFilteredQueueHeaderQuery({
    hasGenerationPermission,
    isFilteredQueueView,
    isOpen,
  })

  const globalQueueQuery = useQuery({
    queryKey: ['image-generation-queue', 'header-widget', 'global-active'],
    queryFn: () => getGenerationQueue({ status: ACTIVE_QUEUE_STATUSES }),
    enabled: hasGenerationPermission,
    refetchInterval: (query) => {
      const activeCount = query.state.data?.records.length ?? 0
      return resolveStreamFallbackInterval(runtimeStreamStatus, getGenerationQueueHeaderRefetchInterval(activeCount, isOpen))
    },
  })

  const filteredQueueQuery = useQuery({
    queryKey: ['image-generation-queue', 'header-widget', 'filtered-active', filterParams.serviceType ?? 'all', filterParams.workflowId ?? null],
    queryFn: () => getGenerationQueue({
      status: ACTIVE_QUEUE_STATUSES,
      serviceType: filterParams.serviceType,
      workflowId: filterParams.workflowId,
    }),
    enabled: isFilteredQueueQueryEnabled,
    refetchInterval: (query) => {
      const activeCount = query.state.data?.records.length ?? 0
      return resolveStreamFallbackInterval(runtimeStreamStatus, getGenerationQueueHeaderRefetchInterval(activeCount, isOpen))
    },
  })

  // WF-1: 헤더 위젯은 예약 라벨만 필요하므로 이름 전용 소스를 쓴다(그래프 문서를 받지 않는다).
  const reservationWorkflowQuery = useQuery({
    queryKey: ['graph-workflows', 'header-widget', 'names'],
    queryFn: () => getGraphWorkflowNames(true),
    enabled: isOpen && hasGenerationPermission,
    staleTime: 60_000,
  })

  const reservationSchedulesQuery = useQuery({
    queryKey: ['graph-workflow-schedules', 'header-widget'],
    queryFn: () => getGraphWorkflowSchedules(),
    enabled: isOpen && hasGenerationPermission,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const activeCount = query.state.data?.filter((schedule) => schedule.status === 'active').length ?? 0
      return resolveStreamFallbackInterval(runtimeStreamStatus, activeCount > 0 || isOpen ? 4000 : false)
    },
  })

  const globalRecords = useMemo(() => globalQueueQuery.data?.records ?? [], [globalQueueQuery.data?.records])
  const activeQueueQuery = getGenerationQueueHeaderQuerySnapshot({
    isFilteredQueueView,
    globalQueue: {
      records: globalQueueQuery.data?.records,
      isPending: globalQueueQuery.isPending,
      isError: globalQueueQuery.isError,
      error: globalQueueQuery.error,
    },
    filteredQueue: {
      records: filteredQueueQuery.data?.records,
      isPending: filteredQueueQuery.isPending,
      isError: filteredQueueQuery.isError,
      error: filteredQueueQuery.error,
    },
  })
  const records = useMemo(() => activeQueueQuery.records ?? [], [activeQueueQuery.records])
  const globalActiveCount = globalRecords.length
  const filteredActiveCount = records.length
  const latestQueueJobId = useMemo(() => globalRecords.reduce((maxId, record) => Math.max(maxId, record.id), 0), [globalRecords])
  const reservationWorkflowNameById = useMemo(
    () => new Map((reservationWorkflowQuery.data ?? []).map((workflow) => [workflow.id, workflow.name] as const)),
    [reservationWorkflowQuery.data],
  )

  const reservationSchedules = useMemo(() => sortWorkflowReservationSchedules(reservationSchedulesQuery.data ?? []), [reservationSchedulesQuery.data])
  const activeReservationCount = useMemo(
    () => getActiveWorkflowReservationScheduleCount(reservationSchedules),
    [reservationSchedules],
  )

  useEffect(() => {
    if (globalQueueQuery.isPending || globalQueueQuery.isError || isNotificationBaselineReady) {
      return
    }

    persistLastSeenQueueJobId(latestQueueJobId)
    setLastSeenQueueJobId(latestQueueJobId)
    setIsNotificationBaselineReady(true)
  }, [globalQueueQuery.isError, globalQueueQuery.isPending, isNotificationBaselineReady, latestQueueJobId])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    persistLastSeenQueueJobId(latestQueueJobId)
    setLastSeenQueueJobId(latestQueueJobId)
  }, [isOpen, latestQueueJobId])

  const hasUnreadQueueUpdate = isNotificationBaselineReady && latestQueueJobId > (lastSeenQueueJobId ?? 0)

  const handleRefresh = async () => {
    const refreshTargets = getGenerationQueueHeaderRefreshTargets({
      activeTab,
      isFilteredQueueQueryEnabled,
    })

    await Promise.all([
      refreshTargets.includes('globalQueue') ? globalQueueQuery.refetch() : Promise.resolve(undefined),
      refreshTargets.includes('filteredQueue') ? filteredQueueQuery.refetch() : Promise.resolve(undefined),
      refreshTargets.includes('reservationSchedules') ? reservationSchedulesQuery.refetch() : Promise.resolve(undefined),
      refreshTargets.includes('reservationWorkflows') ? reservationWorkflowQuery.refetch() : Promise.resolve(undefined),
    ])
  }

  const handleCancel = async (jobId: number) => {
    if (pendingJobId !== null) {
      return
    }

    try {
      setPendingJobId(jobId)
      await runGenerationQueueMutation({
        execute: () => cancelGenerationQueueJob(jobId),
        refresh: handleRefresh,
        showSnackbar,
        successMessage: t('image-generation.components.generation.queue.header.widget.queue.jobs.cleaned.up'),
        failureMessage: t('image-generation.components.generation.queue.header.widget.failed.to.cancel.queue.jobs'),
      })
    } finally {
      setPendingJobId(null)
    }
  }

  // memo 된 행이 렌더마다 새 콜백 때문에 무효화되지 않도록 identity 를 고정한다.
  const handleCancelRef = useRef(handleCancel)
  handleCancelRef.current = handleCancel
  const cancelJob = useCallback((jobId: number) => {
    void handleCancelRef.current(jobId)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        data-state={isOpen ? 'open' : globalActiveCount > 0 ? 'active' : 'closed'}
        className="theme-shell-icon-button relative inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-foreground/80 transition-all duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        aria-label={t('image-generation.components.generation.queue.header.widget.open.job.queue.and.reservations')}
        aria-expanded={isOpen}
        title={t('image-generation.components.generation.queue.header.widget.job.queue.reservations')}
      >
        <ListTodo className="h-4 w-4" />
        {globalActiveCount > 0 ? (
          <span className="absolute -right-1 -bottom-1 inline-flex min-w-[1rem] items-center justify-center rounded-sm border border-primary/25 bg-primary/16 px-1 text-[10px] font-semibold leading-4 text-primary shadow-[0_0_0_2px_var(--background)]">
            {globalActiveCount}
          </span>
        ) : null}
        {hasUnreadQueueUpdate ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-rose-500 shadow-[0_0_0_2px_var(--background)]" aria-hidden="true" /> : null}
      </button>

      <div
        className={cn(
          'theme-floating-panel fixed left-2 right-2 top-[calc(var(--theme-shell-header-height)+0.5rem)] z-[70] overflow-hidden rounded-sm border border-border/80 bg-background/95 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur transition-opacity sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(33rem,calc(100vw-1rem))]',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {/* 닫힌 팝업까지 전역 잡 목록을 매 렌더 재조정하지 않도록, 프레임만 남기고 내용은 열렸을 때만 렌더한다. */}
        {isOpen ? (<>
        <div className="px-3 py-3 sm:px-4">
          <SegmentedTabBar
            value={activeTab}
            items={[
              { value: 'jobs', label: t('image-generation.components.generation.queue.header.widget.job.queue') },
              { value: 'reservations', label: t('image-generation.components.generation.queue.header.widget.reservations') },
            ]}
            onChange={(nextTab) => setActiveTab(nextTab as HeaderPopupTab)}
            size="sm"
            fullWidth
            className="border-b-0 pb-0"
            actions={(
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => void handleRefresh()} title={t('image-generation.components.generation.queue.header.widget.refresh.popup')} aria-label={t('image-generation.components.generation.queue.header.widget.refresh.popup')}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
          />
        </div>

        {activeTab === 'jobs' ? (
          <>
            <div className="space-y-3 border-y border-border/70 px-3 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t({ ko: '범위', en: 'Scope' })}</div>
                <Badge variant={filteredActiveCount > 0 ? 'secondary' : 'outline'} className="w-fit max-w-full">{t({ ko: '작업 큐 · {count}', en: 'Job Queue · {count}' }, { count: formatNumber(filteredActiveCount) })}</Badge>
              </div>
              <Select value={selectedFilter} onChange={(event) => setSelectedFilter(event.target.value as QueueFilterValue)} className="h-9 w-full min-w-0">
                <option value="all">{t('image-generation.components.generation.queue.header.widget.all.queues')}</option>
                <option value="novelai">NAI</option>
                <option value="codex">Codex</option>
                <option value="comfyui">{t('image-generation.components.generation.queue.header.widget.all.comfyui')}</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={`workflow:${workflow.id}`}>{workflow.name}</option>
                ))}
              </Select>
              {hasGenerationPermission && workflowsQuery.isError ? <div className="text-[11px] text-amber-700 dark:text-amber-300">{t('image-generation.components.generation.queue.header.widget.could.not.load.the.workflow.list.so')}</div> : null}
            </div>

            <div className="max-h-[min(24rem,calc(100vh-var(--theme-shell-header-height)-5rem))] space-y-3 overflow-y-auto px-3 py-3 sm:max-h-[min(28rem,calc(100vh-var(--theme-shell-header-height)-2rem))] sm:px-4">
              {activeQueueQuery.isError ? (
                <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
                  {getErrorMessage(activeQueueQuery.error, t('image-generation.components.generation.queue.header.widget.could.not.load.the.queue'))}
                </div>
              ) : null}

              {!activeQueueQuery.isError && activeQueueQuery.isPending ? <div className="text-sm text-muted-foreground">{t('image-generation.components.generation.queue.header.widget.loading.queue')}</div> : null}

              {!activeQueueQuery.isPending && !activeQueueQuery.isError && records.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">
                  {t({ ko: '지금 진행 중인 큐 작업이 없어.', en: 'No queue jobs are currently running.' })}
                </div>
              ) : null}

              {records.length > 0 ? (
                <div className="space-y-2">
                  {records.map((record) => (
                    <QueueJobRow
                      key={record.id}
                      record={record}
                      isBusy={pendingJobId === record.id}
                      isAdmin={authStatusQuery.data?.isAdmin === true}
                      onCancel={cancelJob}
                      t={t}
                      formatNumber={formatNumber}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3 border-y border-border/70 px-3 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('image-generation.components.generation.queue.header.widget.summary')}</div>
                <Badge variant={reservationSchedules.length > 0 ? 'secondary' : 'outline'} className="w-fit max-w-full">{t({ ko: '예약작업 · {count}', en: 'Reservations · {count}' }, { count: formatNumber(reservationSchedules.length) })}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={activeReservationCount > 0 ? 'secondary' : 'outline'}>{t({ ko: '활성 {count}', en: 'Active {count}' }, { count: formatNumber(activeReservationCount) })}</Badge>
                <Badge variant="outline">{t({ ko: '전체 {count}', en: 'Total {count}' }, { count: formatNumber(reservationSchedules.length) })}</Badge>
              </div>
            </div>

            <div className="max-h-[min(24rem,calc(100vh-var(--theme-shell-header-height)-5rem))] space-y-3 overflow-y-auto px-3 py-3 sm:max-h-[min(28rem,calc(100vh-var(--theme-shell-header-height)-2rem))] sm:px-4">
              {reservationSchedulesQuery.isError ? (
                <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
                  {getErrorMessage(reservationSchedulesQuery.error, t('image-generation.components.generation.queue.header.widget.could.not.load.reservations'))}
                </div>
              ) : null}

              {!reservationSchedulesQuery.isError && reservationSchedulesQuery.isPending ? <div className="text-sm text-muted-foreground">{t('image-generation.components.generation.queue.header.widget.loading.reservations')}</div> : null}

              {!reservationSchedulesQuery.isPending && !reservationSchedulesQuery.isError && reservationSchedules.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">
                  {t({ ko: '등록된 예약작업이 아직 없어.', en: 'No reservations have been registered yet.' })}
                </div>
              ) : null}

              {reservationSchedules.length > 0 ? (
                <div className="space-y-2">
                  {reservationSchedules.map((schedule) => {
                    const nextRunAt = formatReservationTimestamp(schedule.next_run_at, locale)
                    const lastEnqueuedAt = formatReservationTimestamp(schedule.last_enqueued_at, locale)
                    const runSummaryLabel = getReservationRunSummaryLabel(schedule)
                    return (
                      <div key={schedule.id} className="rounded-sm border border-border bg-surface-low px-3 py-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-medium text-foreground">{schedule.name}</div>
                            <Badge variant={getReservationStatusVariant(schedule.status)}>{getGraphWorkflowScheduleStatusLabel(schedule.status)}</Badge>
                            <Badge variant="outline">{getReservationTypeLabel(schedule.schedule_type, t)}</Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {reservationWorkflowNameById.get(schedule.graph_workflow_id) ?? t('image-generation.components.generation.queue.header.widget.workflow.value', { id: schedule.graph_workflow_id })} · {getReservationTimingLabel(schedule, t, locale)}
                          </div>
                          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                            <span>{runSummaryLabel}</span>
                            {nextRunAt ? <span>{t('image-generation.components.generation.queue.header.widget.next.enqueue.attempt.value', { nextRunAt })}</span> : null}
                            {lastEnqueuedAt ? <span>{t('image-generation.components.generation.queue.header.widget.last.queued.value', { lastEnqueuedAt })}</span> : null}
                          </div>
                          {getGraphWorkflowStopReasonLabel(schedule.stop_reason_code, schedule.stop_reason_message) ? (
                            <div className="rounded-sm border border-border/70 bg-background/45 px-2.5 py-2 text-[11px] text-muted-foreground">
                              {getGraphWorkflowStopReasonLabel(schedule.stop_reason_code, schedule.stop_reason_message)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </>
        )}
        </>) : null}
      </div>
    </div>
  )
}

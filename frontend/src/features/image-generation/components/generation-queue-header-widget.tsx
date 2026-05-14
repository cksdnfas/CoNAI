import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTodo, RefreshCw, Square, Trash2 } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { getGenerationWorkflows } from '@/lib/api-image-generation-workflows'
import { cancelGenerationQueueJob, getGenerationQueue } from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import { getGraphWorkflowSchedules, getGraphWorkflows } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'
import { getGraphWorkflowScheduleStatusLabel, getGraphWorkflowStopReasonLabel } from '@/features/module-graph/module-graph-shared'
import { runGenerationQueueMutation } from './generation-queue-actions'
import {
  getGenerationQueueProgressPercent,
  getGenerationQueueRemainingLabel,
  getGenerationQueueRequesterLabel,
  getGenerationQueueStatusLabel,
  getGenerationQueueWorkflowLabel,
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
const IDLE_QUEUE_REFETCH_INTERVAL_MS = 8_000
const LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY = 'conai:image-generation-queue:last-seen-job-id'

type QueueFilterValue = 'all' | 'novelai' | 'codex' | 'comfyui' | `workflow:${number}`
type HeaderPopupTab = 'jobs' | 'reservations'

function readLastSeenQueueJobId() {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY)
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

  window.sessionStorage.setItem(LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY, String(Math.max(0, Math.trunc(value))))
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

function getQueueProgressToneClass(record: GenerationQueueJobRecord) {
  if (record.status === 'running') {
    return 'bg-primary'
  }

  return 'bg-secondary'
}

function formatQueueCompactStartTime(value: string | null | undefined, locale: string) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}


/** Render the global generation queue widget beside the header search action. */
export function GenerationQueueHeaderWidget() {
  const { showSnackbar } = useSnackbar()
  const { t, locale, formatNumber } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<HeaderPopupTab>('jobs')
  const [pendingJobId, setPendingJobId] = useState<number | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<QueueFilterValue>('all')
  const [lastSeenQueueJobId, setLastSeenQueueJobId] = useState<number | null>(() => readLastSeenQueueJobId())
  const [isNotificationBaselineReady, setIsNotificationBaselineReady] = useState(() => readLastSeenQueueJobId() !== null)
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

  const globalQueueQuery = useQuery({
    queryKey: ['image-generation-queue', 'header-widget', 'global-active'],
    queryFn: () => getGenerationQueue({ status: ACTIVE_QUEUE_STATUSES }),
    enabled: hasGenerationPermission,
    refetchInterval: (query) => {
      const activeCount = query.state.data?.records.length ?? 0
      return activeCount > 0 || isOpen ? ACTIVE_QUEUE_REFETCH_INTERVAL_MS : IDLE_QUEUE_REFETCH_INTERVAL_MS
    },
  })

  const filteredQueueQuery = useQuery({
    queryKey: ['image-generation-queue', 'header-widget', 'filtered-active', filterParams.serviceType ?? 'all', filterParams.workflowId ?? null],
    queryFn: () => getGenerationQueue({
      status: ACTIVE_QUEUE_STATUSES,
      serviceType: filterParams.serviceType,
      workflowId: filterParams.workflowId,
    }),
    enabled: hasGenerationPermission && isFilteredQueueView,
    refetchInterval: (query) => {
      const activeCount = query.state.data?.records.length ?? 0
      return activeCount > 0 || isOpen ? ACTIVE_QUEUE_REFETCH_INTERVAL_MS : IDLE_QUEUE_REFETCH_INTERVAL_MS
    },
  })

  const reservationWorkflowQuery = useQuery({
    queryKey: ['graph-workflows', 'header-widget'],
    queryFn: () => getGraphWorkflows(true),
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
      return activeCount > 0 || isOpen ? 4000 : false
    },
  })

  const globalRecords = useMemo(() => globalQueueQuery.data?.records ?? [], [globalQueueQuery.data?.records])
  const records = useMemo(() => (isFilteredQueueView ? filteredQueueQuery.data?.records : globalQueueQuery.data?.records) ?? [], [globalQueueQuery.data?.records, filteredQueueQuery.data?.records, isFilteredQueueView])
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
    await Promise.all([
      globalQueueQuery.refetch(),
      filteredQueueQuery.refetch(),
      activeTab === 'reservations' ? reservationSchedulesQuery.refetch() : Promise.resolve(undefined),
      activeTab === 'reservations' ? reservationWorkflowQuery.refetch() : Promise.resolve(undefined),
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
              {filteredQueueQuery.isError ? (
                <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
                  {getErrorMessage(filteredQueueQuery.error, t('image-generation.components.generation.queue.header.widget.could.not.load.the.queue'))}
                </div>
              ) : null}

              {!filteredQueueQuery.isError && filteredQueueQuery.isPending ? <div className="text-sm text-muted-foreground">{t('image-generation.components.generation.queue.header.widget.loading.queue')}</div> : null}

              {!filteredQueueQuery.isPending && !filteredQueueQuery.isError && records.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">
                  {t({ ko: '지금 진행 중인 큐 작업이 없어.', en: 'No queue jobs are currently running.' })}
                </div>
              ) : null}

              {records.length > 0 ? (
                <div className="space-y-2">
                  {records.map((record) => {
                    const isBusy = pendingJobId === record.id
                    const isCancelRequested = record.cancel_requested > 0
                    const workflowLabel = getGenerationQueueWorkflowLabel(record, t)
                    const creatorLabel = getGenerationQueueRequesterLabel(record, t)
                    const remainingLabel = getGenerationQueueRemainingLabel(record, t, formatNumber)
                    const progressPercent = getGenerationQueueProgressPercent(record)
                    const shownProgressPercent = progressPercent == null ? null : Math.min(100, Math.max(progressPercent, progressPercent > 0 ? 8 : 0))
                    const canManageRecord = !isCancelRequested && (authStatusQuery.data?.isAdmin === true || record.is_mine === true)
                    const isRunning = record.status === 'running'
                    const startTimeLabel = formatQueueCompactStartTime(record.started_at ?? record.queued_at, locale)
                    const statusLabel = isCancelRequested ? t('image-generation.components.generation.queue.header.widget.cancel.requested') : getGenerationQueueStatusLabel(record, t)

                    return (
                      <div key={record.id} className="rounded-sm border border-border bg-surface-low px-3 py-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3 text-[11px]">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge variant={isCancelRequested ? 'outline' : 'secondary'} className={cn(isCancelRequested ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : '')}>{statusLabel}</Badge>
                              <span className="truncate font-medium text-foreground" title={workflowLabel}>{workflowLabel}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 font-medium text-foreground">
                              <span>{remainingLabel ? t('image-generation.components.generation.queue.header.widget.about.value', { remainingLabel }) : t('image-generation.components.generation.queue.header.widget.calculating')}</span>
                              {progressPercent != null ? <span className="text-muted-foreground">{progressPercent}%</span> : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-background/60">
                              <div
                                className={cn('h-full rounded-full transition-[width] duration-500', getQueueProgressToneClass(record))}
                                style={{ width: `${shownProgressPercent ?? 0}%` }}
                              />
                            </div>
                            {canManageRecord ? (
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="shrink-0"
                                onClick={() => void handleCancel(record.id)}
                                disabled={isBusy}
                                aria-label={isRunning
                                  ? t('image-generation.components.generation.queue.header.widget.queue.job.value.request.stop', { id: record.id })
                                  : t('image-generation.components.generation.queue.header.widget.queue.job.value.delete', { id: record.id })}
                                title={isRunning ? t('image-generation.components.generation.queue.header.widget.request.stop') : t('image-generation.components.generation.queue.header.widget.delete')}
                              >
                                {isRunning ? <Square className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            ) : null}
                          </div>

                          <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                            <span>{startTimeLabel ? `#${record.id} · ${startTimeLabel}` : `#${record.id}`}</span>
                            <span className="truncate">{record.is_mine ? t('image-generation.components.generation.queue.header.widget.value.me', { creatorLabel }) : creatorLabel}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
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
      </div>
    </div>
  )
}

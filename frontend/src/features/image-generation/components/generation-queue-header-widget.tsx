import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTodo, RefreshCw, Square, Trash2 } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getGenerationWorkflows } from '@/lib/api-image-generation-workflows'
import { cancelGenerationQueueJob, getGenerationQueue } from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import { getGraphWorkflowSchedules, getGraphWorkflows, type GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'
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

const ACTIVE_QUEUE_STATUSES: Array<GenerationQueueJobRecord['status']> = ['queued', 'dispatching', 'running']
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

function formatQueueCompactStartTime(value?: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatReservationTimestamp(value?: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getReservationStatusVariant(status: GraphWorkflowScheduleRecord['status']) {
  if (status === 'active') {
    return 'secondary' as const
  }

  if (status === 'error_stopped' || status === 'overlap_stopped') {
    return 'destructive' as const
  }

  return 'outline' as const
}

function getReservationTypeLabel(scheduleType: GraphWorkflowScheduleRecord['schedule_type']) {
  if (scheduleType === 'once') {
    return '1회 실행'
  }
  if (scheduleType === 'interval') {
    return 'N분마다'
  }
  return '매일'
}

function getReservationTimingLabel(schedule: GraphWorkflowScheduleRecord) {
  if (schedule.schedule_type === 'once') {
    return formatReservationTimestamp(schedule.run_at) ?? '시각 미설정'
  }

  if (schedule.schedule_type === 'interval') {
    return `${schedule.interval_minutes ?? '?'}분마다`
  }

  return `${schedule.daily_time ?? '--:--'} 매일`
}

function getReservationRunSummaryLabel(schedule: GraphWorkflowScheduleRecord) {
  const completedCount = schedule.completed_run_count ?? 0
  return `${completedCount}/${schedule.max_run_count ?? '-'}`
}

/** Render the global generation queue widget beside the header search action. */
export function GenerationQueueHeaderWidget() {
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<HeaderPopupTab>('jobs')
  const [pendingJobId, setPendingJobId] = useState<number | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<QueueFilterValue>('all')
  const [lastSeenQueueJobId, setLastSeenQueueJobId] = useState<number | null>(() => readLastSeenQueueJobId())
  const [isNotificationBaselineReady, setIsNotificationBaselineReady] = useState(() => readLastSeenQueueJobId() !== null)
  const containerRef = useRef<HTMLDivElement | null>(null)

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
    refetchInterval: (query) => {
      const activeCount = query.state.data?.records.length ?? 0
      return activeCount > 0 || isOpen ? 1500 : 4000
    },
  })

  const filteredQueueQuery = useQuery({
    queryKey: ['image-generation-queue', 'header-widget', 'filtered-active', filterParams.serviceType ?? 'all', filterParams.workflowId ?? null],
    queryFn: () => getGenerationQueue({
      status: ACTIVE_QUEUE_STATUSES,
      serviceType: filterParams.serviceType,
      workflowId: filterParams.workflowId,
    }),
    enabled: isFilteredQueueView,
    refetchInterval: (query) => {
      const activeCount = query.state.data?.records.length ?? 0
      return activeCount > 0 || isOpen ? 1500 : 4000
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

  const reservationSchedules = useMemo(() => {
    const schedules = reservationSchedulesQuery.data ?? []
    return [...schedules].sort((left, right) => {
      const leftActive = left.status === 'active' ? 1 : 0
      const rightActive = right.status === 'active' ? 1 : 0
      if (leftActive !== rightActive) {
        return rightActive - leftActive
      }

      const leftTime = left.next_run_at ?? left.updated_date
      const rightTime = right.next_run_at ?? right.updated_date
      return rightTime.localeCompare(leftTime)
    })
  }, [reservationSchedulesQuery.data])
  const activeReservationCount = useMemo(
    () => reservationSchedules.filter((schedule) => schedule.status === 'active').length,
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
        successMessage: '큐 작업을 정리했어.',
        failureMessage: '큐 작업 취소에 실패했어.',
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
        aria-label="작업 큐 및 예약작업 열기"
        aria-expanded={isOpen}
        title="작업 큐 / 예약작업"
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
              { value: 'jobs', label: '작업 큐' },
              { value: 'reservations', label: '예약작업' },
            ]}
            onChange={(nextTab) => setActiveTab(nextTab as HeaderPopupTab)}
            size="sm"
            fullWidth
            className="border-b-0 pb-0"
            actions={(
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => void handleRefresh()} title="팝업 새로고침" aria-label="팝업 새로고침">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
          />
        </div>

        {activeTab === 'jobs' ? (
          <>
            <div className="space-y-3 border-y border-border/70 px-3 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Scope</div>
                <Badge variant={filteredActiveCount > 0 ? 'secondary' : 'outline'} className="w-fit max-w-full">작업 큐 · {filteredActiveCount}</Badge>
              </div>
              <Select value={selectedFilter} onChange={(event) => setSelectedFilter(event.target.value as QueueFilterValue)} className="h-9 w-full min-w-0">
                <option value="all">전체 큐</option>
                <option value="novelai">NAI</option>
                <option value="codex">Codex</option>
                <option value="comfyui">ComfyUI 전체</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={`workflow:${workflow.id}`}>{workflow.name}</option>
                ))}
              </Select>
              {hasGenerationPermission && workflowsQuery.isError ? <div className="text-[11px] text-amber-700 dark:text-amber-300">워크플로우 목록을 못 불러와서 기본 큐 필터만 보여주고 있어.</div> : null}
            </div>

            <div className="max-h-[min(24rem,calc(100vh-var(--theme-shell-header-height)-5rem))] space-y-3 overflow-y-auto px-3 py-3 sm:max-h-[min(28rem,calc(100vh-var(--theme-shell-header-height)-2rem))] sm:px-4">
              {filteredQueueQuery.isError ? (
                <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
                  {getErrorMessage(filteredQueueQuery.error, '큐를 불러오지 못했어.')}
                </div>
              ) : null}

              {!filteredQueueQuery.isError && filteredQueueQuery.isPending ? <div className="text-sm text-muted-foreground">큐 불러오는 중…</div> : null}

              {!filteredQueueQuery.isPending && !filteredQueueQuery.isError && records.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">
                  지금 진행 중인 큐 작업이 없어.
                </div>
              ) : null}

              {records.length > 0 ? (
                <div className="space-y-2">
                  {records.map((record) => {
                    const isBusy = pendingJobId === record.id
                    const isCancelRequested = record.cancel_requested > 0
                    const workflowLabel = getGenerationQueueWorkflowLabel(record)
                    const creatorLabel = getGenerationQueueRequesterLabel(record)
                    const remainingLabel = getGenerationQueueRemainingLabel(record)
                    const progressPercent = getGenerationQueueProgressPercent(record)
                    const shownProgressPercent = progressPercent == null ? null : Math.min(100, Math.max(progressPercent, progressPercent > 0 ? 8 : 0))
                    const canManageRecord = !isCancelRequested && (authStatusQuery.data?.isAdmin === true || record.is_mine === true)
                    const isRunning = record.status === 'running'
                    const startTimeLabel = formatQueueCompactStartTime(record.started_at ?? record.queued_at)
                    const statusLabel = isCancelRequested ? '취소 요청됨' : getGenerationQueueStatusLabel(record)

                    return (
                      <div key={record.id} className="rounded-sm border border-border bg-surface-low px-3 py-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3 text-[11px]">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge variant={isCancelRequested ? 'outline' : 'secondary'} className={cn(isCancelRequested ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : '')}>{statusLabel}</Badge>
                              <span className="truncate font-medium text-foreground" title={workflowLabel}>{workflowLabel}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 font-medium text-foreground">
                              <span>{remainingLabel ? `약 ${remainingLabel}` : '계산 중'}</span>
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
                                aria-label={isRunning ? `큐 작업 ${record.id} 중지 요청` : `큐 작업 ${record.id} 삭제`}
                                title={isRunning ? '중지 요청' : '삭제'}
                              >
                                {isRunning ? <Square className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            ) : null}
                          </div>

                          <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                            <span>{startTimeLabel ? `#${record.id} · ${startTimeLabel}` : `#${record.id}`}</span>
                            <span className="truncate">{record.is_mine ? `${creatorLabel} (나)` : creatorLabel}</span>
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
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">요약</div>
                <Badge variant={reservationSchedules.length > 0 ? 'secondary' : 'outline'} className="w-fit max-w-full">예약작업 · {reservationSchedules.length}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={activeReservationCount > 0 ? 'secondary' : 'outline'}>활성 {activeReservationCount}</Badge>
                <Badge variant="outline">전체 {reservationSchedules.length}</Badge>
              </div>
            </div>

            <div className="max-h-[min(24rem,calc(100vh-var(--theme-shell-header-height)-5rem))] space-y-3 overflow-y-auto px-3 py-3 sm:max-h-[min(28rem,calc(100vh-var(--theme-shell-header-height)-2rem))] sm:px-4">
              {reservationSchedulesQuery.isError ? (
                <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
                  {getErrorMessage(reservationSchedulesQuery.error, '예약작업을 불러오지 못했어.')}
                </div>
              ) : null}

              {!reservationSchedulesQuery.isError && reservationSchedulesQuery.isPending ? <div className="text-sm text-muted-foreground">예약작업 불러오는 중…</div> : null}

              {!reservationSchedulesQuery.isPending && !reservationSchedulesQuery.isError && reservationSchedules.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">
                  등록된 예약작업이 아직 없어.
                </div>
              ) : null}

              {reservationSchedules.length > 0 ? (
                <div className="space-y-2">
                  {reservationSchedules.map((schedule) => {
                    const nextRunAt = formatReservationTimestamp(schedule.next_run_at)
                    const lastEnqueuedAt = formatReservationTimestamp(schedule.last_enqueued_at)
                    const runSummaryLabel = getReservationRunSummaryLabel(schedule)
                    return (
                      <div key={schedule.id} className="rounded-sm border border-border bg-surface-low px-3 py-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-medium text-foreground">{schedule.name}</div>
                            <Badge variant={getReservationStatusVariant(schedule.status)}>{getGraphWorkflowScheduleStatusLabel(schedule.status)}</Badge>
                            <Badge variant="outline">{getReservationTypeLabel(schedule.schedule_type)}</Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {reservationWorkflowNameById.get(schedule.graph_workflow_id) ?? `워크플로우 #${schedule.graph_workflow_id}`} · {getReservationTimingLabel(schedule)}
                          </div>
                          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                            <span>{runSummaryLabel}</span>
                            {nextRunAt ? <span>다음 등록 시도 {nextRunAt}</span> : null}
                            {lastEnqueuedAt ? <span>최근 큐 등록 {lastEnqueuedAt}</span> : null}
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

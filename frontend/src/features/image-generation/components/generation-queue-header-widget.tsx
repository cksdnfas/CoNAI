import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTodo, RefreshCw } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
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
import { runGenerationQueueMutation } from './generation-queue-actions'
import {
  canRetryGenerationQueueCancellation,
  getGenerationQueueHeaderQuerySnapshot,
  getGenerationQueueHeaderRefreshTargets,
  getGenerationQueueWorkflowLabel,
  shouldEnableFilteredQueueHeaderQuery,
} from './generation-queue-ui'
import { GenerationQueueJobsTab, type QueueFilterValue } from './generation-queue-jobs-tab'
import { GenerationQueueReservationsTab } from './generation-queue-reservations-tab'
import { getActiveWorkflowReservationScheduleCount, sortWorkflowReservationSchedules } from './workflow-reservations-ui'

const POPUP_LIST_CLASS_NAME = 'max-h-[min(24rem,calc(100vh-var(--theme-shell-header-height)-5rem))] space-y-3 overflow-y-auto px-3 py-3 sm:max-h-[min(28rem,calc(100vh-var(--theme-shell-header-height)-2rem))] sm:px-4'
const ACTIVE_QUEUE_STATUSES: Array<GenerationQueueJobRecord['status']> = ['queued', 'dispatching', 'running']
const ACTIVE_QUEUE_REFETCH_INTERVAL_MS = 3_000
const IDLE_QUEUE_REFETCH_INTERVAL_MS = 30_000
const LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY = 'conai:image-generation-queue:last-seen-job-id'

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

/** Render the global generation queue widget beside the header search action. */
export function GenerationQueueHeaderWidget() {
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const { t, formatNumber } = useI18n()
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

  const canViewWorkflows = (authStatusQuery.data?.permissionKeys ?? []).includes('workflows.view')
  // 큐 목록 REST 는 인증만 요구한다(permission-neutral). 페이지 권한은 워크플로 필터 목록과
  // 예약 탭에만 필요하므로, 큐 조회 자체는 인증 세션 기준으로 켠다.
  const canViewQueue = authStatusQuery.data !== undefined
    && (authStatusQuery.data.hasCredentials !== true || authStatusQuery.data.authenticated === true)

  const workflowsQuery = useQuery({
    queryKey: ['generation-workflows', 'header-widget'],
    queryFn: () => getGenerationWorkflows(true, 'all'),
    staleTime: 60_000,
    enabled: canViewWorkflows,
  })

  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data])
  const filterParams = useMemo(() => parseQueueFilter(selectedFilter), [selectedFilter])
  const isFilteredQueueView = selectedFilter !== 'all'
  const isFilteredQueueQueryEnabled = shouldEnableFilteredQueueHeaderQuery({
    canViewQueue,
    isFilteredQueueView,
    isOpen,
  })

  const globalQueueQuery = useQuery({
    queryKey: ['image-generation-queue', 'header-widget', 'global-active'],
    queryFn: () => getGenerationQueue({ status: ACTIVE_QUEUE_STATUSES }),
    enabled: canViewQueue,
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
    enabled: isOpen && canViewWorkflows,
    staleTime: 60_000,
  })

  const reservationSchedulesQuery = useQuery({
    queryKey: ['graph-workflow-schedules', 'header-widget'],
    queryFn: () => getGraphWorkflowSchedules(),
    enabled: isOpen && canViewWorkflows,
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
      total: globalQueueQuery.data?.total,
      isPending: globalQueueQuery.isPending,
      isError: globalQueueQuery.isError,
      error: globalQueueQuery.error,
    },
    filteredQueue: {
      records: filteredQueueQuery.data?.records,
      total: filteredQueueQuery.data?.total,
      isPending: filteredQueueQuery.isPending,
      isError: filteredQueueQuery.isError,
      error: filteredQueueQuery.error,
    },
  })
  const records = useMemo(() => activeQueueQuery.records ?? [], [activeQueueQuery.records])
  // 목록은 서버에서 200건으로 잘리므로 배지는 서버 total 을 쓴다(목록 길이는 폴백).
  const globalActiveCount = globalQueueQuery.data?.total ?? globalRecords.length
  const filteredActiveCount = activeQueueQuery.total ?? records.length
  const latestQueueJobId = useMemo(() => globalRecords.reduce((maxId, record) => Math.max(maxId, record.id), 0), [globalRecords])
  const reservationWorkflowNameById = useMemo(
    () => new Map((reservationWorkflowQuery.data ?? []).map((workflow) => [workflow.id, workflow.name] as const)),
    [reservationWorkflowQuery.data],
  )

  const reservationSchedules = useMemo(() => sortWorkflowReservationSchedules(reservationSchedulesQuery.data ?? []), [reservationSchedulesQuery.data])
  const activeReservationCount = getActiveWorkflowReservationScheduleCount(reservationSchedules)

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
      // The cancel confirmation renders in a body portal; clicking it must not close the popup behind it.
      if (event.target instanceof Element && event.target.closest('[data-slot="confirm-dialog"], [data-slot="confirm-dialog-overlay"]')) {
        return
      }
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
  // 예약 탭은 백엔드가 workflows.view 로 403 을 주는 표면이므로 권한 없는 계정에는 숨긴다.
  const effectiveTab: HeaderPopupTab = canViewWorkflows ? activeTab : 'jobs'

  const handleRefresh = async () => {
    const refreshTargets = getGenerationQueueHeaderRefreshTargets({
      activeTab: effectiveTab,
      isFilteredQueueQueryEnabled,
    })

    await Promise.all([
      refreshTargets.includes('globalQueue') ? globalQueueQuery.refetch() : Promise.resolve(undefined),
      refreshTargets.includes('filteredQueue') ? filteredQueueQuery.refetch() : Promise.resolve(undefined),
      refreshTargets.includes('reservationSchedules') ? reservationSchedulesQuery.refetch() : Promise.resolve(undefined),
      refreshTargets.includes('reservationWorkflows') ? reservationWorkflowQuery.refetch() : Promise.resolve(undefined),
    ])
  }

  const handleCancel = async (record: GenerationQueueJobRecord) => {
    if (pendingJobId !== null) {
      return
    }

    const jobId = record.id
    // 취소 재시도는 이미 한 번 확인한 요청이라 다시 묻지 않는다.
    if (!canRetryGenerationQueueCancellation(record)) {
      const workflowLabel = getGenerationQueueWorkflowLabel(record, t)
      const isRunning = record.status === 'running'
      const confirmed = await confirm(isRunning
        ? {
            title: t({ ko: '이 작업을 멈출까?', en: 'Stop this job?' }),
            description: t({ ko: '{label} 실행에 중지를 요청해. 되돌릴 수 없어.', en: 'This requests a stop for {label}. It can\'t be undone.' }, { label: workflowLabel }),
            confirmLabel: t({ ko: '중지', en: 'Stop' }),
            tone: 'destructive',
          }
        : {
            title: t({ ko: '대기 중인 작업을 지울까?', en: 'Remove this queued job?' }),
            description: t({ ko: '{label} 작업이 큐에서 빠지고 실행되지 않아.', en: '{label} will be removed from the queue and won\'t run.' }, { label: workflowLabel }),
            confirmLabel: t({ ko: '삭제', en: 'Delete' }),
            tone: 'destructive',
          })
      if (!confirmed) {
        return
      }
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
  const cancelJob = useCallback((record: GenerationQueueJobRecord) => {
    void handleCancelRef.current(record)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        variant="shell"
        onClick={() => setIsOpen((current) => !current)}
        data-state={isOpen ? 'open' : globalActiveCount > 0 ? 'active' : 'closed'}
        className="relative"
        label={t('image-generation.components.generation.queue.header.widget.open.job.queue.and.reservations')}
        tooltipSide="bottom"
        aria-expanded={isOpen}
      >
        <ListTodo className="h-4 w-4" />
        {globalActiveCount > 0 ? (
          <span className="absolute -right-1 -bottom-1 inline-flex min-w-4 items-center justify-center rounded-sm bg-primary px-1 text-2xs font-semibold leading-4 text-primary-foreground ring-2 ring-background">
            {formatNumber(globalActiveCount)}
          </span>
        ) : null}
        {hasUnreadQueueUpdate ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-background" aria-hidden="true" /> : null}
      </IconButton>

      <div
        className={cn(
          'theme-floating-panel fixed left-2 right-2 top-[calc(var(--theme-shell-header-height)+0.5rem)] z-popover overflow-hidden rounded-md transition-opacity sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(33rem,calc(100vw-1rem))]',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {/* 닫힌 팝업까지 전역 잡 목록을 매 렌더 재조정하지 않도록, 프레임만 남기고 내용은 열렸을 때만 렌더한다. */}
        {isOpen ? (<>
        <div className="px-3 py-3 sm:px-4">
          <SegmentedTabBar
            value={effectiveTab}
            items={[
              { value: 'jobs', label: t('image-generation.components.generation.queue.header.widget.job.queue') },
              ...(canViewWorkflows
                ? [{
                    value: 'reservations',
                    // The active count rides on the label (the tab has no summary row).
                    label: [
                      t('image-generation.components.generation.queue.header.widget.reservations'),
                      activeReservationCount > 0 ? t({ ko: '활성 {count}', en: 'Active {count}' }, { count: formatNumber(activeReservationCount) }) : null,
                    ].filter(Boolean).join(' · '),
                  }]
                : []),
            ]}
            onChange={(nextTab) => setActiveTab(nextTab as HeaderPopupTab)}
            size="sm"
            fullWidth
            className="border-b-0 pb-0"
            actions={(
              <IconButton size="icon-xs" variant="ghost" onClick={() => void handleRefresh()} label={t('image-generation.components.generation.queue.header.widget.refresh.popup')}>
                <RefreshCw />
              </IconButton>
            )}
          />
        </div>

        {effectiveTab === 'jobs' ? (
          <GenerationQueueJobsTab
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
            workflows={workflows}
            showWorkflowListError={canViewWorkflows && workflowsQuery.isError}
            filteredActiveCount={filteredActiveCount}
            records={records}
            isPending={activeQueueQuery.isPending}
            isError={activeQueueQuery.isError}
            error={activeQueueQuery.error}
            pendingJobId={pendingJobId}
            isAdmin={authStatusQuery.data?.isAdmin === true}
            onCancel={cancelJob}
            listClassName={POPUP_LIST_CLASS_NAME}
          />
        ) : (
          <GenerationQueueReservationsTab
            schedules={reservationSchedules}
            workflowNameById={reservationWorkflowNameById}
            isPending={reservationSchedulesQuery.isPending}
            isError={reservationSchedulesQuery.isError}
            error={reservationSchedulesQuery.error}
            listClassName={POPUP_LIST_CLASS_NAME}
          />
        )}
        </>) : null}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTodo, RefreshCw, Square, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getGenerationWorkflows } from '@/lib/api-image-generation-workflows'
import { cancelGenerationQueueJob, getGenerationQueue } from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'
import { runGenerationQueueMutation } from './generation-queue-actions'
import {
  formatGenerationQueueTimestamp,
  getGenerationQueueEtaLabel,
  getGenerationQueuePositionLabel,
  getGenerationQueueProgressPercent,
  getGenerationQueueRemainingLabel,
  getGenerationQueueRequesterLabel,
  getGenerationQueueStatusLabel,
  getGenerationQueueWorkflowLabel,
} from './generation-queue-ui'

const ACTIVE_QUEUE_STATUSES: Array<GenerationQueueJobRecord['status']> = ['queued', 'dispatching', 'running']
const LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY = 'conai:image-generation-queue:last-seen-job-id'

type QueueFilterValue = 'all' | 'novelai' | 'comfyui' | `workflow:${number}`

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

function getQueueLaneLabel(record: GenerationQueueJobRecord, queuePositionLabel: string | null) {
  if (queuePositionLabel) {
    return queuePositionLabel
  }

  if (record.assigned_server_id != null) {
    return `서버 ${record.assigned_server_id}`
  }

  if (record.requested_server_id != null) {
    return `서버 ${record.requested_server_id}`
  }

  if (record.requested_server_tag) {
    return `태그 #${record.requested_server_tag}`
  }

  return record.service_type === 'comfyui' ? '자동 분산' : '기본 대기열'
}

function getQueueProgressToneClass(record: GenerationQueueJobRecord) {
  if (record.status === 'running') {
    return 'bg-primary'
  }

  return 'bg-secondary'
}

/** Render the global generation queue widget beside the header search action. */
export function GenerationQueueHeaderWidget() {
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const [isOpen, setIsOpen] = useState(false)
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
    refetchInterval: (query) => {
      const activeCount = query.state.data?.records.length ?? 0
      return activeCount > 0 || isOpen ? 1500 : 4000
    },
  })

  const globalRecords = useMemo(() => globalQueueQuery.data?.records ?? [], [globalQueueQuery.data?.records])
  const records = useMemo(() => filteredQueueQuery.data?.records ?? [], [filteredQueueQuery.data?.records])
  const globalActiveCount = globalRecords.length
  const filteredActiveCount = records.length
  const latestQueueJobId = useMemo(() => globalRecords.reduce((maxId, record) => Math.max(maxId, record.id), 0), [globalRecords])

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
    await Promise.all([globalQueueQuery.refetch(), filteredQueueQuery.refetch()])
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
        className="theme-floating-panel relative inline-flex items-center gap-2 rounded-full p-2 text-sm text-foreground transition hover:bg-surface-high"
        aria-label="작업 큐 열기"
        aria-expanded={isOpen}
        title="작업 큐"
      >
        <ListTodo className="h-4 w-4" />
        {globalActiveCount > 0 ? <span className="rounded-full bg-primary/14 px-2 py-0.5 text-[11px] font-semibold text-primary">{globalActiveCount}</span> : null}
        {hasUnreadQueueUpdate ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-rose-500 shadow-[0_0_0_2px_var(--background)]" aria-hidden="true" /> : null}
      </button>

      <div
        className={cn(
          'theme-floating-panel fixed left-2 right-2 top-[calc(var(--theme-shell-header-height)+0.5rem)] z-[70] overflow-hidden rounded-sm border border-border/80 bg-background/95 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur transition-opacity sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(33rem,calc(100vw-1rem))]',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-3 sm:px-4">
          <div className="text-sm font-semibold text-foreground">작업 큐</div>
          <Button type="button" size="icon-xs" variant="ghost" onClick={() => void handleRefresh()} title="큐 새로고침" aria-label="큐 새로고침">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="space-y-3 border-b border-border/70 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Scope</div>
            <Badge variant={filteredActiveCount > 0 ? 'secondary' : 'outline'} className="w-fit max-w-full">큐 대기열 · {filteredActiveCount}</Badge>
          </div>
          <Select value={selectedFilter} onChange={(event) => setSelectedFilter(event.target.value as QueueFilterValue)} className="h-9 w-full min-w-0">
            <option value="all">전체 큐</option>
            <option value="novelai">NAI</option>
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
                const queuePositionLabel = getGenerationQueuePositionLabel(record)
                const queuedAt = formatGenerationQueueTimestamp(record.queued_at)
                const startedAt = formatGenerationQueueTimestamp(record.started_at)
                const isCancelRequested = record.cancel_requested > 0
                const workflowLabel = getGenerationQueueWorkflowLabel(record)
                const creatorLabel = getGenerationQueueRequesterLabel(record)
                const remainingLabel = getGenerationQueueRemainingLabel(record)
                const progressPercent = getGenerationQueueProgressPercent(record)
                const shownProgressPercent = progressPercent == null ? null : Math.min(100, Math.max(progressPercent, progressPercent > 0 ? 8 : 0))
                const laneLabel = getQueueLaneLabel(record, queuePositionLabel)
                const canManageRecord = !isCancelRequested && (authStatusQuery.data?.isAdmin === true || record.is_mine === true)
                const isRunning = record.status === 'running'

                return (
                  <div key={record.id} className="rounded-sm border border-border bg-surface-low px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{getGenerationQueueStatusLabel(record)}</Badge>
                          <Badge variant="outline" className="max-w-full truncate">{laneLabel}</Badge>
                          {isCancelRequested ? <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">취소 요청됨</Badge> : null}
                        </div>

                        <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
                          <span className="text-muted-foreground">생성자</span>
                          <span className="truncate text-foreground/92">{record.is_mine ? `${creatorLabel} (나)` : creatorLabel}</span>
                          <span className="text-muted-foreground">워크플로</span>
                          <span className="truncate font-medium text-foreground" title={workflowLabel}>{workflowLabel}</span>
                        </div>

                        <div className="rounded-sm border border-border/70 bg-background/45 px-2.5 py-2">
                          <div className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="font-medium text-muted-foreground">남은 시간</span>
                            <span className="shrink-0 font-semibold text-foreground">{remainingLabel ? `약 ${remainingLabel}` : '계산 중'}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-lowest">
                            <div
                              className={cn('h-full rounded-full transition-[width] duration-500', getQueueProgressToneClass(record))}
                              style={{ width: `${shownProgressPercent ?? 0}%` }}
                            />
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                            <span>{progressPercent == null ? '예측 중' : `${progressPercent}%`}</span>
                            <span className="truncate">{isRunning ? '실행 진행도' : laneLabel}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                          <span>job #{record.id}</span>
                          {queuedAt ? <span>queued {queuedAt}</span> : null}
                          {startedAt ? <span>started {startedAt}</span> : null}
                        </div>

                        {isCancelRequested ? (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">시스템에 취소 요청은 들어갔고, 업스트림 작업은 잠깐 더 돌 수 있어.</div>
                        ) : null}
                      </div>

                      {canManageRecord ? (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => void handleCancel(record.id)}
                            disabled={isBusy}
                            aria-label={isRunning ? `큐 작업 ${record.id} 중지 요청` : `큐 작업 ${record.id} 삭제`}
                            title={isRunning ? '중지 요청' : '삭제'}
                          >
                            {isRunning ? <Square className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

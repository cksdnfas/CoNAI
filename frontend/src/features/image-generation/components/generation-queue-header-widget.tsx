import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTodo, RefreshCw, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getGenerationWorkflows } from '@/lib/api-image-generation-workflows'
import { cancelGenerationQueueJob, getGenerationQueue } from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord, GenerationWorkflow } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'

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

function getQueueStatusLabel(record: GenerationQueueJobRecord) {
  switch (record.status) {
    case 'queued':
      return '대기 중'
    case 'dispatching':
      return '전송 중'
    case 'running':
      return '실행 중'
    default:
      return record.status
  }
}

function formatQueueTimestamp(value?: string | null) {
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

function formatEtaSeconds(value?: number | null) {
  if (value === undefined || value === null || value < 0) {
    return null
  }

  if (value < 60) {
    return `${Math.max(1, Math.round(value))}초`
  }

  const minutes = Math.round(value / 60)
  if (minutes < 60) {
    return `${minutes}분`
  }

  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${hours}시간 ${remainMinutes}분` : `${hours}시간`
}

function getQueuePositionLabel(record: GenerationQueueJobRecord) {
  if (record.queue_position == null || (record.status !== 'queued' && record.status !== 'dispatching')) {
    return null
  }

  if (record.queue_position_scope === 'server') {
    const serverId = record.queue_position_server_id ?? record.requested_server_id ?? record.assigned_server_id ?? null
    return serverId != null ? `서버 ${serverId} · ${record.queue_position}번째` : `서버 대기열 · ${record.queue_position}번째`
  }

  if (record.queue_position_scope === 'tag') {
    const serverTag = record.queue_position_server_tag ?? record.requested_server_tag ?? null
    return serverTag ? `태그 #${serverTag} · ${record.queue_position}번째` : `태그 대기열 · ${record.queue_position}번째`
  }

  if (record.queue_position_scope === 'auto') {
    return `자동 분산 · ${record.queue_position}번째`
  }

  return `대기열 · ${record.queue_position}번째`
}

function getQueueEtaLabel(record: GenerationQueueJobRecord) {
  const eta = formatEtaSeconds(record.estimated_total_seconds)
  if (!eta) {
    return null
  }

  return record.status === 'running' ? `남은 시간 약 ${eta}` : `완료까지 약 ${eta}`
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

/** Render the global generation queue widget beside the header search action. */
export function GenerationQueueHeaderWidget() {
  const { showSnackbar } = useSnackbar()
  const [isOpen, setIsOpen] = useState(false)
  const [pendingJobId, setPendingJobId] = useState<number | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<QueueFilterValue>('all')
  const [lastSeenQueueJobId, setLastSeenQueueJobId] = useState<number | null>(() => readLastSeenQueueJobId())
  const [isNotificationBaselineReady, setIsNotificationBaselineReady] = useState(() => readLastSeenQueueJobId() !== null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const workflowsQuery = useQuery({
    queryKey: ['generation-workflows', 'header-widget'],
    queryFn: () => getGenerationWorkflows(true),
    staleTime: 60_000,
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
      const result = await cancelGenerationQueueJob(jobId)
      await handleRefresh()
      showSnackbar({ message: result.message || '큐 작업을 정리했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '큐 작업 취소에 실패했어.'), tone: 'error' })
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
          'theme-floating-panel fixed left-2 right-2 top-[calc(var(--theme-shell-header-height)+0.5rem)] z-[70] overflow-hidden rounded-sm border border-border/80 bg-background/95 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur transition-opacity sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(28rem,calc(100vw-1rem))]',
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
          {workflowsQuery.isError ? <div className="text-[11px] text-amber-700 dark:text-amber-300">워크플로우 목록을 못 불러와서 기본 큐 필터만 보여주고 있어.</div> : null}
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
                const queuePositionLabel = getQueuePositionLabel(record)
                const queueEtaLabel = getQueueEtaLabel(record)
                const queuedAt = formatQueueTimestamp(record.queued_at)
                const startedAt = formatQueueTimestamp(record.started_at)
                const isCancelRequested = record.cancel_requested > 0

                return (
                  <div key={record.id} className="rounded-sm border border-border bg-surface-low px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-medium text-foreground">{record.request_summary || record.workflow_name || `${record.service_type} job #${record.id}`}</div>
                          <Badge variant="secondary">{getQueueStatusLabel(record)}</Badge>
                          <Badge variant="outline">{record.service_type === 'novelai' ? 'NAI' : record.workflow_name ? `WF · ${record.workflow_name}` : 'ComfyUI'}</Badge>
                          {queuePositionLabel ? <Badge variant="outline">{queuePositionLabel}</Badge> : null}
                          {queueEtaLabel ? <Badge variant="outline">{queueEtaLabel}</Badge> : null}
                          {record.assigned_server_id != null ? <Badge variant="outline">서버 {record.assigned_server_id}</Badge> : null}
                          {isCancelRequested ? <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">취소 요청됨</Badge> : null}
                        </div>

                        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                          <span>job #{record.id}</span>
                          {queuedAt ? <span>queued {queuedAt}</span> : null}
                          {startedAt ? <span>started {startedAt}</span> : null}
                        </div>

                        {isCancelRequested ? (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">시스템 쪽 취소 요청만 먼저 기록된 상태야. 업스트림 실행은 잠깐 더 갈 수 있어.</div>
                        ) : null}
                      </div>

                      {!isCancelRequested ? (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => void handleCancel(record.id)}
                            disabled={isBusy}
                            aria-label={`큐 작업 ${record.id} 취소`}
                            title="취소"
                          >
                            <Square className="h-3.5 w-3.5" />
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

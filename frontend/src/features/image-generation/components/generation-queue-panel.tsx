import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, RotateCcw, Square } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  cancelGenerationQueueJob,
  getGenerationQueue,
  getGenerationQueueStats,
  retryGenerationQueueJob,
} from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord, GenerationServiceType } from '@/lib/api-image-generation-types'
import { getErrorMessage } from '../image-generation-shared'

type GenerationQueuePanelProps = {
  refreshNonce: number
  serviceType: GenerationServiceType
  workflowId?: number | null
}

function isActiveQueueStatus(status: GenerationQueueJobRecord['status']) {
  return status === 'queued' || status === 'dispatching' || status === 'running'
}

function getQueueStatusLabel(record: GenerationQueueJobRecord) {
  if (record.cancel_requested > 0 && record.status === 'completed') {
    return '취소 요청 후 완료'
  }

  if (record.cancel_requested > 0 && record.status === 'failed') {
    return '취소 요청 후 실패'
  }

  switch (record.status) {
    case 'queued':
      return '대기 중'
    case 'dispatching':
      return '전송 중'
    case 'running':
      return '실행 중'
    case 'completed':
      return '완료'
    case 'failed':
      return '실패'
    case 'cancelled':
      return '취소됨'
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

function getQueuePositionLabel(record: GenerationQueueJobRecord) {
  if (record.queue_position == null || (record.status !== 'queued' && record.status !== 'dispatching')) {
    return null
  }

  if (record.queue_position_scope === 'server') {
    const serverId = record.queue_position_server_id ?? record.requested_server_id ?? record.assigned_server_id ?? null
    return serverId != null ? `서버 ${serverId} 대기열 ${record.queue_position}` : `서버 대기열 ${record.queue_position}`
  }

  if (record.queue_position_scope === 'tag') {
    const serverTag = record.queue_position_server_tag ?? record.requested_server_tag ?? null
    return serverTag ? `태그 #${serverTag} 대기열 ${record.queue_position}` : `태그 대기열 ${record.queue_position}`
  }

  if (record.queue_position_scope === 'auto') {
    return `자동 분산 ${record.queue_position}`
  }

  return `대기열 ${record.queue_position}`
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

function getQueueEtaLabel(record: GenerationQueueJobRecord) {
  if (record.status === 'running') {
    const remaining = formatEtaSeconds(record.estimated_total_seconds)
    return remaining ? `남은 시간 약 ${remaining}` : null
  }

  if (record.status === 'queued' || record.status === 'dispatching') {
    const totalEta = formatEtaSeconds(record.estimated_total_seconds)
    return totalEta ? `완료까지 약 ${totalEta}` : null
  }

  return null
}

/** Render a lightweight queue operations panel for image-generation jobs. */
export function GenerationQueuePanel({ refreshNonce, serviceType, workflowId }: GenerationQueuePanelProps) {
  const { showSnackbar } = useSnackbar()
  const [pendingJobId, setPendingJobId] = useState<number | null>(null)

  const queueQuery = useQuery({
    queryKey: ['image-generation-queue', serviceType, workflowId ?? null],
    queryFn: () => getGenerationQueue({
      serviceType,
      workflowId,
    }),
    refetchInterval: (query) => {
      const records = query.state.data?.records ?? []
      return records.some((record) => isActiveQueueStatus(record.status)) ? 1500 : false
    },
  })

  const queueStatsQuery = useQuery({
    queryKey: ['image-generation-queue-stats', serviceType, workflowId ?? null],
    queryFn: () => getGenerationQueueStats({
      serviceType,
      workflowId,
    }),
    refetchInterval: (query) => {
      const activeVisible = query.state.data?.active_visible ?? 0
      return activeVisible > 0 ? 1500 : false
    },
  })

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void Promise.all([queueQuery.refetch(), queueStatsQuery.refetch()])
  }, [queueQuery, queueStatsQuery, refreshNonce])

  const visibleRecords = useMemo(() => queueQuery.data?.records ?? [], [queueQuery.data?.records])

  const activeCount = visibleRecords.filter((record) => isActiveQueueStatus(record.status)).length

  const handleRefresh = async () => {
    await Promise.all([queueQuery.refetch(), queueStatsQuery.refetch()])
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

  const handleRetry = async (jobId: number) => {
    if (pendingJobId !== null) {
      return
    }

    try {
      setPendingJobId(jobId)
      const result = await retryGenerationQueueJob(jobId)
      await handleRefresh()
      showSnackbar({ message: result.message || '큐 작업을 다시 넣었어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '큐 작업 재시도에 실패했어.'), tone: 'error' })
    } finally {
      setPendingJobId(null)
    }
  }

  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
            heading="Queue"
            actions={(
              <>
                <Badge variant="outline">{serviceType === 'novelai' ? 'NAI' : workflowId ? 'ComfyUI Workflow' : 'ComfyUI'}</Badge>
                <Badge variant={activeCount > 0 ? 'secondary' : 'outline'}>활성 {activeCount}</Badge>
                <Badge variant="outline">표시 {visibleRecords.length}</Badge>
                <Button type="button" size="icon-sm" variant="outline" onClick={() => void handleRefresh()} title="큐 새로고침" aria-label="큐 새로고침">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </>
            )}
          />

          {queueQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>큐를 불러오지 못했어</AlertTitle>
              <AlertDescription>{getErrorMessage(queueQuery.error, '큐 조회 실패')}</AlertDescription>
            </Alert>
          ) : null}

          {!queueQuery.isError && queueQuery.isPending ? <div className="text-sm text-muted-foreground">큐 불러오는 중…</div> : null}

          {!queueQuery.isPending && visibleRecords.length === 0 ? (
            <div className="text-sm text-muted-foreground">지금 보이는 큐 작업이 없어.</div>
          ) : null}

          {visibleRecords.length > 0 ? (
            <div className="space-y-2">
              {visibleRecords.map((record) => {
                const queuedAt = formatQueueTimestamp(record.queued_at)
                const startedAt = formatQueueTimestamp(record.started_at)
                const completedAt = formatQueueTimestamp(record.completed_at)
                const hasCancelRequest = record.cancel_requested > 0
                const isCancelRequested = hasCancelRequest && isActiveQueueStatus(record.status)
                const completedAfterCancel = hasCancelRequest && record.status === 'completed'
                const failedAfterCancel = hasCancelRequest && record.status === 'failed'
                const canCancel = (record.status === 'queued' || record.status === 'dispatching' || record.status === 'running') && !isCancelRequested
                const canRetry = record.status === 'failed' || record.status === 'cancelled'
                const isBusy = pendingJobId === record.id
                const queuePositionLabel = getQueuePositionLabel(record)
                const queueEtaLabel = getQueueEtaLabel(record)

                return (
                  <div key={record.id} className="rounded-sm border border-border bg-surface-low px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-foreground">{record.request_summary || record.workflow_name || `${record.service_type} job #${record.id}`}</div>
                          <Badge variant={isActiveQueueStatus(record.status) ? 'secondary' : 'outline'}>{getQueueStatusLabel(record)}</Badge>
                          {queuePositionLabel ? (
                            <Badge variant="outline">{queuePositionLabel}</Badge>
                          ) : null}
                          {queueEtaLabel ? <Badge variant="outline">{queueEtaLabel}</Badge> : null}
                          {record.assigned_server_id != null ? <Badge variant="outline">서버 {record.assigned_server_id}</Badge> : null}
                          {isCancelRequested ? <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">취소 요청됨</Badge> : null}
                          {completedAfterCancel ? <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">취소 요청 기록</Badge> : null}
                          {failedAfterCancel ? <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">취소 요청 기록</Badge> : null}
                        </div>

                        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                          <span>job #{record.id}</span>
                          {queuedAt ? <span>queued {queuedAt}</span> : null}
                          {startedAt ? <span>started {startedAt}</span> : null}
                          {completedAt ? <span>done {completedAt}</span> : null}
                        </div>

                        {isCancelRequested ? (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">시스템에서 취소 요청을 기록했어. 업스트림 실행은 마무리될 때까지 계속될 수 있어.</div>
                        ) : null}
                        {completedAfterCancel ? (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">중간에 취소 요청은 기록됐지만 업스트림 작업이 이미 완료까지 도달했어.</div>
                        ) : null}
                        {failedAfterCancel ? (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">중간에 취소 요청은 기록됐고, 최종 업스트림 종료 결과는 실패로 남았어.</div>
                        ) : null}
                        {record.failure_message ? (
                          <div className="text-[11px] text-danger">{record.failure_message}</div>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 gap-1">
                        {canRetry ? (
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => void handleRetry(record.id)}
                            disabled={isBusy}
                            aria-label={`큐 작업 ${record.id} 재시도`}
                            title="재시도"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {canCancel ? (
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
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}

          {queueStatsQuery.data && !queueQuery.isError ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">visible queued {queueStatsQuery.data.visible.queued}</Badge>
              <Badge variant="outline">dispatching {queueStatsQuery.data.visible.dispatching}</Badge>
              <Badge variant="outline">running {queueStatsQuery.data.visible.running}</Badge>
              <Badge variant="outline">failed {queueStatsQuery.data.visible.failed}</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

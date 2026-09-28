import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getGenerationQueue } from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord, GenerationServiceType } from '@/lib/api-image-generation-types'

const ACTIVE_QUEUE_STATUSES: Array<GenerationQueueJobRecord['status']> = ['queued', 'dispatching', 'running']

/**
 * The current requester's active queue jobs for one provider (and ComfyUI workflow).
 * Reads the header queue widget's cache entry without a refetch interval of its own: the widget and the
 * runtime-event bridge keep that entry fresh, so the stage adds no polling.
 */
export function useGenerationStageQueue({ serviceType, workflowId }: { serviceType: GenerationServiceType; workflowId?: number | null }) {
  const authStatusQuery = useAuthStatusQuery()
  const canViewQueue = authStatusQuery.data !== undefined
    && (authStatusQuery.data.hasCredentials !== true || authStatusQuery.data.authenticated === true)
  const accountId = authStatusQuery.data?.accountId ?? null
  const queueQuery = useQuery({
    queryKey: ['image-generation-queue', 'header-widget', 'global-active'],
    queryFn: () => getGenerationQueue({ status: ACTIVE_QUEUE_STATUSES }),
    enabled: canViewQueue,
  })

  const jobs = useMemo(() => {
    const records = queueQuery.data?.records ?? []
    return records
      .filter((record) => record.service_type === serviceType
        && (workflowId == null || record.workflow_id === workflowId)
        && (accountId == null || record.requested_by_account_id === accountId))
      // 실행 중인 작업을 먼저, 그다음 먼저 들어온 순서.
      .sort((left, right) => (left.status === 'running' ? 0 : 1) - (right.status === 'running' ? 0 : 1) || left.id - right.id)
  }, [accountId, queueQuery.data?.records, serviceType, workflowId])

  const activeJob = jobs[0] ?? null
  const isRunning = activeJob?.status === 'running'
  // 남은 시간/예상 진행률은 시작 시각 기준이라 실행 중에만 1초마다 다시 그린다(네트워크 요청 없음).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning) {
      return
    }

    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])

  return { activeJob, activeJobCount: jobs.length, nowMs }
}

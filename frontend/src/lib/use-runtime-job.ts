import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelRuntimeJob,
  getRuntimeJob,
  isRuntimeJobTerminal,
  resolveRuntimeJobPollIntervalMs,
} from '@/lib/api-runtime-jobs'
import type { RuntimeJobRecord } from '@/types/runtime-job'

/**
 * 잡 진행률 폴링 훅.
 *
 * `general-tab.tsx` 의 `refetchInterval: (query) => ... : false` 패턴을 훅으로 승격한 것이다.
 * 규약 세 가지:
 * 1. 종료 상태에서는 폴링을 **멈춘다**(고정 상수 interval 금지).
 * 2. 탭이 숨겨져 있으면 폴링하지 않는다.
 * 3. 잡을 시작한 뒤 첫 스냅샷은 `setQueryData` 로 심어 첫 폴링까지의 공백을 없앤다.
 */

export const RUNTIME_JOB_QUERY_KEY = 'runtime-job'

export interface UseRuntimeJobOptions<TResult> {
  onCompleted?: (job: RuntimeJobRecord<TResult>) => void
  onFailed?: (job: RuntimeJobRecord<TResult>) => void
  onCancelled?: (job: RuntimeJobRecord<TResult>) => void
}

export interface UseRuntimeJobResult<TResult> {
  job: RuntimeJobRecord<TResult> | undefined
  isRunning: boolean
  percentage: number
  cancel: () => Promise<void>
  isCancelling: boolean
}

/** Build the shared query key for one job so every surface reads the same cache entry. */
export function runtimeJobQueryKey(jobId: string | null) {
  return [RUNTIME_JOB_QUERY_KEY, jobId] as const
}

/** Track one job until it reaches a terminal state. `jobId === null` 이면 비활성. */
export function useRuntimeJob<TResult = unknown>(
  jobId: string | null,
  options: UseRuntimeJobOptions<TResult> = {},
): UseRuntimeJobResult<TResult> {
  const queryClient = useQueryClient()
  const [idlePollCount, setIdlePollCount] = useState(0)
  const lastProcessedRef = useRef<number | null>(null)
  const settledJobIdRef = useRef<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const jobQuery = useQuery({
    queryKey: runtimeJobQueryKey(jobId),
    queryFn: () => getRuntimeJob<TResult>(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      if (isRuntimeJobTerminal(query.state.data?.status)) {
        return false
      }
      // 백그라운드 탭까지 폴링하면 잡 하나가 열린 탭 수만큼 요청을 곱한다.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return false
      }
      return resolveRuntimeJobPollIntervalMs(idlePollCount)
    },
  })

  const job = jobQuery.data

  // 진행률이 움직이면 간격을 되돌리고, 조용하면 늘린다. 고정 상수 폴링을 쓰지 않는 이유다.
  useEffect(() => {
    if (!job) {
      return
    }

    if (lastProcessedRef.current !== job.progress.processed) {
      lastProcessedRef.current = job.progress.processed
      setIdlePollCount(0)
      return
    }

    setIdlePollCount((current) => Math.min(current + 1, 64))
  }, [job])

  useEffect(() => {
    settledJobIdRef.current = null
    lastProcessedRef.current = null
    setIdlePollCount(0)
  }, [jobId])

  // 종료 콜백은 잡당 정확히 한 번만 호출한다. 폴링이 종료 상태를 여러 번 읽어도 중복되지 않는다.
  useEffect(() => {
    if (!job || !isRuntimeJobTerminal(job.status) || settledJobIdRef.current === job.jobId) {
      return
    }

    settledJobIdRef.current = job.jobId
    if (job.status === 'completed') {
      optionsRef.current.onCompleted?.(job)
    } else if (job.status === 'cancelled') {
      optionsRef.current.onCancelled?.(job)
    } else {
      optionsRef.current.onFailed?.(job)
    }
  }, [job])

  const cancelMutation = useMutation({
    mutationFn: () => cancelRuntimeJob(jobId as string),
    onSuccess: (cancelled) => {
      queryClient.setQueryData(runtimeJobQueryKey(cancelled.jobId), cancelled)
    },
  })

  const cancel = useCallback(async () => {
    if (!jobId) {
      return
    }
    await cancelMutation.mutateAsync()
  }, [cancelMutation, jobId])

  return {
    job,
    isRunning: job !== undefined && !isRuntimeJobTerminal(job.status),
    percentage: job?.progress.percentage ?? 0,
    cancel,
    isCancelling: cancelMutation.isPending,
  }
}

export interface UseRuntimeJobActionResult<TResult> extends UseRuntimeJobResult<TResult> {
  run: () => Promise<void>
  isStarting: boolean
}

/**
 * 202 응답 → 잡 추적을 한 번에 다루는 래퍼. 버튼 하나짜리 UI 용.
 * 시작 응답을 캐시에 심어 두므로 첫 렌더부터 진행률이 보인다.
 */
export function useRuntimeJobAction<TResult = unknown>(
  start: () => Promise<RuntimeJobRecord<TResult>>,
  options: UseRuntimeJobOptions<TResult> & { onStartError?: (error: unknown) => void } = {},
): UseRuntimeJobActionResult<TResult> {
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const tracked = useRuntimeJob<TResult>(jobId, options)

  const startMutation = useMutation({
    mutationFn: start,
    onSuccess: (job) => {
      queryClient.setQueryData(runtimeJobQueryKey(job.jobId), job)
      setJobId(job.jobId)
    },
    onError: (error) => {
      options.onStartError?.(error)
    },
  })

  const run = useCallback(async () => {
    await startMutation.mutateAsync().catch(() => undefined)
  }, [startMutation])

  return {
    ...tracked,
    run,
    isStarting: startMutation.isPending,
  }
}

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import type { QueueJobEventPayload, RuntimeEventEnvelope } from '@/lib/runtime-events-types'

/**
 * 런타임 이벤트 → react-query 캐시 반영 브리지.
 *
 * 전략은 하이브리드다.
 * 1차: `setQueryData` 로 알고 있는 필드만 즉시 패치해 체감 지연을 없앤다.
 * 2차: 디바운스 `invalidateQueries` 로 서버 파생 필드(`queue_position`, `estimated_*`,
 *      히스토리 `total`/후처리 가시성)를 정합화한다. 이 값들을 클라이언트에서 재현하면
 *      로직이 이중화되고 서버와 어긋난다.
 */

const QUEUE_INVALIDATE_DEBOUNCE_MS = 400
const HISTORY_INVALIDATE_DEBOUNCE_MS = 700
const GRAPH_INVALIDATE_DEBOUNCE_MS = 500

const QUEUE_QUERY_KEY_PREFIX = 'image-generation-queue'
const HISTORY_QUERY_KEY_PREFIX = 'image-generation-history'
const GRAPH_SCHEDULE_QUERY_KEY_PREFIX = 'graph-workflow-schedules'
const GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX = 'module-graph-browse-content'

type QueueListResponse = { success: boolean; records: GenerationQueueJobRecord[]; total: number }

const TERMINAL_QUEUE_EVENT_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/** Patch one cached queue record in place from an event payload. */
function patchQueueRecord(record: GenerationQueueJobRecord, payload: QueueJobEventPayload): GenerationQueueJobRecord {
  return {
    ...record,
    status: payload.status,
    cancel_requested: payload.cancel_requested ? 1 : 0,
    cancel_requested_at: payload.cancel_requested_at,
    cancel_origin: (payload.cancel_origin as GenerationQueueJobRecord['cancel_origin']) ?? null,
    provider_submit_state: (payload.provider_submit_state as GenerationQueueJobRecord['provider_submit_state']) ?? record.provider_submit_state,
    provider_submit_started_at: payload.provider_submit_started_at,
    provider_cancel_state: payload.provider_cancel_state,
    submit_attempt_count: payload.submit_attempt_count ?? record.submit_attempt_count,
    provider_job_id: payload.provider_job_id,
    assigned_server_id: payload.assigned_server_id,
    started_at: payload.started_at,
    completed_at: payload.completed_at,
    failure_code: payload.failure_code,
  }
}

/**
 * Apply one queue event to every cached queue list.
 * 헤더 위젯 캐시는 active 상태만 담으므로 터미널 전이는 행을 제거한다.
 */
function applyQueueEventToCaches(queryClient: QueryClient, payload: QueueJobEventPayload) {
  const caches = queryClient.getQueriesData<QueueListResponse>({ queryKey: [QUEUE_QUERY_KEY_PREFIX] })

  caches.forEach(([queryKey, cached]) => {
    if (!cached?.records) {
      return
    }

    const matchedIndex = cached.records.findIndex((record) => record.id === payload.job_id)
    if (matchedIndex < 0) {
      return
    }

    if (TERMINAL_QUEUE_EVENT_STATUSES.has(payload.status)) {
      const nextRecords = cached.records.filter((record) => record.id !== payload.job_id)
      queryClient.setQueryData<QueueListResponse>(queryKey, {
        ...cached,
        records: nextRecords,
        total: Math.max(0, cached.total - 1),
      })
      return
    }

    const nextRecords = [...cached.records]
    nextRecords[matchedIndex] = patchQueueRecord(nextRecords[matchedIndex], payload)
    queryClient.setQueryData<QueueListResponse>(queryKey, { ...cached, records: nextRecords })
  })
}

/**
 * Bridge runtime events into the query cache.
 * 이벤트 폭주(대량 enqueue)에서도 invalidate 는 디바운스로 한 번만 나간다.
 */
export function useRuntimeEventQueryBridge() {
  const queryClient = useQueryClient()
  const debounceTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const scheduleInvalidate = useCallback((prefixes: string[], delayMs: number) => {
    prefixes.forEach((prefix) => {
      const timers = debounceTimersRef.current
      const pending = timers.get(prefix)
      if (pending) {
        clearTimeout(pending)
      }

      timers.set(prefix, setTimeout(() => {
        timers.delete(prefix)
        void queryClient.invalidateQueries({ queryKey: [prefix], refetchType: 'active' })
      }, delayMs))
    })
  }, [queryClient])

  useEffect(() => {
    const timers = debounceTimersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const applyEnvelope = useCallback((envelope: RuntimeEventEnvelope) => {
    switch (envelope.name) {
      case 'queue.job.status':
      case 'queue.job.cancel-requested': {
        applyQueueEventToCaches(queryClient, envelope.payload as QueueJobEventPayload)
        scheduleInvalidate([QUEUE_QUERY_KEY_PREFIX], QUEUE_INVALIDATE_DEBOUNCE_MS)
        // 큐 전이는 히스토리 행 상태도 함께 바꾼다.
        scheduleInvalidate([HISTORY_QUERY_KEY_PREFIX], HISTORY_INVALIDATE_DEBOUNCE_MS)
        return
      }
      case 'queue.job.created': {
        // 신규 행의 전체 필드(대기 순번/ETA)를 모르므로 패치 없이 무효화만 한다.
        scheduleInvalidate([QUEUE_QUERY_KEY_PREFIX], QUEUE_INVALIDATE_DEBOUNCE_MS)
        return
      }
      case 'history.record.created':
      case 'history.record.status': {
        // infinite query 라 부분 패치가 위험하다. 무효화로만 정합을 맞춘다.
        scheduleInvalidate([HISTORY_QUERY_KEY_PREFIX], HISTORY_INVALIDATE_DEBOUNCE_MS)
        return
      }
      case 'graph.schedule.changed': {
        scheduleInvalidate(
          [GRAPH_SCHEDULE_QUERY_KEY_PREFIX, GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX],
          GRAPH_INVALIDATE_DEBOUNCE_MS,
        )
        return
      }
      case 'graph.execution.status': {
        scheduleInvalidate([GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX], GRAPH_INVALIDATE_DEBOUNCE_MS)
        return
      }
      default:
        return
    }
  }, [queryClient, scheduleInvalidate])

  /** 스트림 공백 구간(재연결/reset) 보정: 이 채널이 다루는 모든 표면을 1회 무효화한다. */
  const resyncAll = useCallback(() => {
    [
      QUEUE_QUERY_KEY_PREFIX,
      HISTORY_QUERY_KEY_PREFIX,
      GRAPH_SCHEDULE_QUERY_KEY_PREFIX,
      GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX,
    ].forEach((prefix) => {
      void queryClient.invalidateQueries({ queryKey: [prefix], refetchType: 'active' })
    })
  }, [queryClient])

  const invalidateAuthStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['auth-status'] })
  }, [queryClient])

  return useMemo(
    () => ({ applyEnvelope, resyncAll, invalidateAuthStatus }),
    [applyEnvelope, resyncAll, invalidateAuthStatus],
  )
}

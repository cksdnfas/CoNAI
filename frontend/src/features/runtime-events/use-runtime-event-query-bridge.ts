import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import type { QueueJobEventPayload, QueueJobProgressEventPayload, RuntimeEventEnvelope, RuntimeJobHintPayload } from '@/lib/runtime-events-types'
import { RUNTIME_JOB_QUERY_KEY } from '@/lib/use-runtime-job'

/**
 * 런타임 이벤트 → react-query 캐시 반영 브리지.
 *
 * 전략은 하이브리드다.
 * 1차: `setQueryData` 로 알고 있는 필드만 즉시 패치해 체감 지연을 없앤다.
 * 2차: 디바운스 `invalidateQueries` 로 서버 파생 필드(`queue_position`, `estimated_*`,
 *      히스토리 `total`/후처리 가시성)를 정합화한다. 이 값들을 클라이언트에서 재현하면
 *      로직이 이중화되고 서버와 어긋난다.
 *
 * **무효화 예산(QLIST-3)**: 상태 자체는 1차 패치가 즉시 반영하므로, 2차 무효화는 느려도 된다.
 * 큐가 활성인 동안 초당 수 건의 전이 이벤트가 나오는데, 디바운스가 짧으면 접속자 수 × 이벤트 수
 * 만큼 서버 재조회가 몰린다. 그래서 큐/히스토리 디바운스를 2초로 올리고, 이벤트가 끊이지 않아
 * 트레일링 디바운스가 굶는 상황을 막기 위해 최대 대기 상한을 둔다.
 */

const QUEUE_INVALIDATE_DEBOUNCE_MS = 2_000
const HISTORY_INVALIDATE_DEBOUNCE_MS = 2_000
const GRAPH_INVALIDATE_DEBOUNCE_MS = 500
/**
 * 첫 무효화 요청 이후 실제 무효화까지 허용하는 최대 지연.
 * 이벤트가 디바운스 창보다 촘촘히 들어와도 이 시간 안에는 반드시 한 번 나간다(수용 기준 ②: 3초 내 반영).
 */
const INVALIDATE_MAX_WAIT_MS = 2_500

const QUEUE_QUERY_KEY_PREFIX = 'image-generation-queue'
const HISTORY_QUERY_KEY_PREFIX = 'image-generation-history'
const GRAPH_SCHEDULE_QUERY_KEY_PREFIX = 'graph-workflow-schedules'
const GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX = 'module-graph-browse-content'
/** WF-2: 예약 탭이 browse-content 대신 전용 경량 스냅샷을 폴링하므로 그 표면도 함께 무효화한다. */
const GRAPH_RESERVATION_QUERY_KEY_PREFIX = 'graph-workflow-reservations'

type QueueListResponse = { success: boolean; records: GenerationQueueJobRecord[]; total: number }

type PendingInvalidation = { timer: ReturnType<typeof setTimeout>; firstRequestedAt: number }

const TERMINAL_QUEUE_EVENT_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/**
 * 큐 이벤트가 히스토리 표면까지 흔드는지 판정한다.
 *
 * 히스토리의 정본은 `history.record.*` 이벤트다. 다만 히스토리 목록은 연결된 큐 잡의
 * `queue_status`/`queue_cancel_requested` 컬럼도 함께 읽고(재실행 가능 판정·취소 배지),
 * `queued -> cancelled` 확정 경로(`GenerationQueueService.requestCancellation` CR-2)는
 * 히스토리 행을 쓰지 않아 `history.record.*` 이벤트가 발행되지 않는다.
 * 그래서 **terminal 전이와 취소 요청만** 히스토리 무효화를 유지하고,
 * `queued -> dispatching -> running` 진행 전이는 히스토리를 건드리지 않는다
 * (그 전이들은 실행기가 히스토리 행을 `processing` 으로 쓰면서 자체 이벤트를 발행한다).
 */
function affectsHistorySurface(payload: QueueJobEventPayload) {
  return TERMINAL_QUEUE_EVENT_STATUSES.has(payload.status) || payload.cancel_requested === true
}

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

/** Apply a high-frequency progress sample directly; no queue-list refetch is needed. */
function applyQueueProgressEventToCaches(queryClient: QueryClient, payload: QueueJobProgressEventPayload) {
  const caches = queryClient.getQueriesData<QueueListResponse>({ queryKey: [QUEUE_QUERY_KEY_PREFIX] })

  caches.forEach(([queryKey, cached]) => {
    if (!cached?.records) {
      return
    }

    const matchedIndex = cached.records.findIndex((record) => record.id === payload.job_id)
    if (matchedIndex < 0) {
      return
    }

    const nextRecords = [...cached.records]
    nextRecords[matchedIndex] = {
      ...nextRecords[matchedIndex],
      // A prompt-filtered ComfyUI progress frame is itself proof that upstream execution started.
      status: 'running',
      provider_job_id: payload.provider_job_id ?? nextRecords[matchedIndex].provider_job_id,
      live_progress: {
        source: payload.source,
        phase: payload.phase,
        node_id: payload.node_id,
        node_label: payload.node_label,
        value: payload.value,
        max: payload.max,
        percent: payload.percent,
        updated_at: payload.updated_at,
      },
    }
    queryClient.setQueryData<QueueListResponse>(queryKey, { ...cached, records: nextRecords })
  })
}

/**
 * Bridge runtime events into the query cache.
 * 이벤트 폭주(대량 enqueue)에서도 invalidate 는 디바운스로 한 번만 나간다.
 */
export function useRuntimeEventQueryBridge() {
  const queryClient = useQueryClient()
  const debounceTimersRef = useRef(new Map<string, PendingInvalidation>())

  /**
   * Debounce one invalidation per query-key prefix, with a hard max-wait ceiling.
   * 상한이 없으면 대량 enqueue 처럼 이벤트가 끊이지 않는 구간에서 트레일링 디바운스가 영원히 밀린다.
   */
  const scheduleInvalidate = useCallback((prefixes: string[], delayMs: number) => {
    prefixes.forEach((prefix) => {
      const timers = debounceTimersRef.current
      const now = Date.now()
      const pending = timers.get(prefix)
      const firstRequestedAt = pending?.firstRequestedAt ?? now
      if (pending) {
        clearTimeout(pending.timer)
      }

      const remainingMaxWaitMs = Math.max(0, firstRequestedAt + INVALIDATE_MAX_WAIT_MS - now)
      const timer = setTimeout(() => {
        timers.delete(prefix)
        void queryClient.invalidateQueries({ queryKey: [prefix], refetchType: 'active' })
      }, Math.min(delayMs, remainingMaxWaitMs))

      timers.set(prefix, { timer, firstRequestedAt })
    })
  }, [queryClient])

  useEffect(() => {
    const timers = debounceTimersRef.current
    return () => {
      timers.forEach((pending) => clearTimeout(pending.timer))
      timers.clear()
    }
  }, [])

  const applyEnvelope = useCallback((envelope: RuntimeEventEnvelope) => {
    switch (envelope.name) {
      case 'queue.job.status':
      case 'queue.job.cancel-requested': {
        const queuePayload = envelope.payload as QueueJobEventPayload
        applyQueueEventToCaches(queryClient, queuePayload)
        scheduleInvalidate([QUEUE_QUERY_KEY_PREFIX], QUEUE_INVALIDATE_DEBOUNCE_MS)
        if (affectsHistorySurface(queuePayload)) {
          scheduleInvalidate([HISTORY_QUERY_KEY_PREFIX], HISTORY_INVALIDATE_DEBOUNCE_MS)
        }
        return
      }
      case 'queue.job.created': {
        // 신규 행의 전체 필드(대기 순번/ETA)를 모르므로 패치 없이 무효화만 한다.
        scheduleInvalidate([QUEUE_QUERY_KEY_PREFIX], QUEUE_INVALIDATE_DEBOUNCE_MS)
        return
      }
      case 'queue.job.progress': {
        const progressPayload = envelope.payload as QueueJobProgressEventPayload
        applyQueueProgressEventToCaches(queryClient, progressPayload)
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
          [GRAPH_SCHEDULE_QUERY_KEY_PREFIX, GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX, GRAPH_RESERVATION_QUERY_KEY_PREFIX],
          GRAPH_INVALIDATE_DEBOUNCE_MS,
        )
        return
      }
      case 'graph.execution.status': {
        scheduleInvalidate(
          [GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX, GRAPH_RESERVATION_QUERY_KEY_PREFIX],
          GRAPH_INVALIDATE_DEBOUNCE_MS,
        )
        return
      }
      case 'job.status': {
        // 힌트에는 진행률 수치가 없다(정본은 `GET /api/jobs/:jobId`). 해당 잡 쿼리만 무효화한다.
        const payload = envelope.payload as RuntimeJobHintPayload
        void queryClient.invalidateQueries({
          queryKey: [RUNTIME_JOB_QUERY_KEY, payload.job_id],
          refetchType: 'active',
        })
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
      GRAPH_RESERVATION_QUERY_KEY_PREFIX,
      RUNTIME_JOB_QUERY_KEY,
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

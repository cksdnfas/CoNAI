import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import type { ChatGenerationFinishedEventPayload, ChatGenerationUpdatedEventPayload, GraphExecutionEventPayload, GraphExecutionProgressEventPayload, HistoryRecordEventPayload, QueueJobEventPayload, QueueJobProgressEventPayload, RuntimeEventEnvelope, RuntimeJobHintPayload } from '@/lib/runtime-events-types'
import { refreshChatGenerationQueries, refreshRuntimeQueryKeys, type ChatGenerationRefresh } from './chat-generation-query-updates'
import { AUDIO_QUERY_KEY } from '@/lib/api-audio'
import { CHAT_ROUTINES_QUERY_KEY } from '@/lib/api-chat-routines'
import { PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { POSTS_QUERY_KEY, invalidatePostScopes } from '@/lib/api-posts'
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
const HISTORY_INVALIDATE_DEBOUNCE_MS = 200
const GRAPH_INVALIDATE_DEBOUNCE_MS = 500
/**
 * 진행률 패치 코얼레싱 창. 진행률 반영은 잡별 최신 샘플만 의미가 있으므로,
 * 이벤트 빈도와 무관하게 캐시 순회·구독자 알림을 초당 최대 10회로 상한한다.
 */
const PROGRESS_APPLY_COALESCE_MS = 100
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
const GRAPH_EXECUTION_PROGRESS_QUERY_KEY_PREFIX = 'module-graph-execution-progress'
const PLUGINS_QUERY_KEY_PREFIX = PLUGINS_QUERY_KEY[0]
const CHAT_ROUTINES_QUERY_KEY_PREFIX = CHAT_ROUTINES_QUERY_KEY[0]

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

/**
 * Apply buffered high-frequency progress samples in one pass; no queue-list refetch is needed.
 *
 * `getQueriesData` 는 클라이언트의 전체 쿼리 캐시를 순회한다(갤러리/그룹 페이지는 수백 엔트리).
 * 이벤트당 1회 순회하는 대신, 코얼레싱 창 동안 모인 잡별 최신 샘플을 **한 번의 순회**로 반영한다.
 */
function applyQueueProgressEventsToCaches(queryClient: QueryClient, payloads: QueueJobProgressEventPayload[]) {
  const caches = queryClient.getQueriesData<QueueListResponse>({ queryKey: [QUEUE_QUERY_KEY_PREFIX] })

  caches.forEach(([queryKey, cached]) => {
    if (!cached?.records) {
      return
    }

    let nextRecords: GenerationQueueJobRecord[] | null = null
    for (const payload of payloads) {
      const records = nextRecords ?? cached.records
      const matchedIndex = records.findIndex((record) => record.id === payload.job_id)
      if (matchedIndex < 0) {
        continue
      }

      if (!nextRecords) {
        nextRecords = [...cached.records]
      }
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
    }

    if (nextRecords) {
      queryClient.setQueryData<QueueListResponse>(queryKey, { ...cached, records: nextRecords })
    }
  })
}

/**
 * Bridge runtime events into the query cache.
 * 이벤트 폭주(대량 enqueue)에서도 invalidate 는 디바운스로 한 번만 나간다.
 */
export function useRuntimeEventQueryBridge() {
  const queryClient = useQueryClient()
  const debounceTimersRef = useRef(new Map<string, PendingInvalidation>())
  const pendingProgressByJobIdRef = useRef(new Map<number, QueueJobProgressEventPayload>())
  const progressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPostChangesRef = useRef(new Map<number, string>())
  const pendingAudioScopesRef = useRef(new Map<string, string>())
  const pendingGraphProgressIdsRef = useRef(new Set<number>())
  const pendingGenerationRef = useRef(new Map<string, ChatGenerationRefresh>())

  const flushGeneration = useCallback(() => {
    const pending = [...pendingGenerationRef.current.values()]
    pendingGenerationRef.current.clear()
    if (pending.length) void refreshChatGenerationQueries(queryClient, pending)
  }, [queryClient])

  const flushPendingProgress = useCallback(() => {
    progressFlushTimerRef.current = null
    const payloads = [...pendingProgressByJobIdRef.current.values()]
    pendingProgressByJobIdRef.current.clear()
    if (payloads.length > 0) {
      applyQueueProgressEventsToCaches(queryClient, payloads)
    }
  }, [queryClient])

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
        if (prefix === 'chat-generation-refresh') {
          flushGeneration()
          return
        }
        const changes = prefix === POSTS_QUERY_KEY ? new Map(pendingPostChangesRef.current) : null
        if (changes) pendingPostChangesRef.current.clear()
        const audioScopes = prefix === AUDIO_QUERY_KEY ? new Map(pendingAudioScopesRef.current) : null
        if (audioScopes) pendingAudioScopesRef.current.clear()
        const progressIds = prefix === GRAPH_EXECUTION_PROGRESS_QUERY_KEY_PREFIX ? new Set(pendingGraphProgressIdsRef.current) : null
        if (progressIds) pendingGraphProgressIdsRef.current.clear()
        if (changes?.size) {
          void invalidatePostScopes(queryClient, changes)
          return
        }
        void queryClient.invalidateQueries({ queryKey: [prefix], refetchType: 'active', predicate: ({ queryKey, state }) => {
          // Dedicated job snapshots are refreshed by the coalesced generation batch, not twice via this prefix.
          if (prefix === HISTORY_QUERY_KEY_PREFIX && queryKey[1] === 'codex-chat-job') return false
          if (progressIds) return !progressIds.size || progressIds.has(Number(queryKey[1]))
          if (audioScopes?.size && !audioScopes.has('*')) {
            const kind = queryKey[1]
            if (kind === 'candidate') return audioScopes.has(String((state.data as { group_id?: string } | undefined)?.group_id))
            if (kind === 'projects' || (kind === 'groups' && queryKey[2] === 'search')) return true
            if (kind === 'groups' || kind === 'folders') return [...audioScopes.values()].includes(String(queryKey[2]))
            if (['group', 'orders', 'candidates', 'chat-pending', 'comments'].includes(String(kind))) return audioScopes.has(String(queryKey[2]))
            return false
          }
          return true
        } })
      }, Math.min(delayMs, remainingMaxWaitMs))

      timers.set(prefix, { timer, firstRequestedAt })
    })
  }, [queryClient, flushGeneration])

  const scheduleGeneration = useCallback((entry: ChatGenerationRefresh) => {
    pendingGenerationRef.current.set(JSON.stringify(entry), entry)
    // Bound memory even when a burst spans many unrelated jobs.
    if (pendingGenerationRef.current.size >= 256) flushGeneration()
    scheduleInvalidate(['chat-generation-refresh'], HISTORY_INVALIDATE_DEBOUNCE_MS)
  }, [flushGeneration, scheduleInvalidate])

  const scheduleAudioInvalidate = useCallback((payload: QueueJobEventPayload) => {
    // Old servers have no scope field: retain their broad refresh until reconnecting to a current server.
    if (payload.audio_scopes?.length === 0) return
    if (payload.audio_scopes === undefined) pendingAudioScopesRef.current.set('*', '*')
    for (const scope of payload.audio_scopes ?? []) pendingAudioScopesRef.current.set(scope.group_id, scope.project_id)
    scheduleInvalidate([AUDIO_QUERY_KEY], QUEUE_INVALIDATE_DEBOUNCE_MS)
  }, [scheduleInvalidate])

  useEffect(() => {
    const timers = debounceTimersRef.current
    const pendingProgress = pendingProgressByJobIdRef.current
    const pendingGeneration = pendingGenerationRef.current
    return () => {
      timers.forEach((pending) => clearTimeout(pending.timer))
      timers.clear()
      if (progressFlushTimerRef.current) {
        clearTimeout(progressFlushTimerRef.current)
        progressFlushTimerRef.current = null
      }
      pendingProgress.clear()
      pendingGeneration.clear()
    }
  }, [])

  const applyEnvelope = useCallback((envelope: RuntimeEventEnvelope) => {
    switch (envelope.name) {
      case 'queue.job.status':
      case 'queue.job.cancel-requested': {
        const queuePayload = envelope.payload as QueueJobEventPayload
        if (TERMINAL_QUEUE_EVENT_STATUSES.has(queuePayload.status)) {
          // 종료된 잡의 대기 중 진행률 샘플이 나중에 flush 되어도 행이 이미 없어 no-op 이지만, 버퍼는 미리 비운다.
          pendingProgressByJobIdRef.current.delete(queuePayload.job_id)
        }
        applyQueueEventToCaches(queryClient, queuePayload)
        scheduleInvalidate([QUEUE_QUERY_KEY_PREFIX], QUEUE_INVALIDATE_DEBOUNCE_MS)
        scheduleAudioInvalidate(queuePayload)
        if (affectsHistorySurface(queuePayload)) {
          scheduleGeneration({ jobId: queuePayload.job_id })
          scheduleInvalidate([HISTORY_QUERY_KEY_PREFIX], HISTORY_INVALIDATE_DEBOUNCE_MS)
        }
        return
      }
      case 'queue.job.created': {
        // 신규 행의 전체 필드(대기 순번/ETA)를 모르므로 패치 없이 무효화만 한다.
        scheduleInvalidate([QUEUE_QUERY_KEY_PREFIX], QUEUE_INVALIDATE_DEBOUNCE_MS)
        scheduleAudioInvalidate(envelope.payload as QueueJobEventPayload)
        return
      }
      case 'queue.job.progress': {
        const progressPayload = envelope.payload as QueueJobProgressEventPayload
        pendingProgressByJobIdRef.current.set(progressPayload.job_id, progressPayload)
        if (!progressFlushTimerRef.current) {
          progressFlushTimerRef.current = setTimeout(flushPendingProgress, PROGRESS_APPLY_COALESCE_MS)
        }
        return
      }
      case 'history.record.created':
      case 'history.record.status': {
        const history = envelope.payload as HistoryRecordEventPayload
        scheduleGeneration({ historyId: history.history_id, jobId: history.queue_job_id, compositeHash: history.composite_hash })
        scheduleInvalidate([HISTORY_QUERY_KEY_PREFIX], HISTORY_INVALIDATE_DEBOUNCE_MS)
        return
      }
      case 'chat.generation.updated': {
        const result = envelope.payload as ChatGenerationUpdatedEventPayload
        scheduleGeneration({ threadId: result.threadId, jobId: result.jobId, historyId: result.historyId, compositeHash: result.compositeHash })
        return
      }
      case 'chat.generation.finished': {
        const result = envelope.payload as ChatGenerationFinishedEventPayload
        scheduleGeneration({ threadId: result.chat.threadId, jobId: result.jobId, historyId: result.thumbnailHistoryId })
        return
      }
      case 'chat.task.updated': {
        const { threadId } = envelope.payload as { threadId: number }
        void refreshRuntimeQueryKeys(queryClient, [
          ['codex-chat-threads'], ['codex-chat-task', threadId], ['codex-chat-thread', threadId],
        ])
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
        const execution = envelope.payload as GraphExecutionEventPayload
        for (const queryKey of [
          ['module-graph-executions', execution.graph_workflow_id],
          ['module-graph-execution-detail', execution.execution_id],
          ['module-graph-execution-status', execution.execution_id],
          [GRAPH_EXECUTION_PROGRESS_QUERY_KEY_PREFIX, execution.execution_id],
        ]) void queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
        scheduleInvalidate(
          [GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX, GRAPH_RESERVATION_QUERY_KEY_PREFIX],
          GRAPH_INVALIDATE_DEBOUNCE_MS,
        )
        return
      }
      case 'graph.execution.progress': {
        // 노드 시작/완료가 몰려도 바뀐 실행의 진행 카드만 디바운스로 한 번 다시 읽는다.
        pendingGraphProgressIdsRef.current.add((envelope.payload as GraphExecutionProgressEventPayload).execution_id)
        scheduleInvalidate([GRAPH_EXECUTION_PROGRESS_QUERY_KEY_PREFIX], GRAPH_INVALIDATE_DEBOUNCE_MS)
        return
      }
      case 'posts.changed': {
        const { postId, kind } = envelope.payload as { postId: number; kind: string }
        const changes = pendingPostChangesRef.current
        const id = Number.isSafeInteger(postId) && postId > 0 ? postId : 0
        const previous = changes.get(id)
        // Mixed kinds must preserve both scopes, regardless of arrival order; run-only batches stay narrow.
        changes.set(id, previous !== undefined && previous !== kind ? 'post' : kind)
        scheduleInvalidate([POSTS_QUERY_KEY], 400)
        return
      }
      case 'audio.changed': {
        const { group_id, project_id } = envelope.payload as { group_id: string; project_id: string }
        pendingAudioScopesRef.current.set(group_id, project_id)
        scheduleInvalidate([AUDIO_QUERY_KEY], 400)
        return
      }
      case 'files.changed': {
        scheduleInvalidate(['file-store'], 400)
        return
      }
      case 'workspace.changed': {
        const { projectId } = envelope.payload as { projectId: string }
        if (/^[a-f0-9]{32}$/.test(projectId)) void queryClient.invalidateQueries({ queryKey: ['workspaces', projectId], refetchType: 'active' })
        void queryClient.invalidateQueries({ queryKey: ['workspaces', 'list'], refetchType: 'active' })
        return
      }
      case 'plugin.draft.changed': {
        const { draftId } = envelope.payload as { draftId: string }
        if (/^[a-f0-9]{32}$/.test(draftId)) void queryClient.invalidateQueries({ queryKey: ['plugin-draft', draftId], refetchType: 'active' })
        scheduleInvalidate(['plugin-drafts'], 200)
        return
      }
      case 'plugin.server.changed': {
        scheduleInvalidate([PLUGINS_QUERY_KEY_PREFIX], 200)
        return
      }
      case 'chat.routine.changed': {
        scheduleInvalidate([CHAT_ROUTINES_QUERY_KEY_PREFIX], 200)
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
  }, [flushPendingProgress, queryClient, scheduleInvalidate, scheduleAudioInvalidate, scheduleGeneration])

  /** 스트림 공백 구간(재연결/reset) 보정: 이 채널이 다루는 모든 표면을 1회 무효화한다. */
  const resyncAll = useCallback(async () => {
    const prefixes = new Set<unknown>([
      QUEUE_QUERY_KEY_PREFIX,
      AUDIO_QUERY_KEY,
      HISTORY_QUERY_KEY_PREFIX,
      'image-detail',
      'codex-chat-history',
      'codex-chat-thread',
      'codex-chat-task',
      'codex-chat-threads',
      'codex-chat-media',
      GRAPH_SCHEDULE_QUERY_KEY_PREFIX,
      GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX,
      GRAPH_RESERVATION_QUERY_KEY_PREFIX,
      RUNTIME_JOB_QUERY_KEY,
      'module-graph-executions',
      'module-graph-execution-detail',
      'module-graph-execution-status',
      GRAPH_EXECUTION_PROGRESS_QUERY_KEY_PREFIX,
      POSTS_QUERY_KEY,
      PLUGINS_QUERY_KEY_PREFIX,
      CHAT_ROUTINES_QUERY_KEY_PREFIX,
      'workspaces',
      'file-store',
      'workspace-binding',
    ])
    // Cancel only observed initial reads: imperative fetchQuery/prefetch callers must keep their promises.
    await queryClient.cancelQueries({
      predicate: query => prefixes.has(query.queryKey[0]) && query.isActive()
        && query.state.fetchStatus === 'fetching' && query.state.data === undefined,
    })
    // One cache-wide match avoids repeated scans and overlapping parent/child invalidations.
    await queryClient.invalidateQueries({
      predicate: query => prefixes.has(query.queryKey[0]),
      refetchType: 'active',
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

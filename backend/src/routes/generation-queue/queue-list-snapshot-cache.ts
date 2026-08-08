import { subscribeToRuntimeEvents } from '../../services/runtime-events/runtimeEventBus'

/**
 * 큐 목록 스냅샷의 TTL 공유 캐시.
 *
 * 30명이 3초 주기로 폴링해도 목록 계산(카운트 + 목록 + ETA 윈도우 + 완료 샘플 + 활성 서버 +
 * `loadSettings` 까지 7~10 쿼리)은 TTL 당 1회만 돈다.
 *
 * **권한 분리 규칙(이 스트림 최대 리스크)**
 * - 캐시 값은 **권한 중립 데이터만** 담는다. 요청자에 따라 달라지는 필드(`is_mine`)는
 *   스냅샷을 읽은 **뒤** 호출부가 얹는다.
 * - 요청자 계정이 결과 집합 자체를 좁히는 `mine=true` 는 "요청자 권한 차원"이 아니라
 *   **필터 값**이므로 키에 포함한다. 서로 다른 계정은 서로 다른 키를 쓰므로 스냅샷을
 *   공유하지 않는다. 반대로 필터가 같으면(=전체 큐 조회) 응답 본문도 요청자와 무관하다.
 * - admin 여부는 이 목록의 어떤 필터에도 관여하지 않는다(`buildQueueListFilters` 참고).
 *   따라서 키에 admin 차원이 존재할 이유가 없다.
 */

/** 유휴 상태 재계산 주기. 클라이언트 폴링(3초)보다 짧게 유지한다. */
export const QUEUE_LIST_SNAPSHOT_TTL_MS = 1_500
/**
 * 잡 상태 전이 후 스냅샷이 살아 있을 수 있는 최대 시간.
 * 무효화를 "즉시 삭제"가 아니라 "만료 시각 당김"으로 처리해, 대량 enqueue 같은 이벤트 폭주에서도
 * 재계산이 이 간격보다 잦아지지 않게 한다.
 */
export const QUEUE_LIST_SNAPSHOT_INVALIDATION_GRACE_MS = 300
const QUEUE_LIST_SNAPSHOT_MAX_ENTRIES = 64

type QueueListSnapshotCacheEntry = {
  expiresAt: number
  snapshot: unknown
}

export type QueueListSnapshotCacheKeyInput = {
  statuses?: readonly string[]
  serviceType?: string
  workflowId?: number
  /** `mine=true` 스코프 필터. undefined 면 계정 필터 없음(전체 큐). */
  requesterAccountId?: number
  limit: number
  offset: number
}

export type QueueListSnapshotCacheStats = {
  hits: number
  misses: number
  computations: number
  invalidations: number
  entries: number
  ttl_ms: number
}

const snapshots = new Map<string, QueueListSnapshotCacheEntry>()
let stats = { hits: 0, misses: 0, computations: 0, invalidations: 0 }
let invalidationSubscribed = false

/**
 * Build the cache key for one queue list request.
 *
 * 필터/페이지 차원만 사용한다. 요청자별 표시 필드는 절대 키에 들어가지 않는다.
 */
export function buildQueueListSnapshotCacheKey(input: QueueListSnapshotCacheKeyInput): string {
  const statuses = input.statuses && input.statuses.length > 0
    ? [...input.statuses].sort().join('+')
    : '*'

  return [
    `s=${statuses}`,
    `svc=${input.serviceType ?? '*'}`,
    `wf=${input.workflowId ?? '*'}`,
    `acct=${input.requesterAccountId ?? '*'}`,
    `lim=${input.limit}`,
    `off=${input.offset}`,
  ].join('|')
}

function ensureInvalidationSubscription() {
  if (invalidationSubscribed) {
    return
  }

  invalidationSubscribed = true
  try {
    subscribeToRuntimeEvents((record) => {
      // Live progress is decorated outside this TTL cache and patched directly over SSE.
      if (record.topic === 'generation-queue' && record.name !== 'queue.job.progress') {
        invalidateQueueListSnapshots()
      }
    })
  } catch (error) {
    // 무효화 구독 실패는 신선도만 TTL 로 되돌린다. 목록 응답 자체를 깨뜨려서는 안 된다.
    invalidationSubscribed = false
    console.warn('⚠️ Failed to subscribe queue list snapshot invalidation:', error instanceof Error ? error.message : error)
  }
}

function pruneExpiredSnapshots(now: number) {
  for (const [key, entry] of snapshots) {
    if (entry.expiresAt <= now) {
      snapshots.delete(key)
    }
  }

  while (snapshots.size > QUEUE_LIST_SNAPSHOT_MAX_ENTRIES) {
    const oldestKey = snapshots.keys().next().value
    if (oldestKey === undefined) {
      return
    }

    snapshots.delete(oldestKey)
  }
}

/**
 * Read one cached queue list snapshot, computing it at most once per TTL window.
 * `compute` 는 권한 중립 스냅샷만 만들어야 한다.
 */
export function readQueueListSnapshot<T>(key: string, compute: () => T): T {
  ensureInvalidationSubscription()

  const now = Date.now()
  const cached = snapshots.get(key)
  if (cached && cached.expiresAt > now) {
    stats.hits += 1
    return cached.snapshot as T
  }

  stats.misses += 1
  stats.computations += 1
  const snapshot = compute()
  snapshots.set(key, { expiresAt: now + QUEUE_LIST_SNAPSHOT_TTL_MS, snapshot })
  pruneExpiredSnapshots(now)
  return snapshot
}

/**
 * Shorten every cached snapshot to the invalidation grace window.
 *
 * 큐 토픽 런타임 이벤트(생성/전이/취소 요청)에서 호출된다. 즉시 삭제하지 않는 이유는
 * 이벤트 폭주 구간에서 요청마다 재계산이 되살아나는 것을 막기 위해서다.
 */
export function invalidateQueueListSnapshots(): void {
  const deadline = Date.now() + QUEUE_LIST_SNAPSHOT_INVALIDATION_GRACE_MS
  for (const entry of snapshots.values()) {
    if (entry.expiresAt > deadline) {
      entry.expiresAt = deadline
    }
  }

  stats.invalidations += 1
}

/** Report cache effectiveness for diagnostics and the polling load smoke run. */
export function getQueueListSnapshotCacheStats(): QueueListSnapshotCacheStats {
  return {
    ...stats,
    entries: snapshots.size,
    ttl_ms: QUEUE_LIST_SNAPSHOT_TTL_MS,
  }
}

/** Reset cache state for contract smoke runs. Production code never calls this. */
export function resetQueueListSnapshotCacheForTests(): void {
  snapshots.clear()
  stats = { hits: 0, misses: 0, computations: 0, invalidations: 0 }
  invalidationSubscribed = false
}

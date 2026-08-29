import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import type { GenerationHistoryResponse } from '@/lib/api-image-generation-history'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import {
  canRetryHistoryQueueJob,
  getRetryableHistoryQueueJobId,
  getHistoryRunRecoveryState,
  isHistoryPostprocessPending,
  resolveHistoryDisplayStatus,
  resolveHistoryImageSource,
} from '../image-generation-shared'

export const GENERATION_HISTORY_PAGE_SIZE = 40
export const GENERATION_HISTORY_ACTIVE_REFRESH_MS = 3_000
export const GENERATION_HISTORY_POSTPROCESS_REFRESH_MS = 5_000
/**
 * SSE 가 live 여도 진행 중/후처리 대기 행이 남아 있는 동안 유지하는 워치독 리페치 간격.
 * 이벤트 전달은 보장이 없어서, 완료/ready 이벤트가 한 건이라도 유실되면 live 상태에서는
 * 복구 경로가 없다(폴링 전면 꺼짐). 첫 페이지만 재조회하므로 비용은 페이지 요청 1회/15초다.
 */
export const GENERATION_HISTORY_STREAM_WATCHDOG_REFRESH_MS = 15_000
export const GENERATION_HISTORY_REFRESH_WATCH_MS = 30_000
export const GENERATION_HISTORY_RECOVERY_ACK_STORAGE_PREFIX = 'conai:image-generation:history-recovery-ack:'

export function hasActiveGenerationHistory(records: GenerationHistoryResponse['records']) {
  return records.some((record) => {
    const displayStatus = resolveHistoryDisplayStatus(record)
    if (displayStatus === 'failed' || isHistoryPostprocessPending(record)) {
      return false
    }

    return displayStatus === 'pending' || displayStatus === 'processing'
  })
}

export function hasPostprocessPendingHistory(records: GenerationHistoryResponse['records']) {
  return records.some(isHistoryPostprocessPending)
}

export function getGenerationHistorySelectionId(record: GenerationHistoryResponse['records'][number]) {
  return `generation-history-${record.id}`
}

export function dedupeHistoryRecords(records: GenerationHistoryResponse['records']) {
  const seenIds = new Set<number>()
  return records.filter((record) => {
    if (seenIds.has(record.id)) {
      return false
    }

    seenIds.add(record.id)
    return true
  })
}

/**
 * Read one already-cached history page for a stored page param.
 *
 * QLIST-4: 활성 리프레시(폴링/SSE 무효화)는 로드된 전 페이지를 다시 읽는 대신 첫 페이지만
 * 서버에서 가져온다. 나머지 페이지는 이 함수가 캐시 사본을 그대로 돌려주므로 요청이 나가지 않는다.
 */
export function readCachedHistoryPage(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  pageParam: number,
): GenerationHistoryResponse | undefined {
  const cached = queryClient.getQueryData<InfiniteData<GenerationHistoryResponse, number>>(queryKey)
  if (!cached) {
    return undefined
  }

  const pageIndex = cached.pageParams.findIndex((param) => param === pageParam)
  return pageIndex >= 0 ? cached.pages[pageIndex] : undefined
}

/**
 * Decide whether cached later pages still line up after the first page was refetched.
 *
 * 첫 페이지의 경계(행 수 + 마지막 행 id)가 그대로면 뒤 페이지의 offset 의미도 그대로다.
 * 신규 행이 끼어들어 경계가 밀리면 캐시 재사용을 포기하고 전 페이지를 다시 읽어야 행이 사라지지 않는다.
 */
export function hasStableHistoryPageBoundary(
  previousFirstPage: GenerationHistoryResponse | undefined,
  nextFirstPage: GenerationHistoryResponse,
) {
  if (!previousFirstPage) {
    return false
  }

  if (previousFirstPage.records.length !== nextFirstPage.records.length) {
    return false
  }

  const previousLastId = previousFirstPage.records[previousFirstPage.records.length - 1]?.id ?? null
  const nextLastId = nextFirstPage.records[nextFirstPage.records.length - 1]?.id ?? null
  return previousLastId === nextLastId
}

export function readAcknowledgedRecoveryIds(storageKey: string) {
  if (typeof window === 'undefined') {
    return new Set<number>()
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) {
      return new Set<number>()
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return new Set<number>()
    }

    return new Set(parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))
  } catch {
    return new Set<number>()
  }
}

export function writeAcknowledgedRecoveryIds(storageKey: string, ids: ReadonlySet<number>) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify([...ids]))
  } catch {
    // Session-only hint; failure should not block history recovery actions.
  }
}

export type HistoryRecordStatusSummary = {
  inFlight: number
  completed: number
  failed: number
  cleanupFailed: number
  cancellation: number
}

export function getHistoryRecordStatusSummary(records: GenerationHistoryResponse['records']): HistoryRecordStatusSummary {
  const summary: HistoryRecordStatusSummary = {
    inFlight: 0,
    completed: 0,
    failed: 0,
    cleanupFailed: 0,
    cancellation: 0,
  }

  for (const record of records) {
    const displayStatus = resolveHistoryDisplayStatus(record)
    if (record.generation_status === 'failed') {
      summary.cleanupFailed += 1
    }

    if (displayStatus === 'pending' || displayStatus === 'processing') {
      summary.inFlight += 1
    } else if (displayStatus === 'completed') {
      summary.completed += 1
    } else if (displayStatus === 'failed') {
      summary.failed += 1
    }

    if ((record.queue_cancel_requested ?? 0) > 0) {
      summary.cancellation += 1
    }
  }

  return summary
}

export function getHistoryMediaVersion(record: GenerationHistoryResponse['records'][number]) {
  return [
    record.actual_composite_hash ?? record.composite_hash ?? '',
    record.result_file_status ?? '',
    record.actual_width ?? record.width ?? '',
    record.actual_height ?? record.height ?? '',
    resolveHistoryDisplayStatus(record),
  ].join(':')
}

export function mapHistoryRecordToImageRecord(record: GenerationHistoryResponse['records'][number]): ImageRecord {
  const imageSource = resolveHistoryImageSource(record)
  const displayStatus = resolveHistoryDisplayStatus(record)
  const hasLinkedImage = Boolean(record.actual_composite_hash)
  const historyMediaBaseUrl = `/api/generation-history/${record.id}`
  const historyMediaVersion = encodeURIComponent(getHistoryMediaVersion(record))

  return {
    id: `generation-history-${record.id}`,
    composite_hash: hasLinkedImage ? imageSource.compositeHash : null,
    original_file_path: record.actual_file_name ?? null,
    thumbnail_url: hasLinkedImage ? `${historyMediaBaseUrl}/thumbnail?v=${historyMediaVersion}` : null,
    image_url: hasLinkedImage ? `${historyMediaBaseUrl}/file?v=${historyMediaVersion}` : null,
    detail_url: hasLinkedImage ? `${historyMediaBaseUrl}/image` : null,
    detail_scope_key: `generation-history:${record.id}`,
    generation_history_id: record.id,
    mime_type: record.actual_mime_type ?? null,
    width: record.actual_width ?? null,
    height: record.actual_height ?? null,
    rating_score: record.rating_score ?? null,
    is_processing: displayStatus === 'pending' || displayStatus === 'processing',
    preview_status: displayStatus === 'failed'
      ? 'failed'
      : displayStatus === 'pending' || displayStatus === 'processing'
        ? 'processing'
        : undefined,
  }
}

export function isHistoryRecordDownloadReady(record: GenerationHistoryResponse['records'][number]) {
  return resolveHistoryDisplayStatus(record) === 'completed' && Boolean(record.actual_composite_hash)
}

export function collectRetryableHistoryRecords(records: readonly GenerationHistoryRecord[]) {
  return records.filter(canRetryHistoryQueueJob)
}

export function getRetryableHistoryQueueJobIds(records: readonly GenerationHistoryRecord[]) {
  return records
    .map(getRetryableHistoryQueueJobId)
    .filter((queueJobId): queueJobId is number => queueJobId !== null)
}

export function getHistoryRecoveryLabel(record: GenerationHistoryRecord, t: ReturnType<typeof useI18n>['t']) {
  switch (getHistoryRunRecoveryState(record)) {
    case 'retryable-cancelled':
      return t({ ko: '취소됨 · 재실행 가능', en: 'Canceled · rerun ready' })
    case 'retryable-failed':
      return t({ ko: '실패 · 재시도 가능', en: 'Failed · retry ready' })
    case 'completed':
      return t({ ko: '완료 · 결과 확인', en: 'Complete · inspect result' })
    case 'active':
      return t({ ko: '진행 중', en: 'In progress' })
    default:
      return t({ ko: '실패 · 수동 확인', en: 'Failed · check manually' })
  }
}

export function getHistoryRecoveryDetail(record: GenerationHistoryRecord, t: ReturnType<typeof useI18n>['t']) {
  const trimmedError = record.error_message?.trim()
  switch (getHistoryRunRecoveryState(record)) {
    case 'retryable-cancelled':
      return trimmedError || t({ ko: '같은 입력으로 재실행 대기 중', en: 'Ready to rerun with the same inputs' })
    case 'retryable-failed':
      return trimmedError || t({ ko: '같은 입력으로 재시도 대기 중', en: 'Ready to retry with the same inputs' })
    case 'completed':
      return t({ ko: '결과 확인 가능', en: 'Result ready to inspect' })
    case 'active':
      return t({ ko: '큐 또는 후처리 진행 중', en: 'Queue or post-processing in progress' })
    default:
      return trimmedError || t({ ko: '재실행 가능한 큐 기록 없음', en: 'No retryable linked queue record' })
  }
}

import type { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import type { GenerationHistoryResponse } from '@/lib/api-image-generation-history'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import {
  getHistoryRunRecoveryState,
  isHistoryPostprocessPending,
  resolveHistoryDisplayStatus,
  resolveHistoryImageSource,
} from '../image-generation-shared'

export const GENERATION_HISTORY_PAGE_SIZE = 40
export const GENERATION_HISTORY_ACTIVE_REFRESH_MS = 1_500
export const GENERATION_HISTORY_POSTPROCESS_REFRESH_MS = 5_000
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
    original_file_path: null,
    thumbnail_url: hasLinkedImage ? `${historyMediaBaseUrl}/thumbnail?v=${historyMediaVersion}` : null,
    image_url: hasLinkedImage ? `${historyMediaBaseUrl}/file?v=${historyMediaVersion}` : null,
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

import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'

/** Resolve hash-first history image routes from the main image DB only. */
export function resolveHistoryImageSource(record: GenerationHistoryRecord) {
  const compositeHash = record.actual_composite_hash || null

  return {
    compositeHash,
    detailHref: compositeHash ? `/images/${compositeHash}` : null,
    thumbnailUrl: compositeHash ? `/api/images/${compositeHash}/thumbnail` : null,
    imageUrl: compositeHash ? `/api/images/${compositeHash}/file` : null,
  }
}

export function isHistoryPostprocessPending(record: GenerationHistoryRecord) {
  return record.generation_status === 'completed'
    && Boolean(record.composite_hash)
    && record.result_file_status === 'active'
    && !record.actual_composite_hash
}

export function isHistoryMissingLinkedResult(record: GenerationHistoryRecord) {
  return record.generation_status === 'completed'
    && !record.actual_composite_hash
    && (!record.composite_hash || record.result_file_status !== 'active')
}

/** Resolve the effective history display status for list surfaces.
 * A completed history with no result hash is terminally unrenderable, not still in-flight.
 * A completed history with a result hash but no ready main-image metadata is still waiting on postprocess visibility.
 * If the linked queue already ended in failed/cancelled without an image, prefer the terminal state.
 */
export function resolveHistoryDisplayStatus(record: GenerationHistoryRecord): GenerationHistoryRecord['generation_status'] {
  if (record.generation_status === 'failed') {
    return 'failed'
  }

  if ((record.queue_status === 'failed' || record.queue_status === 'cancelled') && !record.actual_composite_hash) {
    return 'failed'
  }

  if (record.generation_status === 'pending' || record.generation_status === 'processing') {
    return record.generation_status
  }

  if (isHistoryMissingLinkedResult(record)) {
    return 'failed'
  }

  return isHistoryPostprocessPending(record) ? 'processing' : 'completed'
}

export function getHistoryCancellationBadgeLabel(record: GenerationHistoryRecord) {
  if ((record.queue_cancel_requested ?? 0) <= 0) {
    return null
  }

  if (record.queue_status === 'cancelled') {
    return '사용자 취소'
  }

  if (record.queue_status === 'completed' || (record.generation_status === 'completed' && record.actual_composite_hash)) {
    return '취소 요청 후 완료'
  }

  if (record.queue_status === 'failed' || record.generation_status === 'failed') {
    return '취소 요청 후 종료'
  }

  return '취소 요청됨'
}

export function getHistoryCancellationDetail(record: GenerationHistoryRecord) {
  const badgeLabel = getHistoryCancellationBadgeLabel(record)
  if (!badgeLabel) {
    return null
  }

  if (badgeLabel === '사용자 취소') {
    return '사용자 취소로 정리된 기록이야.'
  }

  if (badgeLabel === '취소 요청 후 완료') {
    return '취소 요청은 들어갔지만 업스트림 작업이 먼저 끝났어.'
  }

  if (badgeLabel === '취소 요청 후 종료') {
    return record.error_message && record.error_message.trim().length > 0
      ? record.error_message.trim()
      : '취소 요청 뒤에 작업이 종료됐어.'
  }

  return '취소 요청이 들어간 상태야.'
}

export type HistoryRunRecoveryState = 'active' | 'completed' | 'retryable-failed' | 'retryable-cancelled' | 'failed-no-retry'

/** Queue replay is only exposed when the backend has a failed/cancelled queue job id to clone. */
export function getRetryableHistoryQueueJobId(record: GenerationHistoryRecord) {
  return typeof record.queue_job_id === 'number'
    && record.queue_job_id > 0
    && (record.queue_status === 'failed' || record.queue_status === 'cancelled')
    ? record.queue_job_id
    : null
}

export function canRetryHistoryQueueJob(record: GenerationHistoryRecord) {
  return getRetryableHistoryQueueJobId(record) !== null
}

/** Classify the next operator action for a history row without inventing unsupported replay paths. */
export function getHistoryRunRecoveryState(record: GenerationHistoryRecord): HistoryRunRecoveryState {
  if (canRetryHistoryQueueJob(record)) {
    return record.queue_status === 'cancelled' ? 'retryable-cancelled' : 'retryable-failed'
  }

  const displayStatus = resolveHistoryDisplayStatus(record)
  if (displayStatus === 'completed') {
    return 'completed'
  }

  if (displayStatus === 'pending' || displayStatus === 'processing') {
    return 'active'
  }

  return 'failed-no-retry'
}

/** Resolve a compact label for the history status badge. */
export function getHistoryStatusLabel(status: GenerationHistoryRecord['generation_status'], record?: GenerationHistoryRecord) {
  if (record && isHistoryMissingLinkedResult(record)) return '결과 없음'
  if (record && isHistoryPostprocessPending(record)) return '후처리 중'
  if (status === 'completed') return '완료'
  if (status === 'failed') return '생성 실패'
  if (status === 'processing') return '작업 중'
  return '대기 중'
}

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
    && (record.postprocess_status === 'pending' || !record.actual_composite_hash)
}

/** A run that saved sounds and no picture: its result is the sounds. */
export function hasHistoryAudioResult(record: GenerationHistoryRecord) {
  return !record.actual_composite_hash && (record.audio_results?.length ?? 0) > 0
}

export function isHistoryMissingLinkedResult(record: GenerationHistoryRecord) {
  return record.generation_status === 'completed'
    && !record.actual_composite_hash
    && !hasHistoryAudioResult(record)
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

  if ((record.queue_status === 'failed' || record.queue_status === 'cancelled') && !record.actual_composite_hash && !hasHistoryAudioResult(record)) {
    return 'failed'
  }

  if (record.generation_status === 'pending' || record.generation_status === 'processing') {
    return record.generation_status
  }

  if (isHistoryMissingLinkedResult(record)) {
    return 'failed'
  }

  return record.actual_composite_hash || hasHistoryAudioResult(record) ? 'completed' : 'processing'
}

export type HistoryRunRecoveryState = 'active' | 'completed' | 'retryable-failed' | 'retryable-cancelled' | 'failed-no-retry'

/** Queue replay is only exposed when the backend has a failed/cancelled queue job id to clone. */
export function getRetryableHistoryQueueJobId(record: GenerationHistoryRecord) {
  if (record.workflow_deleted === true || record.workflow_deleted === 1) {
    return null
  }
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

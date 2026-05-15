import type { TranslationInput, TranslationParams } from '@/i18n'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'

type Translate = (input: TranslationInput, params?: TranslationParams) => string
type FormatNumber = (value: number) => string

type GenerationQueueHeaderQuerySnapshot<TRecord = GenerationQueueJobRecord> = {
  records?: readonly TRecord[] | null
  isPending: boolean
  isError: boolean
  error?: unknown
}

export function getGenerationQueueHeaderQuerySnapshot<TRecord>({
  isFilteredQueueView,
  globalQueue,
  filteredQueue,
}: {
  isFilteredQueueView: boolean
  globalQueue: GenerationQueueHeaderQuerySnapshot<TRecord>
  filteredQueue: GenerationQueueHeaderQuerySnapshot<TRecord>
}) {
  return isFilteredQueueView ? filteredQueue : globalQueue
}

/** Render the shared localized status label for queue rows and widgets. */
export function getGenerationQueueStatusLabel(record: GenerationQueueJobRecord, t: Translate) {
  if (record.cancel_requested > 0 && record.status === 'completed') {
    return t('image-generation.components.generation.queue.ui.completed.after.cancel.request')
  }

  if (record.cancel_requested > 0 && record.status === 'failed') {
    return t('image-generation.components.generation.queue.ui.failed.after.cancel.request')
  }

  switch (record.status) {
    case 'queued':
      return t('image-generation.components.generation.queue.ui.queued')
    case 'dispatching':
      return t('image-generation.components.generation.queue.ui.submitting')
    case 'running':
      return t('image-generation.components.generation.queue.ui.running')
    case 'completed':
      return t('image-generation.components.generation.queue.ui.completed')
    case 'failed':
      return t('image-generation.components.generation.queue.ui.failed')
    case 'cancelled':
      return t('image-generation.components.generation.queue.ui.canceled')
    default:
      return record.status
  }
}

/** Convert raw ETA seconds into a short Korean duration label. */
function formatGenerationQueueEtaSeconds(value: number | null | undefined, t: Translate, formatNumber: FormatNumber) {
  if (value === undefined || value === null || value < 0) {
    return null
  }

  if (value < 60) {
    return t('image-generation.components.generation.queue.ui.values', { seconds: formatNumber(Math.max(1, Math.round(value))) })
  }

  const minutes = Math.round(value / 60)
  if (minutes < 60) {
    return t('image-generation.components.generation.queue.ui.valuemin', { minutes: formatNumber(minutes) })
  }

  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0
    ? t('image-generation.components.generation.queue.ui.valuetime.valuemin', { hours: formatNumber(hours), minutes: formatNumber(remainMinutes) })
    : t('image-generation.components.generation.queue.ui.valuetime', { hours: formatNumber(hours) })
}

function parseQueueTimestampMs(value?: string | null) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

/** Render the short workflow label for one queue entry. */
export function getGenerationQueueWorkflowLabel(record: GenerationQueueJobRecord, t: Translate) {
  if (record.workflow_name && record.workflow_name.trim().length > 0) {
    return record.workflow_name.trim()
  }

  if (record.service_type === 'novelai') {
    return t('image-generation.components.generation.queue.ui.nai.generation.job')
  }

  if (record.service_type === 'codex') {
    return t('image-generation.components.generation.queue.ui.codex.job.value', { id: record.id })
  }

  return t('image-generation.components.generation.queue.ui.comfyui.job.value', { id: record.id })
}

/** Render the creator label for one queue entry. */
export function getGenerationQueueRequesterLabel(record: GenerationQueueJobRecord, t: Translate) {
  if (record.requested_by_username && record.requested_by_username.trim().length > 0) {
    return record.requested_by_username.trim()
  }

  if (record.requested_by_account_type === 'admin') {
    return t('image-generation.components.generation.queue.ui.admin')
  }

  if (record.requested_by_account_id != null) {
    return t('image-generation.components.generation.queue.ui.account.value', { id: record.requested_by_account_id })
  }

  return t('image-generation.components.generation.queue.ui.unknown')
}

/** Render the short remaining-time label used beside the progress gauge. */
export function getGenerationQueueRemainingLabel(record: GenerationQueueJobRecord, t: Translate, formatNumber: FormatNumber) {
  return formatGenerationQueueEtaSeconds(record.estimated_total_seconds, t, formatNumber)
}

/** Render progress only for jobs that actually started upstream execution. */
export function getGenerationQueueProgressPercent(record: GenerationQueueJobRecord, nowMs = Date.now()) {
  if (record.status !== 'running') {
    return null
  }

  const durationSeconds = record.estimated_duration_seconds
  if (durationSeconds == null || durationSeconds <= 0) {
    return record.estimated_total_seconds === 0 ? 100 : null
  }

  const startedAtMs = parseQueueTimestampMs(record.started_at)
  const elapsedSeconds = startedAtMs == null ? 0 : Math.max(0, (nowMs - startedAtMs) / 1000)
  const percent = Math.round((elapsedSeconds / durationSeconds) * 100)
  if ((record.estimated_total_seconds ?? 0) <= 0) {
    return 100
  }
  return Math.max(0, Math.min(percent, 99))
}

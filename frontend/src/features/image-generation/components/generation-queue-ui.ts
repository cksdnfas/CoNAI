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
type GenerationQueueHeaderRefreshTarget = 'globalQueue' | 'filteredQueue' | 'reservationSchedules' | 'reservationWorkflows'

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

export function shouldEnableFilteredQueueHeaderQuery({
  hasGenerationPermission,
  isFilteredQueueView,
  isOpen,
}: {
  hasGenerationPermission: boolean
  isFilteredQueueView: boolean
  isOpen: boolean
}) {
  // The filtered queue is popup-only; keep the global active query as the only closed-header poller.
  return hasGenerationPermission && isFilteredQueueView && isOpen
}

export function getGenerationQueueHeaderRefreshTargets({
  activeTab,
  isFilteredQueueQueryEnabled,
}: {
  activeTab: 'jobs' | 'reservations'
  isFilteredQueueQueryEnabled: boolean
}): GenerationQueueHeaderRefreshTarget[] {
  const targets: GenerationQueueHeaderRefreshTarget[] = ['globalQueue']

  if (isFilteredQueueQueryEnabled) {
    targets.push('filteredQueue')
  }

  if (activeTab === 'reservations') {
    targets.push('reservationSchedules', 'reservationWorkflows')
  }

  return targets
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

function formatGenerationQueueElapsedSeconds(value: number, t: Translate, formatNumber: FormatNumber) {
  if (!Number.isFinite(value) || value < 0) {
    return null
  }

  if (value < 60) {
    return t('image-generation.components.generation.queue.ui.values', { seconds: formatNumber(Math.max(1, Math.round(value))) })
  }

  const minutes = Math.floor(value / 60)
  if (minutes < 60) {
    return t('image-generation.components.generation.queue.ui.valuemin', { minutes: formatNumber(Math.max(1, minutes)) })
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

function formatQueueStartClock(value: string | null | undefined, locale: string) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
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

/** Render the queue lane and position so operators can see where a job is waiting. */
export function getGenerationQueueLaneLabel(record: GenerationQueueJobRecord, t: Translate, formatNumber: FormatNumber) {
  const position = record.queue_position
  if (position === undefined || position === null || position <= 0) {
    return null
  }

  const positionLabel = t({ ko: '큐 {position}', en: 'Queue {position}' }, { position: formatNumber(position) })

  if (record.queue_position_scope === 'server' && record.queue_position_server_id != null) {
    return t({ ko: '서버 {serverId} · {positionLabel}', en: 'Server {serverId} · {positionLabel}' }, {
      serverId: formatNumber(record.queue_position_server_id),
      positionLabel,
    })
  }

  if (record.queue_position_scope === 'tag' && record.queue_position_server_tag) {
    return t({ ko: '#{serverTag} · {positionLabel}', en: '#{serverTag} · {positionLabel}' }, {
      serverTag: record.queue_position_server_tag,
      positionLabel,
    })
  }

  if (record.queue_position_scope === 'auto') {
    return t({ ko: '자동 · {positionLabel}', en: 'Auto · {positionLabel}' }, { positionLabel })
  }

  return positionLabel
}

/** Render queued wait time separately from total remaining time. */
export function getGenerationQueueWaitLabel(record: GenerationQueueJobRecord, t: Translate, formatNumber: FormatNumber) {
  if (record.status === 'running') {
    return null
  }

  const waitLabel = formatGenerationQueueEtaSeconds(record.estimated_wait_seconds, t, formatNumber)
  if (!waitLabel) {
    return null
  }

  return record.estimated_wait_seconds === 0
    ? t({ ko: '곧 시작', en: 'Starts soon' })
    : t({ ko: '대기 {waitLabel}', en: 'Wait {waitLabel}' }, { waitLabel })
}

/** Render the estimated start clock so throttled queued jobs do not look stalled. */
export function getGenerationQueueStartLabel(record: GenerationQueueJobRecord, t: Translate, locale: string) {
  if (record.status === 'running') {
    return null
  }

  const startClock = formatQueueStartClock(record.estimated_start_at, locale)
  if (!startClock) {
    return null
  }

  return t({ ko: '시작 {startClock}', en: 'Start {startClock}' }, { startClock })
}

/** Render the median duration estimate that backs queue wait/remaining labels. */
export function getGenerationQueueDurationLabel(record: GenerationQueueJobRecord, t: Translate, formatNumber: FormatNumber) {
  const durationLabel = formatGenerationQueueEtaSeconds(record.estimated_duration_seconds, t, formatNumber)
  if (!durationLabel) {
    return null
  }

  return t({ ko: '예상 {durationLabel}', en: 'Estimate {durationLabel}' }, { durationLabel })
}

/** Render active job age beside the compact queue timestamp. */
export function getGenerationQueueElapsedLabel(record: GenerationQueueJobRecord, t: Translate, formatNumber: FormatNumber, nowMs = Date.now()) {
  const anchorValue = record.status === 'running' ? record.started_at : record.queued_at
  const anchorMs = parseQueueTimestampMs(anchorValue)
  if (anchorMs == null || anchorMs > nowMs) {
    return null
  }

  const elapsedLabel = formatGenerationQueueElapsedSeconds((nowMs - anchorMs) / 1000, t, formatNumber)
  if (!elapsedLabel) {
    return null
  }

  if (record.status === 'running') {
    return t({ ko: '실행 {elapsedLabel}', en: 'Running {elapsedLabel}' }, { elapsedLabel })
  }

  if (record.status === 'dispatching') {
    return t({ ko: '전송 {elapsedLabel}', en: 'Dispatching {elapsedLabel}' }, { elapsedLabel })
  }

  return t({ ko: '대기 {elapsedLabel}', en: 'Queued {elapsedLabel}' }, { elapsedLabel })
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

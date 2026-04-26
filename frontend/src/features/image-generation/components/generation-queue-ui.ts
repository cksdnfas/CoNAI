import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'

/** Render the shared Korean status label for queue rows and widgets. */
export function getGenerationQueueStatusLabel(record: GenerationQueueJobRecord) {
  if (record.cancel_requested > 0 && record.status === 'completed') {
    return '취소 요청 후 완료'
  }

  if (record.cancel_requested > 0 && record.status === 'failed') {
    return '취소 요청 후 실패'
  }

  switch (record.status) {
    case 'queued':
      return '대기 중'
    case 'dispatching':
      return '전송 중'
    case 'running':
      return '실행 중'
    case 'completed':
      return '완료'
    case 'failed':
      return '실패'
    case 'cancelled':
      return '취소됨'
    default:
      return record.status
  }
}

/** Convert raw ETA seconds into a short Korean duration label. */
export function formatGenerationQueueEtaSeconds(value?: number | null) {
  if (value === undefined || value === null || value < 0) {
    return null
  }

  if (value < 60) {
    return `${Math.max(1, Math.round(value))}초`
  }

  const minutes = Math.round(value / 60)
  if (minutes < 60) {
    return `${minutes}분`
  }

  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${hours}시간 ${remainMinutes}분` : `${hours}시간`
}

function parseQueueTimestampMs(value?: string | null) {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

/** Render the short workflow label for one queue entry. */
export function getGenerationQueueWorkflowLabel(record: GenerationQueueJobRecord) {
  if (record.workflow_name && record.workflow_name.trim().length > 0) {
    return record.workflow_name.trim()
  }

  if (record.service_type === 'novelai') {
    return 'NAI 생성 작업'
  }

  if (record.service_type === 'codex') {
    return `Codex 작업 #${record.id}`
  }

  return `ComfyUI 작업 #${record.id}`
}

/** Render the creator label for one queue entry. */
export function getGenerationQueueRequesterLabel(record: GenerationQueueJobRecord) {
  if (record.requested_by_username && record.requested_by_username.trim().length > 0) {
    return record.requested_by_username.trim()
  }

  if (record.requested_by_account_type === 'admin') {
    return '관리자'
  }

  if (record.requested_by_account_id != null) {
    return `계정 #${record.requested_by_account_id}`
  }

  return '알 수 없음'
}

/** Render the short remaining-time label used beside the progress gauge. */
export function getGenerationQueueRemainingLabel(record: GenerationQueueJobRecord) {
  return formatGenerationQueueEtaSeconds(record.estimated_total_seconds)
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

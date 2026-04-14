import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'

/** Check whether a queue record is still in the active lifecycle. */
export function isActiveGenerationQueueStatus(status: GenerationQueueJobRecord['status']) {
  return status === 'queued' || status === 'dispatching' || status === 'running'
}

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

/** Format queue timestamps with the compact Korean date-time style used in the UI. */
export function formatGenerationQueueTimestamp(value?: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
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

/** Render the shared queue lane and position label for active jobs. */
export function getGenerationQueuePositionLabel(record: GenerationQueueJobRecord) {
  if (record.queue_position == null || (record.status !== 'queued' && record.status !== 'dispatching')) {
    return null
  }

  if (record.queue_position_scope === 'server') {
    const serverId = record.queue_position_server_id ?? record.requested_server_id ?? record.assigned_server_id ?? null
    return serverId != null ? `서버 ${serverId} 대기열 ${record.queue_position}` : `서버 대기열 ${record.queue_position}`
  }

  if (record.queue_position_scope === 'tag') {
    const serverTag = record.queue_position_server_tag ?? record.requested_server_tag ?? null
    return serverTag ? `태그 #${serverTag} 대기열 ${record.queue_position}` : `태그 대기열 ${record.queue_position}`
  }

  if (record.queue_position_scope === 'auto') {
    return `자동 분산 ${record.queue_position}`
  }

  return `대기열 ${record.queue_position}`
}

/** Render the shared wait or remaining-time copy for queue surfaces. */
export function getGenerationQueueEtaLabel(record: GenerationQueueJobRecord) {
  if (record.status === 'running') {
    const remaining = formatGenerationQueueEtaSeconds(record.estimated_total_seconds)
    return remaining ? `남은 시간 약 ${remaining}` : null
  }

  if (record.status === 'queued' || record.status === 'dispatching') {
    const totalEta = formatGenerationQueueEtaSeconds(record.estimated_total_seconds)
    return totalEta ? `완료까지 약 ${totalEta}` : null
  }

  return null
}

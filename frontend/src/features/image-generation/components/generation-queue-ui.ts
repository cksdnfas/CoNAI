import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'

function parseQueueDebugPayload(record: GenerationQueueJobRecord) {
  try {
    const parsed = JSON.parse(record.request_payload) as { _debug?: Record<string, unknown> }
    return parsed?._debug && typeof parsed._debug === 'object' && !Array.isArray(parsed._debug)
      ? parsed._debug
      : null
  } catch {
    return null
  }
}

export function getGenerationQueueCancellationMeta(record: GenerationQueueJobRecord) {
  const debug = parseQueueDebugPayload(record)
  const cancellationResult = debug?.cancellation_result
  const normalizedResult = cancellationResult && typeof cancellationResult === 'object' && !Array.isArray(cancellationResult)
    ? cancellationResult as {
        matchedRunning?: boolean
        matchedPending?: boolean
        interrupted?: boolean
        deleted?: boolean
      }
    : null

  return {
    state: typeof debug?.cancellation_state === 'string' ? debug.cancellation_state : null,
    error: typeof debug?.cancellation_error === 'string' ? debug.cancellation_error : null,
    requestedAt: typeof debug?.cancellation_requested_at === 'string' ? debug.cancellation_requested_at : null,
    result: normalizedResult,
  }
}

export function getGenerationQueueCancellationDetail(record: GenerationQueueJobRecord) {
  if (record.cancel_requested <= 0) {
    return null
  }

  const meta = getGenerationQueueCancellationMeta(record)
  switch (meta.state) {
    case 'pre_submit':
      return '아직 업스트림 prompt가 만들어지기 전이라 큐 단계에서 바로 정리했어.'
    case 'requested':
      if (meta.result?.deleted && meta.result?.interrupted) {
        return 'ComfyUI 대기열 삭제와 실행 중단을 둘 다 시도했어.'
      }
      if (meta.result?.deleted) {
        return 'ComfyUI 대기열에서 제거를 시도했어.'
      }
      if (meta.result?.interrupted) {
        return 'ComfyUI 실행 중단을 시도했어.'
      }
      return '가능한 업스트림 취소 경로로 중단을 시도했어.'
    case 'not_found':
      return '취소 시점엔 업스트림 작업이 이미 끝났거나 찾을 수 없었어.'
    case 'missing_prompt_id':
      return '아직 업스트림 prompt id가 없어서 큐 취소만 먼저 기록했어.'
    case 'missing_endpoint':
      return '업스트림 endpoint를 못 찾아서 큐 취소만 기록했어.'
    case 'error':
      return meta.error ? `업스트림 취소 시도 중 오류가 있었어: ${meta.error}` : '업스트림 취소 시도 중 오류가 있었어.'
    default:
      if (record.status === 'completed') {
        return '취소 요청은 들어갔지만 작업이 먼저 끝났어.'
      }
      if (record.status === 'failed') {
        return '취소 요청 기록은 남았고, 최종 종료 상태는 실패야.'
      }
      if (record.status === 'cancelled') {
        return '사용자 취소로 정리된 작업이야.'
      }
      return '취소 요청을 기록했고 업스트림 정리 가능 여부를 확인 중이야.'
  }
}

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

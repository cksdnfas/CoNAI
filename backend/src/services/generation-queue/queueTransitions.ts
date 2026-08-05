import type {
  GenerationQueueJobListRecord,
  GenerationQueueJobStatus,
  GenerationQueueJobUpdateData,
  GenerationQueueProviderSubmitState,
} from '../../types/generationQueue'

export const ALLOWED_QUEUE_TRANSITIONS: Record<GenerationQueueJobStatus, GenerationQueueJobStatus[]> = {
  queued: ['dispatching', 'cancelled', 'failed'],
  dispatching: ['queued', 'running', 'cancelled', 'failed'],
  running: ['completed', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

/** DB CHECK 가 없는 축이라 코드/스키마 정합은 이 배열과 컨트랙트 스크립트로만 지킨다. */
export const QUEUE_PROVIDER_SUBMIT_STATES: GenerationQueueProviderSubmitState[] = [
  'none',
  'in_flight',
  'accepted',
  'orphan_suspected',
  'orphan_unresolved',
  'cancel_sent',
  'cancel_confirmed',
  'cancel_unsupported',
]

/** terminal 로 확정해도 상류 정리가 끝나지 않은 상태들. cancelled 전이 시 승격 대상. */
const UNRESOLVED_SUBMIT_STATES: GenerationQueueProviderSubmitState[] = ['in_flight', 'orphan_suspected']

export type QueueTransitionUpdateOptions = {
  assignedServerId?: number | null
  failureCode?: string | null
  failureMessage?: string | null
  providerJobId?: string | null
  providerSubmitState?: GenerationQueueProviderSubmitState
}

// PAYLOAD-1: 전이 계산은 상태/타임스탬프 컬럼만 쓰므로 경량 레코드로 충분하다.
export function buildQueueTransitionUpdates(
  current: GenerationQueueJobListRecord,
  nextStatus: GenerationQueueJobStatus,
  nowIso: string,
  options: QueueTransitionUpdateOptions = {},
): GenerationQueueJobUpdateData {
  const updates: GenerationQueueJobUpdateData = {
    status: nextStatus,
  }

  switch (nextStatus) {
    case 'queued':
      updates.started_at = null
      updates.completed_at = null
      updates.assigned_server_id = null
      updates.provider_job_id = null
      updates.cancel_requested = false
      updates.cancel_requested_at = null
      updates.cancel_origin = null
      updates.provider_submit_state = 'none'
      updates.provider_submit_started_at = null
      updates.provider_cancel_state = null
      updates.submit_attempt_count = 0
      updates.failure_code = null
      updates.failure_message = null
      break
    case 'dispatching':
      updates.completed_at = null
      if (options.assignedServerId !== undefined) {
        updates.assigned_server_id = options.assignedServerId
      }
      break
    case 'running':
      updates.started_at = current.started_at ?? nowIso
      updates.completed_at = null
      if (options.assignedServerId !== undefined) {
        updates.assigned_server_id = options.assignedServerId
      }
      break
    case 'completed':
      updates.completed_at = nowIso
      updates.cancel_requested = current.cancel_requested > 0
      updates.failure_code = null
      updates.failure_message = null
      break
    case 'failed':
      updates.completed_at = nowIso
      updates.cancel_requested = current.cancel_requested > 0
      updates.failure_code = options.failureCode ?? current.failure_code ?? null
      updates.failure_message = options.failureMessage ?? current.failure_message ?? null
      break
    case 'cancelled':
      updates.completed_at = nowIso
      updates.cancel_requested = true
      // 상류에 작업이 남아 있을 수 있는 채로 terminal 이 되는 경우다.
      // 상태만 확정하고 정리는 미완료로 표시해 orphan reconciler 가 이어받게 한다.
      if (UNRESOLVED_SUBMIT_STATES.includes(current.provider_submit_state ?? 'none')) {
        updates.provider_submit_state = 'orphan_unresolved'
      }
      break
  }

  if (options.providerJobId !== undefined) {
    updates.provider_job_id = options.providerJobId
  }

  if (options.providerSubmitState !== undefined) {
    updates.provider_submit_state = options.providerSubmitState
  }

  return updates
}

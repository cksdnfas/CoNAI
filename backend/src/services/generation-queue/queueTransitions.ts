import type {
  GenerationQueueJobRecord,
  GenerationQueueJobStatus,
  GenerationQueueJobUpdateData,
} from '../../types/generationQueue'

export const ALLOWED_QUEUE_TRANSITIONS: Record<GenerationQueueJobStatus, GenerationQueueJobStatus[]> = {
  queued: ['dispatching', 'cancelled', 'failed'],
  dispatching: ['queued', 'running', 'cancelled', 'failed'],
  running: ['completed', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

export type QueueTransitionUpdateOptions = {
  assignedServerId?: number | null
  failureCode?: string | null
  failureMessage?: string | null
  providerJobId?: string | null
}

export function buildQueueTransitionUpdates(
  current: GenerationQueueJobRecord,
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
      break
  }

  if (options.providerJobId !== undefined) {
    updates.provider_job_id = options.providerJobId
  }

  return updates
}

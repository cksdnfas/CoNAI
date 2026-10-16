import { getUserSettingsDb } from '../../database/userSettingsDb'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import type { GenerationQueueJobCreateData } from '../../types/generationQueue'
import type { WorkflowRecord } from '../../types/workflow'
import { publishQueueJobEvent } from '../runtime-events/runtimeEventPublishers'
import { GenerationQueueService } from '../generationQueueService'
import { buildWorkflowRoleQueueLimitMessage, checkWorkflowRoleQueueLimit, type WorkflowRoleQueueLimitState } from './queueRoleLimitPolicy'

/** The requester already holds as many active jobs on this workflow as their role allows. */
export class QueueRoleLimitError extends Error {
  constructor(readonly state: WorkflowRoleQueueLimitState) {
    super(buildWorkflowRoleQueueLimitMessage(state))
    this.name = 'QueueRoleLimitError'
  }
}

export interface EnqueueGenerationJobsOptions {
  /** Copies of the same request; with a summary, each copy's reads "(i/n)". */
  count?: number
  /** Create once per scoped key; a repeat returns the first job instead of a new one. */
  idempotency?: { scope: string; key: string; requestHash: string }
  /** The workflow whose per-role concurrent limit applies to the requesting account. */
  roleLimitWorkflow?: Pick<WorkflowRecord, 'id' | 'public_queue_role_limits'> | null
  /** Runs inside the creating transaction, so a caller's own bookkeeping commits with the jobs or not at all. */
  withinTransaction?: (created: EnqueuedGenerationJobs) => void
}

export interface EnqueuedGenerationJobs {
  jobIds: number[]
  /** An idempotent repeat: the existing job was returned and nothing new was queued. */
  reused: boolean
  requestHash: string | null
}

/**
 * The one way a generation job enters the queue. The role limit is checked in the same transaction that creates the
 * rows, so concurrent requests cannot both slip under it; every new job is announced and the dispatcher woken.
 */
export function enqueueGenerationJobs(data: GenerationQueueJobCreateData, options: EnqueueGenerationJobsOptions = {}): EnqueuedGenerationJobs {
  const count = Math.max(1, Math.floor(options.count ?? 1))
  if (options.idempotency && count > 1) throw new Error('An idempotent enqueue creates exactly one job.')

  const created = getUserSettingsDb().transaction((): EnqueuedGenerationJobs => {
    const { idempotency } = options
    const existing = idempotency ? GenerationQueueModel.findIdempotentJob(idempotency.scope, idempotency.key) : null
    if (!existing && options.roleLimitWorkflow) {
      const violation = checkWorkflowRoleQueueLimit({
        workflow: options.roleLimitWorkflow,
        accountId: data.requested_by_account_id ?? null,
        accountType: data.requested_by_account_type ?? null,
        requestedCount: count,
      })
      if (violation) throw new QueueRoleLimitError(violation)
    }

    let result: EnqueuedGenerationJobs
    if (idempotency) {
      const claimed = GenerationQueueModel.createIdempotent(data, idempotency)
      result = { jobIds: [claimed.jobId], reused: claimed.reused, requestHash: claimed.requestHash }
    } else {
      const summary = data.request_summary ?? null
      const jobIds = GenerationQueueModel.createMany(Array.from({ length: count }, (_, index) => (
        count > 1 && summary ? { ...data, request_summary: `${summary} (${index + 1}/${count})` } : data
      )))
      result = { jobIds, reused: false, requestHash: null }
    }
    options.withinTransaction?.(result)
    return result
  }).immediate()

  if (!created.reused) {
    for (const jobId of created.jobIds) publishQueueJobEvent('queue.job.created', GenerationQueueModel.findListRecordById(jobId))
  }
  GenerationQueueService.requestDispatch()
  return created
}

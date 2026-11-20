import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowExecutionQueue } from './graphWorkflowExecutionQueue'

/** Shared by timed reservations, run now and the wallpaper quick-run button. */
export function parseStoredScheduleInputValues(value?: string | null) {
  if (!value) {
    return undefined
  }

  return JSON.parse(value) as Record<string, unknown>
}

export function enqueueScheduleRuns(params: {
  scheduleId: number
  workflowId: number
  inputValues?: Record<string, unknown>
  requestedCount: number
  maxRunCount?: number | null
  /** The poller's just-read count of queued, running and completed executions. */
  reservedRunCount?: number
  requestedByAccountId: number | null
}) {
  let allowedCount = Math.max(0, params.requestedCount)
  if (allowedCount > 0 && params.maxRunCount != null) {
    const reserved = params.reservedRunCount ?? GraphExecutionModel.countReservedByScheduleId(params.scheduleId)
    allowedCount = Math.min(allowedCount, Math.max(0, params.maxRunCount - reserved))
  }
  const executionIds = GraphWorkflowExecutionQueue.enqueueMany(
    params.workflowId,
    allowedCount,
    params.inputValues,
    undefined,
    false,
    { triggerType: 'schedule', scheduleId: params.scheduleId, requestedByAccountId: params.requestedByAccountId },
  ).map((result) => result.executionId)

  return {
    requested_count: params.requestedCount,
    enqueued_count: executionIds.length,
    execution_ids: executionIds,
  }
}

import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowExecutionQueue } from './graphWorkflowExecutionQueue'

/** Shared by the schedule routes (run now) and the wallpaper quick-run button. */
export function parseStoredScheduleInputValues(value?: string | null) {
  if (!value) {
    return undefined
  }

  return JSON.parse(value) as Record<string, unknown>
}

function countReservedScheduleRuns(scheduleId: number) {
  return GraphExecutionModel.countReservedByScheduleId(scheduleId)
}

function resolveAllowedScheduleEnqueueCount(scheduleId: number, requestedCount: number, maxRunCount?: number | null) {
  if (requestedCount <= 0) {
    return 0
  }

  if (maxRunCount === null || maxRunCount === undefined) {
    return requestedCount
  }

  const remainingCount = Math.max(0, maxRunCount - countReservedScheduleRuns(scheduleId))
  return Math.min(requestedCount, remainingCount)
}

export function enqueueScheduleRuns(params: {
  scheduleId: number
  workflowId: number
  inputValues?: Record<string, unknown>
  requestedCount: number
  maxRunCount?: number | null
  requestedByAccountId: number | null
}) {
  const allowedCount = resolveAllowedScheduleEnqueueCount(params.scheduleId, params.requestedCount, params.maxRunCount)
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

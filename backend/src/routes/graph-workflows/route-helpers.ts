import type { Response } from 'express'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphWorkflowFolderModel } from '../../models/GraphWorkflowFolder'
import { GraphWorkflowScheduleModel } from '../../models/GraphWorkflowSchedule'
import { parseRouteIntegerParam, sendRouteBadRequest } from '../routeValidation'
import type {
  GraphWorkflowScheduleFailurePolicy,
  GraphWorkflowScheduleStatus,
  GraphWorkflowScheduleType,
  ModuleGraphResponse,
} from '../../types/moduleGraph'

export function parseScheduleType(value: unknown): GraphWorkflowScheduleType | null {
  return value === 'once' || value === 'interval' || value === 'daily' ? value : null
}

export function parseScheduleStatus(value: unknown): GraphWorkflowScheduleStatus | null {
  return value === 'active' || value === 'paused' || value === 'error_stopped' || value === 'overlap_stopped' || value === 'completed'
    ? value
    : null
}

export function parseScheduleFailurePolicy(value: unknown): GraphWorkflowScheduleFailurePolicy | null {
  return value === 'stop' || value === 'continue' ? value : null
}

export function parseOptionalTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function parseScheduleInputValues(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseScheduleMaxRunCount(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return null
  }

  if (parsed === -1) {
    return null
  }

  return parsed > 0 ? parsed : null
}

export function parseGraphRouteInteger(value: string | string[] | undefined) {
  return parseRouteIntegerParam(value)
}

export const MAX_BULK_SCHEDULE_ENQUEUE_COUNT = 100

export function parseBoundedScheduleEnqueueCount(value: unknown, defaultValue: number, minValue: number) {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return null
  }

  return parsed >= minValue && parsed <= MAX_BULK_SCHEDULE_ENQUEUE_COUNT ? parsed : null
}

export function parseScheduleEnqueueCount(value: unknown) {
  return parseBoundedScheduleEnqueueCount(value, 0, 0)
}

export function parseScheduleRunEnqueueCount(value: unknown) {
  return parseBoundedScheduleEnqueueCount(value, 1, 1)
}

export function parseGraphExecutionInputValues(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

export function sendGraphRouteNotFound(res: Response, error: string) {
  res.status(404).json({ success: false, error } as ModuleGraphResponse)
  return null
}

export function parseRequiredGraphRouteId(
  res: Response,
  value: string | string[] | undefined,
  error: string,
) {
  const id = parseGraphRouteInteger(value)
  if (Number.isNaN(id)) {
    sendRouteBadRequest(res, error)
    return null
  }

  return id
}

export function findGraphWorkflowFolderOrRespond(
  res: Response,
  folderId: number,
  error = 'Graph workflow folder not found',
) {
  return GraphWorkflowFolderModel.findById(folderId) ?? sendGraphRouteNotFound(res, error)
}

export function findGraphWorkflowOrRespond(res: Response, workflowId: number) {
  return GraphWorkflowModel.findById(workflowId) ?? sendGraphRouteNotFound(res, 'Graph workflow not found')
}

export function findGraphWorkflowScheduleOrRespond(res: Response, scheduleId: number) {
  return GraphWorkflowScheduleModel.findById(scheduleId) ?? sendGraphRouteNotFound(res, '예약작업을 찾지 못했어.')
}

export function findScheduleWorkflowContextOrRespond(res: Response, scheduleId: number) {
  const schedule = findGraphWorkflowScheduleOrRespond(res, scheduleId)
  if (!schedule) {
    return null
  }

  const workflow = findGraphWorkflowOrRespond(res, schedule.graph_workflow_id)
  if (!workflow) {
    return null
  }

  return { schedule, workflow }
}

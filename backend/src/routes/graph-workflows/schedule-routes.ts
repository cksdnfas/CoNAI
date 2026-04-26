import { Router, type Request, type Response } from 'express'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphWorkflowFolderModel } from '../../models/GraphWorkflowFolder'
import { GraphExecutionModel } from '../../models/GraphExecution'
import { GraphWorkflowScheduleModel } from '../../models/GraphWorkflowSchedule'
import { GraphWorkflowExecutionQueue } from '../../services/graphWorkflowExecutionQueue'
import { GraphWorkflowScheduleService } from '../../services/graphWorkflowScheduleService'
import { decorateGraphWorkflowScheduleRecords } from '../../services/graphWorkflowViewService'
import { asyncHandler } from '../../middleware/errorHandler'
import { parsePositiveInteger, sendRouteBadRequest } from '../routeValidation'
import type { ModuleGraphResponse } from '../../types/moduleGraph'
import {
  findGraphWorkflowFolderOrRespond,
  findGraphWorkflowOrRespond,
  findGraphWorkflowScheduleOrRespond,
  findScheduleWorkflowContextOrRespond,
  parseOptionalTrimmedString,
  parseRequiredGraphRouteId,
  parseScheduleFailurePolicy,
  parseScheduleInputValues,
  parseScheduleMaxRunCount,
  parseScheduleStatus,
  parseScheduleType,
} from './route-helpers'

const MAX_BULK_SCHEDULE_ENQUEUE_COUNT = 100

function parseScheduleEnqueueCount(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 0
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return null
  }

  return parsed >= 0 && parsed <= MAX_BULK_SCHEDULE_ENQUEUE_COUNT ? parsed : null
}

function parseStoredScheduleInputValues(value?: string | null) {
  if (!value) {
    return undefined
  }

  return JSON.parse(value) as Record<string, unknown>
}

function countReservedScheduleRuns(scheduleId: number) {
  return GraphExecutionModel.findByScheduleIds([scheduleId], 5000).reduce((count, execution) => (
    execution.status === 'completed' || execution.status === 'queued' || execution.status === 'running'
      ? count + 1
      : count
  ), 0)
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

function enqueueScheduleRuns(params: {
  scheduleId: number
  workflowId: number
  inputValues?: Record<string, unknown>
  requestedCount: number
  maxRunCount?: number | null
}) {
  const allowedCount = resolveAllowedScheduleEnqueueCount(params.scheduleId, params.requestedCount, params.maxRunCount)
  const executionIds: number[] = []

  for (let index = 0; index < allowedCount; index += 1) {
    const result = GraphWorkflowExecutionQueue.enqueue(
      params.workflowId,
      params.inputValues,
      undefined,
      false,
      { triggerType: 'schedule', scheduleId: params.scheduleId },
    )
    executionIds.push(result.executionId)
  }

  return {
    requested_count: params.requestedCount,
    enqueued_count: executionIds.length,
    execution_ids: executionIds,
  }
}

export function createGraphWorkflowScheduleRoutes() {
  const router = Router()

  router.get('/schedules', asyncHandler(async (req: Request, res: Response) => {
    const workflowIdParam = typeof req.query.workflow_id === 'string' ? Number(req.query.workflow_id) : null
    const folderIdParam = typeof req.query.folder_id === 'string' ? Number(req.query.folder_id) : null

    try {
      if (workflowIdParam !== null && Number.isFinite(workflowIdParam)) {
        return res.json({ success: true, data: decorateGraphWorkflowScheduleRecords(GraphWorkflowScheduleModel.findByWorkflowId(workflowIdParam)) } as ModuleGraphResponse)
      }

      if (folderIdParam !== null && Number.isFinite(folderIdParam)) {
        const folder = findGraphWorkflowFolderOrRespond(res, folderIdParam)
        if (!folder) {
          return
        }

        const workflowIds = GraphWorkflowModel.findByFolderIds(GraphWorkflowFolderModel.getSubtreeFolderIds(folder.id), true).map((workflow) => workflow.id)
        return res.json({ success: true, data: decorateGraphWorkflowScheduleRecords(GraphWorkflowScheduleModel.findByWorkflowIds(workflowIds)) } as ModuleGraphResponse)
      }

      return res.json({ success: true, data: decorateGraphWorkflowScheduleRecords(GraphWorkflowScheduleModel.findAll()) } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflow schedules:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflow schedules' } as ModuleGraphResponse)
    }
  }))

  router.post('/schedules', asyncHandler(async (req: Request, res: Response) => {
    const workflowId = Number(req.body?.graph_workflow_id)
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const scheduleType = parseScheduleType(req.body?.schedule_type)
    const status = parseScheduleStatus(req.body?.status) ?? 'paused'
    const runAt = parseOptionalTrimmedString(req.body?.run_at)
    const intervalMinutes = parsePositiveInteger(req.body?.interval_minutes)
    const dailyTime = parseOptionalTrimmedString(req.body?.daily_time)
    const rawMaxRunCount = req.body?.max_run_count
    const maxRunCount = parseScheduleMaxRunCount(rawMaxRunCount)
    const failurePolicy = parseScheduleFailurePolicy(req.body?.failure_policy) ?? 'stop'
    const timezone = parseOptionalTrimmedString(req.body?.timezone)
    const inputValues = parseScheduleInputValues(req.body?.input_values)
    const enqueueCount = parseScheduleEnqueueCount(req.body?.enqueue_count)

    if (!Number.isFinite(workflowId)) {
      return sendRouteBadRequest(res, '워크플로우 ID가 필요해.')
    }

    if (!name) {
      return sendRouteBadRequest(res, '이름이 필요해.')
    }

    if (!scheduleType) {
      return sendRouteBadRequest(res, 'schedule_type은 once, interval, daily 중 하나여야 해.')
    }

    if (req.body?.failure_policy !== undefined && !parseScheduleFailurePolicy(req.body.failure_policy)) {
      return sendRouteBadRequest(res, '실패 처리 방식은 stop 또는 continue여야 해.')
    }

    const workflow = findGraphWorkflowOrRespond(res, workflowId)
    if (!workflow) {
      return
    }

    if (scheduleType === 'once' && !runAt) {
      return sendRouteBadRequest(res, '1회 실행 예약에는 실행 시각이 필요해.')
    }

    if (scheduleType === 'interval' && !intervalMinutes) {
      return sendRouteBadRequest(res, '반복 예약에는 간격(분)이 필요해.')
    }

    if (scheduleType === 'daily' && !dailyTime) {
      return sendRouteBadRequest(res, '매일 예약에는 실행 시각이 필요해.')
    }

    if (rawMaxRunCount !== undefined && rawMaxRunCount !== null && rawMaxRunCount !== '' && maxRunCount === null && Number(rawMaxRunCount) !== -1) {
      return sendRouteBadRequest(res, '최대 예약 횟수는 양의 정수 또는 -1이어야 해.')
    }

    if (enqueueCount === null) {
      return sendRouteBadRequest(res, `즉시 큐 등록 수는 0부터 ${MAX_BULK_SCHEDULE_ENQUEUE_COUNT} 사이의 정수여야 해.`)
    }

    try {
      const nextRunAt = status === 'active'
        ? GraphWorkflowScheduleService.buildInitialNextRunAt({
          scheduleType,
          runAt,
          intervalMinutes,
          dailyTime,
        })
        : null

      const scheduleId = GraphWorkflowScheduleModel.create({
        graph_workflow_id: workflow.id,
        name,
        schedule_type: scheduleType,
        status,
        timezone,
        run_at: runAt,
        interval_minutes: intervalMinutes,
        daily_time: dailyTime,
        max_run_count: maxRunCount,
        failure_policy: failurePolicy,
        input_values: inputValues,
        confirmed_graph_version: workflow.version,
        confirmed_input_signature: GraphWorkflowScheduleService.buildInputSignature(inputValues),
        next_run_at: nextRunAt,
        stop_reason_code: status === 'active' ? null : 'manual_pause',
        stop_reason_message: status === 'active' ? null : '예약작업이 일시정지 상태로 생성됐어.',
      })

      const enqueueResult = enqueueScheduleRuns({
        scheduleId,
        workflowId: workflow.id,
        inputValues: inputValues ?? undefined,
        requestedCount: enqueueCount,
        maxRunCount,
      })

      if (enqueueResult.enqueued_count > 0) {
        GraphWorkflowScheduleModel.update(scheduleId, {
          last_execution_id: enqueueResult.execution_ids.at(-1) ?? null,
          last_enqueued_at: new Date().toISOString(),
        })
      }

      return res.status(201).json({ success: true, data: { id: scheduleId, message: '예약작업을 생성했어.', enqueue: enqueueResult } } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error creating graph workflow schedule:', error)
      return res.status(500).json({ success: false, error: '예약작업 생성에 실패했어.' } as ModuleGraphResponse)
    }
  }))

  router.put('/schedules/:scheduleId', asyncHandler(async (req: Request, res: Response) => {
    const scheduleId = parseRequiredGraphRouteId(res, req.params.scheduleId, '잘못된 예약작업 ID야.')
    if (scheduleId === null) {
      return
    }

    const scheduleContext = findScheduleWorkflowContextOrRespond(res, scheduleId)
    if (!scheduleContext) {
      return
    }

    const { schedule, workflow } = scheduleContext

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
    const scheduleType = req.body?.schedule_type !== undefined ? parseScheduleType(req.body.schedule_type) : undefined
    const requestedStatus = req.body?.status !== undefined ? parseScheduleStatus(req.body.status) : undefined
    const runAt = req.body?.run_at !== undefined ? parseOptionalTrimmedString(req.body.run_at) : undefined
    const intervalMinutes = req.body?.interval_minutes !== undefined ? parsePositiveInteger(req.body.interval_minutes) : undefined
    const dailyTime = req.body?.daily_time !== undefined ? parseOptionalTrimmedString(req.body.daily_time) : undefined
    const rawMaxRunCount = req.body?.max_run_count
    const maxRunCount = req.body?.max_run_count !== undefined ? parseScheduleMaxRunCount(req.body.max_run_count) : undefined
    const failurePolicy = req.body?.failure_policy !== undefined ? parseScheduleFailurePolicy(req.body.failure_policy) : undefined
    const timezone = req.body?.timezone !== undefined ? parseOptionalTrimmedString(req.body.timezone) : undefined
    const inputValues = req.body?.input_values !== undefined ? parseScheduleInputValues(req.body.input_values) : undefined
    const enqueueCount = parseScheduleEnqueueCount(req.body?.enqueue_count)

    if (name !== undefined && !name) {
      return sendRouteBadRequest(res, '이름이 필요해.')
    }

    if (req.body?.schedule_type !== undefined && !scheduleType) {
      return sendRouteBadRequest(res, 'schedule_type은 once, interval, daily 중 하나여야 해.')
    }

    if (req.body?.failure_policy !== undefined && !failurePolicy) {
      return sendRouteBadRequest(res, '실패 처리 방식은 stop 또는 continue여야 해.')
    }

    if (rawMaxRunCount !== undefined && rawMaxRunCount !== null && rawMaxRunCount !== '' && maxRunCount === null && Number(rawMaxRunCount) !== -1) {
      return sendRouteBadRequest(res, '최대 예약 횟수는 양의 정수 또는 -1이어야 해.')
    }

    if (enqueueCount === null) {
      return sendRouteBadRequest(res, `즉시 큐 등록 수는 0부터 ${MAX_BULK_SCHEDULE_ENQUEUE_COUNT} 사이의 정수여야 해.`)
    }

    try {
      const finalScheduleType = scheduleType ?? schedule.schedule_type
      const finalStatus = requestedStatus ?? schedule.status
      const finalRunAt = runAt === undefined ? schedule.run_at ?? null : runAt
      const finalIntervalMinutes = intervalMinutes === undefined ? schedule.interval_minutes ?? null : intervalMinutes
      const finalDailyTime = dailyTime === undefined ? schedule.daily_time ?? null : dailyTime
      const finalInputValues = inputValues === undefined
        ? (schedule.input_values ? JSON.parse(schedule.input_values) as Record<string, unknown> : null)
        : inputValues
      const nextRunAt = finalStatus === 'active'
        ? GraphWorkflowScheduleService.buildInitialNextRunAt({
          scheduleType: finalScheduleType,
          runAt: finalRunAt,
          intervalMinutes: finalIntervalMinutes,
          dailyTime: finalDailyTime,
        })
        : null

      const updated = GraphWorkflowScheduleModel.update(scheduleId, {
        name,
        schedule_type: scheduleType ?? undefined,
        status: finalStatus,
        timezone,
        run_at: runAt,
        interval_minutes: intervalMinutes,
        daily_time: dailyTime,
        max_run_count: maxRunCount,
        failure_policy: failurePolicy,
        input_values: inputValues,
        confirmed_graph_version: workflow.version,
        confirmed_input_signature: GraphWorkflowScheduleService.buildInputSignature(finalInputValues),
        next_run_at: nextRunAt,
        stop_reason_code: finalStatus === 'active' ? null : schedule.stop_reason_code ?? 'manual_pause',
        stop_reason_message: finalStatus === 'active' ? null : schedule.stop_reason_message ?? '예약작업이 일시정지 상태야.',
      })

      const finalMaxRunCount = maxRunCount === undefined ? schedule.max_run_count : maxRunCount
      const enqueueResult = enqueueScheduleRuns({
        scheduleId,
        workflowId: workflow.id,
        inputValues: finalInputValues ?? undefined,
        requestedCount: enqueueCount,
        maxRunCount: finalMaxRunCount,
      })

      if (enqueueResult.enqueued_count > 0) {
        GraphWorkflowScheduleModel.update(scheduleId, {
          last_execution_id: enqueueResult.execution_ids.at(-1) ?? null,
          last_enqueued_at: new Date().toISOString(),
        })
      }

      return res.json({ success: updated || enqueueResult.enqueued_count > 0, data: { id: scheduleId, message: updated ? '예약작업을 업데이트했어.' : '예약작업 변경사항이 없어.', enqueue: enqueueResult } } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error updating graph workflow schedule:', error)
      return res.status(500).json({ success: false, error: '예약작업 수정에 실패했어.' } as ModuleGraphResponse)
    }
  }))

  router.post('/schedules/:scheduleId/pause', asyncHandler(async (req: Request, res: Response) => {
    const scheduleId = parseRequiredGraphRouteId(res, req.params.scheduleId, '잘못된 예약작업 ID야.')
    if (scheduleId === null) {
      return
    }

    if (!findGraphWorkflowScheduleOrRespond(res, scheduleId)) {
      return
    }

    const updated = GraphWorkflowScheduleModel.update(scheduleId, {
      status: 'paused',
      next_run_at: null,
      stop_reason_code: 'manual_pause',
      stop_reason_message: '사용자가 예약작업을 일시정지했어.',
    })
    const queueCleanup = GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds([scheduleId])

    return res.json({ success: updated, data: { id: scheduleId, message: '예약작업을 일시정지했어.', queue_cleanup: queueCleanup } } as ModuleGraphResponse)
  }))

  router.post('/schedules/:scheduleId/resume', asyncHandler(async (req: Request, res: Response) => {
    const scheduleId = parseRequiredGraphRouteId(res, req.params.scheduleId, '잘못된 예약작업 ID야.')
    if (scheduleId === null) {
      return
    }

    const scheduleContext = findScheduleWorkflowContextOrRespond(res, scheduleId)
    if (!scheduleContext) {
      return
    }

    const { schedule, workflow } = scheduleContext

    const nextRunAt = GraphWorkflowScheduleService.buildInitialNextRunAt({
      scheduleType: schedule.schedule_type,
      runAt: schedule.run_at,
      intervalMinutes: schedule.interval_minutes,
      dailyTime: schedule.daily_time,
    })

    const updated = GraphWorkflowScheduleModel.update(scheduleId, {
      status: 'active',
      confirmed_graph_version: workflow.version,
      next_run_at: nextRunAt,
      stop_reason_code: null,
      stop_reason_message: null,
    })

    return res.json({ success: updated, data: { id: scheduleId, message: '예약작업을 다시 켰어.' } } as ModuleGraphResponse)
  }))

  router.post('/schedules/:scheduleId/run-now', asyncHandler(async (req: Request, res: Response) => {
    const scheduleId = parseRequiredGraphRouteId(res, req.params.scheduleId, '잘못된 예약작업 ID야.')
    if (scheduleId === null) {
      return
    }

    const scheduleContext = findScheduleWorkflowContextOrRespond(res, scheduleId)
    if (!scheduleContext) {
      return
    }

    const { schedule } = scheduleContext
    const enqueueCount = parseScheduleEnqueueCount(req.body?.enqueue_count ?? 1)
    if (enqueueCount === null || enqueueCount <= 0) {
      return sendRouteBadRequest(res, `즉시 실행 수는 1부터 ${MAX_BULK_SCHEDULE_ENQUEUE_COUNT} 사이의 정수여야 해.`)
    }

    try {
      const enqueueResult = enqueueScheduleRuns({
        scheduleId,
        workflowId: schedule.graph_workflow_id,
        inputValues: parseStoredScheduleInputValues(schedule.input_values),
        requestedCount: enqueueCount,
        maxRunCount: schedule.max_run_count,
      })

      if (enqueueResult.enqueued_count > 0) {
        GraphWorkflowScheduleModel.update(scheduleId, {
          last_execution_id: enqueueResult.execution_ids.at(-1) ?? null,
          last_enqueued_at: new Date().toISOString(),
        })
      }

      return res.status(201).json({
        success: true,
        data: {
          executionId: enqueueResult.execution_ids[0] ?? null,
          status: 'queued',
          enqueue: enqueueResult,
          message: enqueueResult.enqueued_count > 0 ? '예약작업 즉시 실행을 등록했어.' : '남은 예약 횟수가 없어 새 실행을 등록하지 않았어.',
        },
      } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error running graph workflow schedule now:', error)
      return res.status(500).json({ success: false, error: '예약작업 즉시 실행 등록에 실패했어.' } as ModuleGraphResponse)
    }
  }))

  router.delete('/schedules/:scheduleId', asyncHandler(async (req: Request, res: Response) => {
    const scheduleId = parseRequiredGraphRouteId(res, req.params.scheduleId, '잘못된 예약작업 ID야.')
    if (scheduleId === null) {
      return
    }

    if (!findGraphWorkflowScheduleOrRespond(res, scheduleId)) {
      return
    }

    const queueCleanup = GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds([scheduleId])
    const deleted = GraphWorkflowScheduleModel.delete(scheduleId)
    return res.json({ success: deleted, data: { id: scheduleId, message: '예약작업을 삭제했어.', queue_cleanup: queueCleanup } } as ModuleGraphResponse)
  }))

  return router
}

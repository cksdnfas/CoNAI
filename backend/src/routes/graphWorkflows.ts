import { Router, Request, Response } from 'express'
import { routeParam } from './routeParam'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule'
import { GraphWorkflowExecutionQueue } from '../services/graphWorkflowExecutionQueue'
import { GraphWorkflowScheduleService } from '../services/graphWorkflowScheduleService'
import {
  buildGraphWorkflowBrowseContent,
  decorateGraphExecutionRecord,
  parseStoredGraphWorkflow,
} from '../services/graphWorkflowViewService'
import {
  cleanupEmptyGraphExecutions,
  copyGraphWorkflowArtifactsToWatchedFolder,
  deleteGraphExecutionArtifacts,
} from '../services/graphWorkflowOutputManagementService'
import {
  ModuleGraphResponse,
  GraphWorkflowCreateData,
  GraphWorkflowUpdateData,
  GraphWorkflowScheduleStatus,
  GraphWorkflowScheduleType,
} from '../types/moduleGraph'
import { asyncHandler } from '../middleware/errorHandler'
import { parsePositiveInteger, sendRouteBadRequest } from './routeValidation'

const router = Router()

function parseScheduleType(value: unknown): GraphWorkflowScheduleType | null {
  return value === 'once' || value === 'interval' || value === 'daily' ? value : null
}

function parseScheduleStatus(value: unknown): GraphWorkflowScheduleStatus | null {
  return value === 'active' || value === 'paused' || value === 'error_stopped' || value === 'overlap_stopped' || value === 'completed'
    ? value
    : null
}

function parseOptionalTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseScheduleInputValues(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function parseGraphRouteInteger(value: string | string[] | undefined) {
  return parseInt(routeParam(routeParam(value)))
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active === 'true'
    const workflows = GraphWorkflowModel.findAll(activeOnly).map(parseStoredGraphWorkflow)
    return res.json({ success: true, data: workflows } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph workflows:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph workflows' } as ModuleGraphResponse)
  }
}))

router.get('/browse-content', asyncHandler(async (req: Request, res: Response) => {
  const folderIdParam = typeof req.query.folder_id === 'string' ? Number(req.query.folder_id) : null
  const folderId = folderIdParam !== null && Number.isFinite(folderIdParam) ? folderIdParam : null

  if (folderId !== null && !GraphWorkflowFolderModel.findById(folderId)) {
    return res.status(404).json({ success: false, error: 'Graph workflow folder not found' } as ModuleGraphResponse)
  }

  try {
    return res.json({ success: true, data: buildGraphWorkflowBrowseContent(folderId) } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph workflow browse content:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph workflow browse content' } as ModuleGraphResponse)
  }
}))

router.get('/folders', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const folders = GraphWorkflowFolderModel.findAll()
    return res.json({ success: true, data: folders } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph workflow folders:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph workflow folders' } as ModuleGraphResponse)
  }
}))

router.post('/folders', asyncHandler(async (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : ''
  const parentId = typeof req.body?.parent_id === 'number' ? req.body.parent_id : null

  if (!name) {
    return sendRouteBadRequest(res, 'name is required')
  }

  if (parentId !== null && !GraphWorkflowFolderModel.findById(parentId)) {
    return res.status(404).json({ success: false, error: 'Parent folder not found' } as ModuleGraphResponse)
  }

  try {
    const id = GraphWorkflowFolderModel.create({ name, description: description || null, parent_id: parentId })
    return res.status(201).json({ success: true, data: { id, message: 'Graph workflow folder created successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error creating graph workflow folder:', error)
    return res.status(500).json({ success: false, error: 'Failed to create graph workflow folder' } as ModuleGraphResponse)
  }
}))

router.put('/folders/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  const existingFolder = !isNaN(id) ? GraphWorkflowFolderModel.findById(id) : null
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : undefined
  const parentId = typeof req.body?.parent_id === 'number' ? req.body.parent_id : req.body?.parent_id === null ? null : undefined

  if (isNaN(id)) {
    return sendRouteBadRequest(res, 'Invalid folder ID')
  }

  if (!existingFolder) {
    return res.status(404).json({ success: false, error: 'Graph workflow folder not found' } as ModuleGraphResponse)
  }

  if (name !== undefined && !name) {
    return sendRouteBadRequest(res, 'name is required')
  }

  if (parentId !== undefined) {
    if (parentId === id) {
      return sendRouteBadRequest(res, 'Folder cannot be its own parent')
    }
    if (parentId !== null && !GraphWorkflowFolderModel.findById(parentId)) {
      return res.status(404).json({ success: false, error: 'Parent folder not found' } as ModuleGraphResponse)
    }
  }

  try {
    const updated = GraphWorkflowFolderModel.update(id, {
      name,
      description: description === undefined ? undefined : description || null,
      parent_id: parentId,
    })
    if (!updated) {
      return sendRouteBadRequest(res, 'No folder changes detected')
    }

    return res.json({ success: true, data: { message: 'Graph workflow folder updated successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error updating graph workflow folder:', error)
    return res.status(500).json({ success: false, error: 'Failed to update graph workflow folder' } as ModuleGraphResponse)
  }
}))

router.delete('/folders/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  const deleteMode = req.query.mode === 'delete_tree' ? 'delete_tree' : 'move_children'

  if (isNaN(id)) {
    return sendRouteBadRequest(res, 'Invalid folder ID')
  }

  if (!GraphWorkflowFolderModel.findById(id)) {
    return res.status(404).json({ success: false, error: 'Graph workflow folder not found' } as ModuleGraphResponse)
  }

  try {
    const deleted = GraphWorkflowFolderModel.delete(id, deleteMode)
    if (!deleted) {
      return res.status(500).json({ success: false, error: 'Failed to delete graph workflow folder' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: { message: deleteMode === 'delete_tree' ? 'Graph workflow folder tree deleted successfully' : 'Graph workflow folder deleted and children moved successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error deleting graph workflow folder:', error)
    return res.status(500).json({ success: false, error: 'Failed to delete graph workflow folder' } as ModuleGraphResponse)
  }
}))

router.get('/schedules', asyncHandler(async (req: Request, res: Response) => {
  const workflowIdParam = typeof req.query.workflow_id === 'string' ? Number(req.query.workflow_id) : null
  const folderIdParam = typeof req.query.folder_id === 'string' ? Number(req.query.folder_id) : null

  try {
    if (workflowIdParam !== null && Number.isFinite(workflowIdParam)) {
      return res.json({ success: true, data: GraphWorkflowScheduleModel.findByWorkflowId(workflowIdParam) } as ModuleGraphResponse)
    }

    if (folderIdParam !== null && Number.isFinite(folderIdParam)) {
      const folder = GraphWorkflowFolderModel.findById(folderIdParam)
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Graph workflow folder not found' } as ModuleGraphResponse)
      }

      const workflowIds = GraphWorkflowModel.findByFolderIds(GraphWorkflowFolderModel.getSubtreeFolderIds(folder.id), true).map((workflow) => workflow.id)
      return res.json({ success: true, data: GraphWorkflowScheduleModel.findByWorkflowIds(workflowIds) } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: GraphWorkflowScheduleModel.findAll() } as ModuleGraphResponse)
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
  const maxRunCount = parsePositiveInteger(req.body?.max_run_count)
  const timezone = parseOptionalTrimmedString(req.body?.timezone)
  const inputValues = parseScheduleInputValues(req.body?.input_values)

  if (!Number.isFinite(workflowId)) {
    return sendRouteBadRequest(res, 'graph_workflow_id is required')
  }

  if (!name) {
    return sendRouteBadRequest(res, 'name is required')
  }

  if (!scheduleType) {
    return sendRouteBadRequest(res, 'schedule_type must be once, interval, or daily')
  }

  const workflow = GraphWorkflowModel.findById(workflowId)
  if (!workflow) {
    return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
  }

  if (scheduleType === 'once' && !runAt) {
    return sendRouteBadRequest(res, 'run_at is required for one-time schedules')
  }

  if (scheduleType === 'interval' && !intervalMinutes) {
    return sendRouteBadRequest(res, 'interval_minutes is required for interval schedules')
  }

  if (scheduleType === 'daily' && !dailyTime) {
    return sendRouteBadRequest(res, 'daily_time is required for daily schedules')
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
      input_values: inputValues,
      confirmed_graph_version: workflow.version,
      confirmed_input_signature: GraphWorkflowScheduleService.buildInputSignature(inputValues),
      next_run_at: nextRunAt,
      stop_reason_code: status === 'active' ? null : 'manual_pause',
      stop_reason_message: status === 'active' ? null : 'Schedule created in paused state.',
    })

    return res.status(201).json({ success: true, data: { id: scheduleId, message: 'Graph workflow schedule created successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error creating graph workflow schedule:', error)
    return res.status(500).json({ success: false, error: 'Failed to create graph workflow schedule' } as ModuleGraphResponse)
  }
}))

router.put('/schedules/:scheduleId', asyncHandler(async (req: Request, res: Response) => {
  const scheduleId = parseGraphRouteInteger(req.params.scheduleId)
  if (isNaN(scheduleId)) {
    return sendRouteBadRequest(res, 'Invalid schedule ID')
  }

  const schedule = GraphWorkflowScheduleModel.findById(scheduleId)
  if (!schedule) {
    return res.status(404).json({ success: false, error: 'Graph workflow schedule not found' } as ModuleGraphResponse)
  }

  const workflow = GraphWorkflowModel.findById(schedule.graph_workflow_id)
  if (!workflow) {
    return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
  const scheduleType = req.body?.schedule_type !== undefined ? parseScheduleType(req.body.schedule_type) : undefined
  const requestedStatus = req.body?.status !== undefined ? parseScheduleStatus(req.body.status) : undefined
  const runAt = req.body?.run_at !== undefined ? parseOptionalTrimmedString(req.body.run_at) : undefined
  const intervalMinutes = req.body?.interval_minutes !== undefined ? parsePositiveInteger(req.body.interval_minutes) : undefined
  const dailyTime = req.body?.daily_time !== undefined ? parseOptionalTrimmedString(req.body.daily_time) : undefined
  const maxRunCount = req.body?.max_run_count !== undefined ? parsePositiveInteger(req.body.max_run_count) : undefined
  const timezone = req.body?.timezone !== undefined ? parseOptionalTrimmedString(req.body.timezone) : undefined
  const inputValues = req.body?.input_values !== undefined ? parseScheduleInputValues(req.body.input_values) : undefined

  if (name !== undefined && !name) {
    return sendRouteBadRequest(res, 'name is required')
  }

  if (req.body?.schedule_type !== undefined && !scheduleType) {
    return sendRouteBadRequest(res, 'schedule_type must be once, interval, or daily')
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
      input_values: inputValues,
      confirmed_graph_version: workflow.version,
      confirmed_input_signature: GraphWorkflowScheduleService.buildInputSignature(finalInputValues),
      next_run_at: nextRunAt,
      stop_reason_code: finalStatus === 'active' ? null : schedule.stop_reason_code ?? 'manual_pause',
      stop_reason_message: finalStatus === 'active' ? null : schedule.stop_reason_message ?? 'Schedule paused.',
    })

    return res.json({ success: updated, data: { id: scheduleId, message: updated ? 'Graph workflow schedule updated successfully' : 'No schedule changes applied' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error updating graph workflow schedule:', error)
    return res.status(500).json({ success: false, error: 'Failed to update graph workflow schedule' } as ModuleGraphResponse)
  }
}))

router.post('/schedules/:scheduleId/pause', asyncHandler(async (req: Request, res: Response) => {
  const scheduleId = parseGraphRouteInteger(req.params.scheduleId)
  if (isNaN(scheduleId)) {
    return sendRouteBadRequest(res, 'Invalid schedule ID')
  }

  const schedule = GraphWorkflowScheduleModel.findById(scheduleId)
  if (!schedule) {
    return res.status(404).json({ success: false, error: 'Graph workflow schedule not found' } as ModuleGraphResponse)
  }

  const updated = GraphWorkflowScheduleModel.update(scheduleId, {
    status: 'paused',
    next_run_at: null,
    stop_reason_code: 'manual_pause',
    stop_reason_message: 'Schedule paused by user.',
  })
  const queueCleanup = GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds([scheduleId])

  return res.json({ success: updated, data: { id: scheduleId, message: 'Graph workflow schedule paused', queue_cleanup: queueCleanup } } as ModuleGraphResponse)
}))

router.post('/schedules/:scheduleId/resume', asyncHandler(async (req: Request, res: Response) => {
  const scheduleId = parseGraphRouteInteger(req.params.scheduleId)
  if (isNaN(scheduleId)) {
    return sendRouteBadRequest(res, 'Invalid schedule ID')
  }

  const schedule = GraphWorkflowScheduleModel.findById(scheduleId)
  if (!schedule) {
    return res.status(404).json({ success: false, error: 'Graph workflow schedule not found' } as ModuleGraphResponse)
  }

  const workflow = GraphWorkflowModel.findById(schedule.graph_workflow_id)
  if (!workflow) {
    return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
  }

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

  return res.json({ success: updated, data: { id: scheduleId, message: 'Graph workflow schedule resumed' } } as ModuleGraphResponse)
}))

router.post('/schedules/:scheduleId/run-now', asyncHandler(async (req: Request, res: Response) => {
  const scheduleId = parseGraphRouteInteger(req.params.scheduleId)
  if (isNaN(scheduleId)) {
    return sendRouteBadRequest(res, 'Invalid schedule ID')
  }

  const schedule = GraphWorkflowScheduleModel.findById(scheduleId)
  if (!schedule) {
    return res.status(404).json({ success: false, error: 'Graph workflow schedule not found' } as ModuleGraphResponse)
  }

  const workflow = GraphWorkflowModel.findById(schedule.graph_workflow_id)
  if (!workflow) {
    return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
  }

  try {
    const result = GraphWorkflowExecutionQueue.enqueue(
      schedule.graph_workflow_id,
      schedule.input_values ? JSON.parse(schedule.input_values) as Record<string, unknown> : undefined,
      undefined,
      false,
      { triggerType: 'schedule', scheduleId },
    )

    GraphWorkflowScheduleModel.update(scheduleId, {
      last_execution_id: result.executionId,
      last_enqueued_at: new Date().toISOString(),
    })

    return res.status(201).json({ success: true, data: { ...result, message: 'Graph workflow schedule run enqueued' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error running graph workflow schedule now:', error)
    return res.status(500).json({ success: false, error: 'Failed to run graph workflow schedule now' } as ModuleGraphResponse)
  }
}))

router.delete('/schedules/:scheduleId', asyncHandler(async (req: Request, res: Response) => {
  const scheduleId = parseGraphRouteInteger(req.params.scheduleId)
  if (isNaN(scheduleId)) {
    return sendRouteBadRequest(res, 'Invalid schedule ID')
  }

  const schedule = GraphWorkflowScheduleModel.findById(scheduleId)
  if (!schedule) {
    return res.status(404).json({ success: false, error: 'Graph workflow schedule not found' } as ModuleGraphResponse)
  }

  const queueCleanup = GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds([scheduleId])
  const deleted = GraphWorkflowScheduleModel.delete(scheduleId)
  return res.json({ success: deleted, data: { id: scheduleId, message: 'Graph workflow schedule deleted', queue_cleanup: queueCleanup } } as ModuleGraphResponse)
}))

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  if (isNaN(id)) {
    return sendRouteBadRequest(res, 'Invalid graph workflow ID')
  }

  try {
    const workflow = GraphWorkflowModel.findById(id)
    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: parseStoredGraphWorkflow(workflow) } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph workflow:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph workflow' } as ModuleGraphResponse)
  }
}))

router.get('/:id/executions', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  if (isNaN(id)) {
    return sendRouteBadRequest(res, 'Invalid graph workflow ID')
  }

  try {
    const executions = GraphExecutionModel.findByWorkflow(id).map(decorateGraphExecutionRecord)
    return res.json({ success: true, data: executions } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph executions:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph executions' } as ModuleGraphResponse)
  }
}))

router.get('/executions/:executionId', asyncHandler(async (req: Request, res: Response) => {
  const executionId = parseGraphRouteInteger(req.params.executionId)
  if (isNaN(executionId)) {
    return sendRouteBadRequest(res, 'Invalid execution ID')
  }

  try {
    const execution = GraphExecutionModel.findById(executionId)
    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' } as ModuleGraphResponse)
    }

    const artifacts = GraphExecutionArtifactModel.findByExecution(executionId)
    const finalResults = GraphExecutionFinalResultModel.findByExecution(executionId)
    const logs = GraphExecutionLogModel.findByExecution(executionId)
    return res.json({ success: true, data: { execution: decorateGraphExecutionRecord(execution), artifacts, final_results: finalResults, logs } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph execution:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph execution' } as ModuleGraphResponse)
  }
}))

router.post('/:id/execute', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  if (isNaN(id)) {
    return sendRouteBadRequest(res, 'Invalid graph workflow ID')
  }

  try {
    const inputValues = req.body?.input_values && typeof req.body.input_values === 'object' ? req.body.input_values as Record<string, unknown> : undefined
    const result = GraphWorkflowExecutionQueue.enqueue(id, inputValues)
    return res.status(201).json({ success: true, data: result } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error executing graph workflow:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute graph workflow',
    } as ModuleGraphResponse)
  }
}))

router.post('/:id/nodes/:nodeId/execute', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  const nodeId = routeParam(req.params.nodeId)
  if (isNaN(id) || !nodeId) {
    return sendRouteBadRequest(res, 'Invalid graph workflow or node ID')
  }

  try {
    const workflow = GraphWorkflowModel.findById(id)
    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
    }

    const graph = workflow.graph_json ? JSON.parse(workflow.graph_json) : { nodes: [], edges: [] }
    const nodeExists = Array.isArray(graph.nodes) && graph.nodes.some((node: { id?: string }) => node.id === nodeId)
    if (!nodeExists) {
      return res.status(404).json({ success: false, error: 'Graph node not found' } as ModuleGraphResponse)
    }

    const inputValues = req.body?.input_values && typeof req.body.input_values === 'object' ? req.body.input_values as Record<string, unknown> : undefined
    const forceRerun = req.body?.force_rerun === true
    const result = GraphWorkflowExecutionQueue.enqueue(id, inputValues, nodeId, forceRerun)
    return res.status(201).json({ success: true, data: result } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error executing graph node:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute graph node',
    } as ModuleGraphResponse)
  }
}))

router.post('/executions/:executionId/cancel', asyncHandler(async (req: Request, res: Response) => {
  const executionId = parseGraphRouteInteger(req.params.executionId)
  if (isNaN(executionId)) {
    return sendRouteBadRequest(res, 'Invalid execution ID')
  }

  try {
    const result = GraphWorkflowExecutionQueue.cancel(executionId)
    if (!result.success && result.status === 'not_found') {
      return res.status(404).json({ success: false, error: result.message } as ModuleGraphResponse)
    }

    return res.json({ success: result.success, data: result, error: result.success ? undefined : result.message } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error cancelling graph execution:', error)
    return res.status(500).json({ success: false, error: 'Failed to cancel graph execution' } as ModuleGraphResponse)
  }
}))

router.post('/executions/cleanup-empty', asyncHandler(async (req: Request, res: Response) => {
  const executionIds: number[] = Array.isArray(req.body?.execution_ids)
    ? Array.from(new Set<number>(req.body.execution_ids
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isFinite(value))))
    : []

  if (executionIds.length === 0) {
    return sendRouteBadRequest(res, 'execution_ids is required')
  }

  try {
    return res.json({ success: true, data: cleanupEmptyGraphExecutions(executionIds) } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error cleaning up empty graph executions:', error)
    return res.status(500).json({ success: false, error: 'Failed to clean up empty graph executions' } as ModuleGraphResponse)
  }
}))

router.post('/artifacts/copy-to-folder', asyncHandler(async (req: Request, res: Response) => {
  const folderId = Number(req.body?.folder_id)
  const sourcePaths: string[] = Array.isArray(req.body?.source_paths)
    ? Array.from(new Set<string>(req.body.source_paths
      .filter((value: unknown): value is string => typeof value === 'string')
      .map((value: string) => value.trim())
      .filter((value: string) => value.length > 0)))
    : []

  if (!Number.isFinite(folderId)) {
    return sendRouteBadRequest(res, 'folder_id is required')
  }

  if (sourcePaths.length === 0) {
    return sendRouteBadRequest(res, 'source_paths is required')
  }

  try {
    const copyResult = await copyGraphWorkflowArtifactsToWatchedFolder(folderId, sourcePaths)
    if (!copyResult) {
      return res.status(404).json({ success: false, error: 'Watched folder not found' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: copyResult } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error copying graph workflow artifacts to watched folder:', error)
    return res.status(500).json({ success: false, error: 'Failed to copy graph workflow artifacts to watched folder' } as ModuleGraphResponse)
  }
}))

router.post('/artifacts/delete', asyncHandler(async (req: Request, res: Response) => {
  const artifactIds: number[] = Array.isArray(req.body?.artifact_ids)
    ? Array.from(new Set<number>(req.body.artifact_ids
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isFinite(value))))
    : []

  if (artifactIds.length === 0) {
    return sendRouteBadRequest(res, 'artifact_ids is required')
  }

  try {
    return res.json({ success: true, data: await deleteGraphExecutionArtifacts(artifactIds) } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error deleting graph workflow artifacts:', error)
    return res.status(500).json({ success: false, error: 'Failed to delete graph workflow artifacts' } as ModuleGraphResponse)
  }
}))

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, graph, folder_id, version, is_active } = req.body
  if (!name || !graph) {
    return sendRouteBadRequest(res, 'name and graph are required')
  }

  try {
    const createData: GraphWorkflowCreateData = {
      name,
      description,
      graph,
      folder_id: typeof folder_id === 'number' ? folder_id : null,
      version,
      is_active,
    }

    const id = GraphWorkflowModel.create(createData)
    return res.status(201).json({ success: true, data: { id, message: 'Graph workflow created successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error creating graph workflow:', error)
    return res.status(500).json({ success: false, error: 'Failed to create graph workflow' } as ModuleGraphResponse)
  }
}))

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  if (isNaN(id)) {
    return sendRouteBadRequest(res, 'Invalid graph workflow ID')
  }

  try {
    const existing = GraphWorkflowModel.findById(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
    }

    const updateData: GraphWorkflowUpdateData = {
      name: req.body.name,
      description: req.body.description,
      graph: req.body.graph,
      folder_id: typeof req.body.folder_id === 'number' ? req.body.folder_id : req.body.folder_id === null ? null : undefined,
      version: req.body.version,
      is_active: req.body.is_active,
    }

    const updated = GraphWorkflowModel.update(id, updateData)
    const shouldPauseSchedulesForReview = Boolean(updateData.graph !== undefined || updateData.version !== undefined)
    const scheduleMaintenance = updated && shouldPauseSchedulesForReview
      ? GraphWorkflowScheduleService.pauseSchedulesForWorkflowChange(id)
      : null
    return res.json({
      success: updated,
      data: {
        id,
        message: updated ? 'Graph workflow updated successfully' : 'No changes applied',
        schedule_maintenance: scheduleMaintenance,
      },
    } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error updating graph workflow:', error)
    return res.status(500).json({ success: false, error: 'Failed to update graph workflow' } as ModuleGraphResponse)
  }
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseGraphRouteInteger(req.params.id)
  if (isNaN(id)) {
    return sendRouteBadRequest(res, 'Invalid graph workflow ID')
  }

  try {
    const scheduleMaintenance = GraphWorkflowScheduleService.deleteSchedulesForWorkflowDeletion(id)
    const deleted = GraphWorkflowModel.delete(id)
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
    }

    return res.json({
      success: true,
      data: {
        message: 'Graph workflow deleted successfully',
        schedule_maintenance: scheduleMaintenance,
      },
    } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error deleting graph workflow:', error)
    return res.status(500).json({ success: false, error: 'Failed to delete graph workflow' } as ModuleGraphResponse)
  }
}))

export const graphWorkflowRoutes = router
export default router

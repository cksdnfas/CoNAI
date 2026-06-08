import { Router, type Request, type Response } from 'express'
import { GraphExecutionModel } from '../../models/GraphExecution'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphWorkflowScheduleModel } from '../../models/GraphWorkflowSchedule'
import { GraphWorkflowScheduleService } from '../../services/graphWorkflowScheduleService'
import {
  buildGraphWorkflowBrowseContent,
  parseStoredGraphWorkflow,
} from '../../services/graphWorkflowViewService'
import { GraphWorkflowExecutionQueue } from '../../services/graphWorkflowExecutionQueue'
import { getGraphWorkflowOutputRetentionState } from '../../services/graphWorkflowOutputRetentionService'
import { asyncHandler } from '../../middleware/errorHandler'
import { sendRouteBadRequest } from '../routeValidation'
import type {
  GraphWorkflowCreateData,
  GraphWorkflowRuntimeHealthRecord,
  GraphWorkflowUpdateData,
  ModuleGraphResponse,
} from '../../types/moduleGraph'
import {
  findGraphWorkflowFolderOrRespond,
  parseGraphRouteInteger,
  parseOptionalGraphFolderId,
} from './route-helpers'

export function createGraphWorkflowCrudRoutes() {
  const router = Router()

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
    const folderIdResult = parseOptionalGraphFolderId(req.query.folder_id)
    if (!folderIdResult.ok) {
      return sendRouteBadRequest(res, 'Invalid graph workflow folder ID')
    }

    const folderId = folderIdResult.value

    if (folderId !== null && !findGraphWorkflowFolderOrRespond(res, folderId)) {
      return
    }

    try {
      const includeOutputs = req.query.include_outputs !== 'false'
      return res.json({ success: true, data: buildGraphWorkflowBrowseContent(folderId, { includeOutputs }) } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflow browse content:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflow browse content' } as ModuleGraphResponse)
    }
  }))

  router.get('/:id/runtime-health', asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    try {
      const workflow = GraphWorkflowModel.findById(id)
      if (!workflow) {
        return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
      }

      const executionSummary = GraphExecutionModel.summarizeWorkflowRuntime(id)
      const queueState = GraphWorkflowExecutionQueue.getWorkflowRuntimeQueueState(id)
      const retryPolicy = GraphWorkflowScheduleModel.summarizeRuntimePolicyByWorkflowId(id)
      const retentionState = getGraphWorkflowOutputRetentionState(id)
      const health: GraphWorkflowRuntimeHealthRecord = {
        workflow_id: id,
        queue: {
          queued_count: executionSummary.queued_count,
          running_count: executionSummary.running_count,
          manual_queued_count: executionSummary.manual_queued_count,
          manual_running_count: executionSummary.manual_running_count,
          schedule_queued_count: executionSummary.schedule_queued_count,
          schedule_running_count: executionSummary.schedule_running_count,
          in_process_running_count: queueState.in_process_running_count,
          oldest_queued_at: executionSummary.oldest_queued_at,
          retry_timer_pending: queueState.retry_timer_pending,
          queue_recheck_interval_ms: queueState.queue_recheck_interval_ms,
          schedule_concurrency_limit: queueState.schedule_concurrency_limit,
          cancellation_requested_count: queueState.cancellation_requested_count,
        },
        retry_policy: retryPolicy,
        retention: retentionState,
        recovery: {
          last_startup_recovery_at: queueState.last_startup_recovery?.recoveredAt ?? null,
          startup_queued_backlog: queueState.last_startup_recovery?.queuedBacklog ?? 0,
          startup_failed_running: queueState.last_startup_recovery?.failedRunning ?? 0,
          running_not_in_process_count: Math.max(0, executionSummary.running_count - queueState.in_process_running_count),
        },
        telemetry: {
          completed_count: executionSummary.completed_count,
          failed_count: executionSummary.failed_count,
          cancelled_count: executionSummary.cancelled_count,
          latest_completed_at: executionSummary.latest_completed_at,
          latest_failed_at: executionSummary.latest_failed_at,
          latest_error_message: executionSummary.latest_error_message,
        },
      }

      return res.json({ success: true, data: health } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflow runtime health:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflow runtime health' } as ModuleGraphResponse)
    }
  }))

  router.get('/:id/versions', asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    try {
      const workflow = GraphWorkflowModel.findById(id)
      if (!workflow) {
        return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
      }

      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 12
      const versions = GraphWorkflowModel.findVersionSummaries(id, Number.isInteger(limit) ? limit : 12)
      return res.json({ success: true, data: versions } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflow versions:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflow versions' } as ModuleGraphResponse)
    }
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

  return router
}

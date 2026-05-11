import { Router, type Request, type Response } from 'express'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphExecutionModel } from '../../models/GraphExecution'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../../models/GraphExecutionLog'
import { GraphWorkflowExecutionQueue } from '../../services/graphWorkflowExecutionQueue'
import { decorateGraphExecutionRecord, decorateGraphExecutionRecords } from '../../services/graphWorkflowViewService'
import { cleanupEmptyGraphExecutions } from '../../services/graphWorkflowOutputManagementService'
import { asyncHandler } from '../../middleware/errorHandler'
import { routeParam } from '../routeParam'
import { sendRouteBadRequest } from '../routeValidation'
import type { ModuleGraphResponse } from '../../types/moduleGraph'
import { parseGraphExecutionInputValues, parseGraphRouteInteger } from './route-helpers'

export function createGraphWorkflowExecutionRoutes() {
  const router = Router()

  router.get('/:id/executions', asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    try {
      const executions = decorateGraphExecutionRecords(GraphExecutionModel.findByWorkflow(id))
      return res.json({ success: true, data: executions } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph executions:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph executions' } as ModuleGraphResponse)
    }
  }))

  router.get('/executions/:executionId/status', asyncHandler(async (req: Request, res: Response) => {
    const executionId = parseGraphRouteInteger(req.params.executionId)
    if (isNaN(executionId)) {
      return sendRouteBadRequest(res, 'Invalid execution ID')
    }

    try {
      const execution = GraphExecutionModel.findById(executionId)
      if (!execution) {
        return res.status(404).json({ success: false, error: 'Execution not found' } as ModuleGraphResponse)
      }

      const runtimeState = GraphWorkflowExecutionQueue.getExecutionRuntimeState(executionId)
      return res.json({
        success: true,
        data: {
          id: execution.id,
          status: execution.status,
          updated_date: execution.updated_date,
          completed_at: execution.completed_at,
          error_message: execution.error_message,
          failed_node_id: execution.failed_node_id,
          queue_position: runtimeState.queue_position,
          cancel_requested: runtimeState.cancel_requested,
        },
      } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph execution status:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph execution status' } as ModuleGraphResponse)
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
      const inputValues = parseGraphExecutionInputValues(req.body?.input_values)
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

      const inputValues = parseGraphExecutionInputValues(req.body?.input_values)
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

  return router
}

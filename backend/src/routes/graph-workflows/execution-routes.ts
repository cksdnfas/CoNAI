import { requirePermission } from '../../middleware/authMiddleware';
import { Router, type Request, type Response } from 'express'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphExecutionModel } from '../../models/GraphExecution'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../../models/GraphExecutionLog'
import { GraphExecutionNodeIoModel } from '../../models/GraphExecutionNodeIo'
import { GraphWorkflowExecutionQueue } from '../../services/graphWorkflowExecutionQueue'
import { decorateGraphExecutionRecord, decorateGraphExecutionRecords } from '../../services/graphWorkflowViewService'
import { cleanupEmptyGraphExecutions } from '../../services/graphWorkflowOutputManagementService'
import { asyncHandler } from '../../middleware/asyncHandler'
import { routeParam } from '../routeParam'
import { sendRouteBadRequest } from '../routeValidation'
import type { ModuleGraphResponse } from '../../types/moduleGraph'
import { parseGraphExecutionInputValues, parseGraphRouteInteger } from './route-helpers'
import { GenerationTargetGroupService } from '../../services/generationTargetGroupService'

/**
 * 실행 단위 기본 결과 그룹(output_group_id | output_group_path)을 해석한다.
 * 실패하면 응답을 보내고 undefined 를 돌려준다.
 */
function resolveExecutionOutputGroup(req: Request, res: Response): { groupId: number | null } | undefined {
  const accountId = typeof req.session?.accountId === 'number' ? req.session.accountId : null
  const resolved = GenerationTargetGroupService.resolveForAccount(accountId, {
    groupId: req.body?.output_group_id,
    groupPath: req.body?.output_group_path,
  })
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error } as ModuleGraphResponse)
    return undefined
  }
  return { groupId: resolved.groupId }
}

/** Upper bound for one batch preview request; the page only previews the newest completed runs. */
const MAX_EXECUTION_PREVIEW_IDS = 24
const DEFAULT_EXECUTION_LIST_LIMIT = 20
const MAX_EXECUTION_LIST_LIMIT = 200

/** Parse one optional list query integer, clamped to [min, max]; invalid input falls back. */
function parseBoundedListInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

export function createGraphWorkflowExecutionRoutes() {
  const router = Router()

  router.get('/:id/executions', asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    const limit = parseBoundedListInteger(req.query.limit, DEFAULT_EXECUTION_LIST_LIMIT, 1, MAX_EXECUTION_LIST_LIMIT)
    const offset = parseBoundedListInteger(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER)

    try {
      const executions = decorateGraphExecutionRecords(GraphExecutionModel.findByWorkflow(id, limit, offset))
      const counts = GraphExecutionModel.countByWorkflow(id)
      // `data` stays the plain array for existing clients; paging/counts ride along in `meta`.
      return res.json({
        success: true,
        data: executions,
        meta: {
          ...counts,
          limit,
          offset,
          has_more: offset + executions.length < counts.total,
        },
      })
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

  /**
   * WF-4: batch artifact preview for the module-graph page.
   *
   * 종전에는 완료된 실행 8건마다 `GET /executions/:id` 를 병렬로 때려 로그/node_io 까지 전부
   * 받아왔다(N+1). 여기서는 한 번의 요청으로 아티팩트와 최종 결과만 모아 준다. 로그·node_io 가
   * 필요한 최신 실행 1건은 기존 상세 라우트를 그대로 쓴다.
   * `/executions/:executionId` 보다 먼저 등록해야 `previews` 가 실행 id 로 파싱되지 않는다.
   */
  router.get('/executions/previews', asyncHandler(async (req: Request, res: Response) => {
    const rawIds = typeof req.query.execution_ids === 'string' ? req.query.execution_ids : ''
    const executionIds = Array.from(new Set(
      rawIds
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    )).slice(0, MAX_EXECUTION_PREVIEW_IDS)

    if (executionIds.length === 0) {
      return sendRouteBadRequest(res, 'execution_ids is required')
    }

    try {
      const executions = decorateGraphExecutionRecords(GraphExecutionModel.findByIds(executionIds))
      const resolvedIds = executions.map((execution) => execution.id)
      return res.json({
        success: true,
        data: {
          executions,
          artifacts: GraphExecutionArtifactModel.findByExecutionIds(resolvedIds),
          final_results: GraphExecutionFinalResultModel.findByExecutionIds(resolvedIds),
        },
      } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph execution previews:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph execution previews' } as ModuleGraphResponse)
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
      const nodeIo = GraphExecutionNodeIoModel.findByExecution(executionId)
      return res.json({ success: true, data: { execution: decorateGraphExecutionRecord(execution), artifacts, final_results: finalResults, logs, node_io: nodeIo } } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph execution:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph execution' } as ModuleGraphResponse)
    }
  }))

  router.post('/:id/execute', requirePermission('generation.execute'), asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    try {
      const inputValues = parseGraphExecutionInputValues(req.body?.input_values)
      if (!GraphWorkflowModel.findById(id)) {
        return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
      }
      const outputGroup = resolveExecutionOutputGroup(req, res)
      if (!outputGroup) {
        return
      }
      const result = GraphWorkflowExecutionQueue.enqueue(id, inputValues, undefined, false, { outputGroupId: outputGroup.groupId })
      return res.status(201).json({ success: true, data: result } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error executing graph workflow:', error)
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute graph workflow',
      } as ModuleGraphResponse)
    }
  }))

  router.post('/:id/nodes/:nodeId/execute', requirePermission('generation.execute'), asyncHandler(async (req: Request, res: Response) => {
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
      const outputGroup = resolveExecutionOutputGroup(req, res)
      if (!outputGroup) {
        return
      }
      const result = GraphWorkflowExecutionQueue.enqueue(id, inputValues, nodeId, forceRerun, { outputGroupId: outputGroup.groupId })
      return res.status(201).json({ success: true, data: result } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error executing graph node:', error)
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute graph node',
      } as ModuleGraphResponse)
    }
  }))

  router.post('/executions/:executionId/cancel', requirePermission('generation.execute'), asyncHandler(async (req: Request, res: Response) => {
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

  router.post('/executions/cleanup-empty', requirePermission('workflows.update'), asyncHandler(async (req: Request, res: Response) => {
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

import { Router, Request, Response } from 'express'
import { routeParam } from './routeParam'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphWorkflowExecutionQueue } from '../services/graphWorkflowExecutionQueue'
import { ModuleGraphResponse, GraphWorkflowCreateData, GraphWorkflowUpdateData } from '../types/moduleGraph'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

function parseWorkflowRecord(record: any) {
  return {
    ...record,
    graph: record.graph_json ? JSON.parse(record.graph_json) : { nodes: [], edges: [] },
  }
}

function decorateExecutionRecord(record: any) {
  return {
    ...record,
    ...GraphWorkflowExecutionQueue.getExecutionRuntimeState(record.id),
  }
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active === 'true'
    const workflows = GraphWorkflowModel.findAll(activeOnly).map(parseWorkflowRecord)
    return res.json({ success: true, data: workflows } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph workflows:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph workflows' } as ModuleGraphResponse)
  }
}))

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid graph workflow ID' } as ModuleGraphResponse)
  }

  try {
    const workflow = GraphWorkflowModel.findById(id)
    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: parseWorkflowRecord(workflow) } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph workflow:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph workflow' } as ModuleGraphResponse)
  }
}))

router.get('/:id/executions', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid graph workflow ID' } as ModuleGraphResponse)
  }

  try {
    const executions = GraphExecutionModel.findByWorkflow(id).map(decorateExecutionRecord)
    return res.json({ success: true, data: executions } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph executions:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph executions' } as ModuleGraphResponse)
  }
}))

router.get('/executions/:executionId', asyncHandler(async (req: Request, res: Response) => {
  const executionId = parseInt(routeParam(routeParam(req.params.executionId)))
  if (isNaN(executionId)) {
    return res.status(400).json({ success: false, error: 'Invalid execution ID' } as ModuleGraphResponse)
  }

  try {
    const execution = GraphExecutionModel.findById(executionId)
    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' } as ModuleGraphResponse)
    }

    const artifacts = GraphExecutionArtifactModel.findByExecution(executionId)
    const logs = GraphExecutionLogModel.findByExecution(executionId)
    return res.json({ success: true, data: { execution: decorateExecutionRecord(execution), artifacts, logs } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error getting graph execution:', error)
    return res.status(500).json({ success: false, error: 'Failed to get graph execution' } as ModuleGraphResponse)
  }
}))

router.post('/:id/execute', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid graph workflow ID' } as ModuleGraphResponse)
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
  const id = parseInt(routeParam(routeParam(req.params.id)))
  const nodeId = routeParam(req.params.nodeId)
  if (isNaN(id) || !nodeId) {
    return res.status(400).json({ success: false, error: 'Invalid graph workflow or node ID' } as ModuleGraphResponse)
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
  const executionId = parseInt(routeParam(routeParam(req.params.executionId)))
  if (isNaN(executionId)) {
    return res.status(400).json({ success: false, error: 'Invalid execution ID' } as ModuleGraphResponse)
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

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, graph, version, is_active } = req.body
  if (!name || !graph) {
    return res.status(400).json({ success: false, error: 'name and graph are required' } as ModuleGraphResponse)
  }

  try {
    const createData: GraphWorkflowCreateData = {
      name,
      description,
      graph,
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
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid graph workflow ID' } as ModuleGraphResponse)
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
      version: req.body.version,
      is_active: req.body.is_active,
    }

    const updated = GraphWorkflowModel.update(id, updateData)
    return res.json({ success: updated, data: { id, message: updated ? 'Graph workflow updated successfully' : 'No changes applied' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error updating graph workflow:', error)
    return res.status(500).json({ success: false, error: 'Failed to update graph workflow' } as ModuleGraphResponse)
  }
}))

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid graph workflow ID' } as ModuleGraphResponse)
  }

  try {
    const deleted = GraphWorkflowModel.delete(id)
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: { message: 'Graph workflow deleted successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error deleting graph workflow:', error)
    return res.status(500).json({ success: false, error: 'Failed to delete graph workflow' } as ModuleGraphResponse)
  }
}))

export const graphWorkflowRoutes = router
export default router

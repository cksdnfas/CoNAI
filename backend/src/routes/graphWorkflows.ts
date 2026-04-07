import fs from 'fs'
import path from 'path'
import { Router, Request, Response } from 'express'
import { routeParam } from './routeParam'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { runtimePaths } from '../config/runtimePaths'
import { GraphWorkflowExecutionQueue } from '../services/graphWorkflowExecutionQueue'
import { WatchedFolderService } from '../services/watchedFolderService'
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

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function resolveUniqueCopyTargetPath(targetFolderPath: string, fileName: string) {
  const parsed = path.parse(fileName || 'artifact')
  const safeBaseName = parsed.name || 'artifact'
  const extension = parsed.ext || ''
  let attempt = 0

  while (true) {
    const candidateName = attempt === 0 ? `${safeBaseName}${extension}` : `${safeBaseName} (${attempt})${extension}`
    const candidatePath = path.join(targetFolderPath, candidateName)

    try {
      await fs.promises.access(candidatePath, fs.constants.F_OK)
      attempt += 1
    } catch {
      return candidatePath
    }
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

router.get('/browse-content', asyncHandler(async (req: Request, res: Response) => {
  const folderIdParam = typeof req.query.folder_id === 'string' ? Number(req.query.folder_id) : null
  const folderId = folderIdParam !== null && Number.isFinite(folderIdParam) ? folderIdParam : null

  if (folderId !== null && !GraphWorkflowFolderModel.findById(folderId)) {
    return res.status(404).json({ success: false, error: 'Graph workflow folder not found' } as ModuleGraphResponse)
  }

  try {
    const folderScopeIds = folderId !== null ? GraphWorkflowFolderModel.getSubtreeFolderIds(folderId) : []
    const workflows = folderId !== null
      ? GraphWorkflowModel.findByFolderIds(folderScopeIds, true).map(parseWorkflowRecord)
      : GraphWorkflowModel.findAll(true).map(parseWorkflowRecord)
    const workflowIds = workflows.map((workflow) => workflow.id)
    const executions = GraphExecutionModel.findByWorkflowIds(workflowIds, 300).map(decorateExecutionRecord)
    const executionIds = executions.map((execution) => execution.id)
    const artifacts = GraphExecutionArtifactModel.findByExecutionIds(executionIds)
    const finalResults = GraphExecutionFinalResultModel.findByExecutionIds(executionIds)
    const artifactCountByExecution = artifacts.reduce<Record<number, number>>((acc, artifact) => {
      acc[artifact.execution_id] = (acc[artifact.execution_id] ?? 0) + 1
      return acc
    }, {})
    const finalResultCountByExecution = finalResults.reduce<Record<number, number>>((acc, result) => {
      acc[result.execution_id] = (acc[result.execution_id] ?? 0) + 1
      return acc
    }, {})
    const emptyExecutions = executions.filter((execution) => (artifactCountByExecution[execution.id] ?? 0) === 0 && (finalResultCountByExecution[execution.id] ?? 0) === 0)

    return res.json({
      success: true,
      data: {
        scope: {
          folder_id: folderId,
          folder_ids: folderId !== null ? folderScopeIds : null,
          workflow_count: workflows.length,
          execution_count: executions.length,
          artifact_count: artifacts.length,
          final_result_count: finalResults.length,
          empty_execution_count: emptyExecutions.length,
        },
        workflows,
        executions,
        artifacts,
        final_results: finalResults,
        empty_executions: emptyExecutions,
      },
    } as ModuleGraphResponse)
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
    return res.status(400).json({ success: false, error: 'name is required' } as ModuleGraphResponse)
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
  const id = parseInt(routeParam(routeParam(req.params.id)))
  const existingFolder = !isNaN(id) ? GraphWorkflowFolderModel.findById(id) : null
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : undefined
  const parentId = typeof req.body?.parent_id === 'number' ? req.body.parent_id : req.body?.parent_id === null ? null : undefined

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid folder ID' } as ModuleGraphResponse)
  }

  if (!existingFolder) {
    return res.status(404).json({ success: false, error: 'Graph workflow folder not found' } as ModuleGraphResponse)
  }

  if (name !== undefined && !name) {
    return res.status(400).json({ success: false, error: 'name is required' } as ModuleGraphResponse)
  }

  if (parentId !== undefined) {
    if (parentId === id) {
      return res.status(400).json({ success: false, error: 'Folder cannot be its own parent' } as ModuleGraphResponse)
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
      return res.status(400).json({ success: false, error: 'No folder changes detected' } as ModuleGraphResponse)
    }

    return res.json({ success: true, data: { message: 'Graph workflow folder updated successfully' } } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error updating graph workflow folder:', error)
    return res.status(500).json({ success: false, error: 'Failed to update graph workflow folder' } as ModuleGraphResponse)
  }
}))

router.delete('/folders/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  const deleteMode = req.query.mode === 'delete_tree' ? 'delete_tree' : 'move_children'

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid folder ID' } as ModuleGraphResponse)
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
    const finalResults = GraphExecutionFinalResultModel.findByExecution(executionId)
    const logs = GraphExecutionLogModel.findByExecution(executionId)
    return res.json({ success: true, data: { execution: decorateExecutionRecord(execution), artifacts, final_results: finalResults, logs } } as ModuleGraphResponse)
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

router.post('/executions/cleanup-empty', asyncHandler(async (req: Request, res: Response) => {
  const executionIds: number[] = Array.isArray(req.body?.execution_ids)
    ? Array.from(new Set<number>(req.body.execution_ids
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isFinite(value))))
    : []

  if (executionIds.length === 0) {
    return res.status(400).json({ success: false, error: 'execution_ids is required' } as ModuleGraphResponse)
  }

  try {
    const executions = GraphExecutionModel.findByIds(executionIds).map(decorateExecutionRecord)
    const foundExecutionIds = new Set(executions.map((execution) => execution.id))
    const missing = executionIds.filter((executionId) => !foundExecutionIds.has(executionId))
    const existingExecutionIds = executions.map((execution) => execution.id)
    const artifacts = GraphExecutionArtifactModel.findByExecutionIds(existingExecutionIds)
    const finalResults = GraphExecutionFinalResultModel.findByExecutionIds(existingExecutionIds)
    const artifactCountByExecution = artifacts.reduce<Record<number, number>>((acc, artifact) => {
      acc[artifact.execution_id] = (acc[artifact.execution_id] ?? 0) + 1
      return acc
    }, {})
    const finalResultCountByExecution = finalResults.reduce<Record<number, number>>((acc, result) => {
      acc[result.execution_id] = (acc[result.execution_id] ?? 0) + 1
      return acc
    }, {})

    const deletableExecutionIds: number[] = []
    const skipped: Array<{ execution_id: number; reason: string }> = []

    for (const execution of executions) {
      if ((artifactCountByExecution[execution.id] ?? 0) > 0 || (finalResultCountByExecution[execution.id] ?? 0) > 0) {
        skipped.push({ execution_id: execution.id, reason: 'Execution has outputs and is not empty' })
        continue
      }

      if (execution.status === 'queued' || execution.status === 'running') {
        skipped.push({ execution_id: execution.id, reason: 'Active executions must be cancelled before cleanup' })
        continue
      }

      deletableExecutionIds.push(execution.id)
    }

    GraphExecutionLogModel.deleteByExecutionIds(deletableExecutionIds)
    const deletedCount = GraphExecutionModel.deleteByIds(deletableExecutionIds)

    return res.json({
      success: true,
      data: {
        requested_count: executionIds.length,
        deleted_count: deletedCount,
        missing,
        deleted_execution_ids: deletableExecutionIds,
        skipped,
      },
    } as ModuleGraphResponse)
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
    return res.status(400).json({ success: false, error: 'folder_id is required' } as ModuleGraphResponse)
  }

  if (sourcePaths.length === 0) {
    return res.status(400).json({ success: false, error: 'source_paths is required' } as ModuleGraphResponse)
  }

  try {
    const watchedFolder = await WatchedFolderService.getFolder(folderId)
    if (!watchedFolder) {
      return res.status(404).json({ success: false, error: 'Watched folder not found' } as ModuleGraphResponse)
    }

    const targetFolderPath = path.resolve(watchedFolder.folder_path)
    const graphExecutionTempRoot = path.resolve(runtimePaths.tempDir, 'graph-executions')
    await fs.promises.mkdir(targetFolderPath, { recursive: true })

    const copied: Array<{ source_path: string; target_path: string }> = []
    const skipped: Array<{ source_path: string; reason: string }> = []

    for (const sourcePath of sourcePaths) {
      const resolvedSourcePath = path.resolve(sourcePath)

      if (!isPathInsideRoot(graphExecutionTempRoot, resolvedSourcePath)) {
        skipped.push({ source_path: sourcePath, reason: 'Source path is outside the graph execution temp root' })
        continue
      }

      let sourceStat: fs.Stats
      try {
        sourceStat = await fs.promises.stat(resolvedSourcePath)
      } catch {
        skipped.push({ source_path: sourcePath, reason: 'Source file does not exist' })
        continue
      }

      if (!sourceStat.isFile()) {
        skipped.push({ source_path: sourcePath, reason: 'Source path is not a file' })
        continue
      }

      const targetPath = await resolveUniqueCopyTargetPath(targetFolderPath, path.basename(resolvedSourcePath))
      await fs.promises.copyFile(resolvedSourcePath, targetPath)
      copied.push({ source_path: resolvedSourcePath, target_path: targetPath })
    }

    return res.json({
      success: true,
      data: {
        folder_id: watchedFolder.id,
        folder_name: watchedFolder.folder_name ?? path.basename(targetFolderPath),
        folder_path: targetFolderPath,
        copied_count: copied.length,
        skipped_count: skipped.length,
        copied,
        skipped,
      },
    } as ModuleGraphResponse)
  } catch (error) {
    console.error('Error copying graph workflow artifacts to watched folder:', error)
    return res.status(500).json({ success: false, error: 'Failed to copy graph workflow artifacts to watched folder' } as ModuleGraphResponse)
  }
}))

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, graph, folder_id, version, is_active } = req.body
  if (!name || !graph) {
    return res.status(400).json({ success: false, error: 'name and graph are required' } as ModuleGraphResponse)
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
      folder_id: typeof req.body.folder_id === 'number' ? req.body.folder_id : req.body.folder_id === null ? null : undefined,
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

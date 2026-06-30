import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphExecutionNodeIoModel } from '../models/GraphExecutionNodeIo'
import { deleteFile as recycleBinDeleteFile } from '../utils/recycleBin'
import { settingsService } from './settingsService'

const RETENTION_FILE_DELETE_YIELD_INTERVAL = 50

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function cleanupEmptyRetiredExecutions(executionIds: number[]) {
  const executions = GraphExecutionModel.findByIds(executionIds)
  const existingExecutionIds = executions.map((execution) => execution.id)
  const artifacts = GraphExecutionArtifactModel.findByExecutionIds(existingExecutionIds)
  const finalResults = GraphExecutionFinalResultModel.findByExecutionIds(existingExecutionIds)
  const nonEmptyExecutionIds = new Set([
    ...artifacts.map((artifact) => artifact.execution_id),
    ...finalResults.map((result) => result.execution_id),
  ])
  const deletableExecutionIds = executions
    .filter((execution) => execution.status !== 'queued' && execution.status !== 'running')
    .filter((execution) => !nonEmptyExecutionIds.has(execution.id))
    .map((execution) => execution.id)

  GraphExecutionLogModel.deleteByExecutionIds(deletableExecutionIds)
  GraphExecutionNodeIoModel.deleteByExecutionIds(deletableExecutionIds)
  return GraphExecutionModel.deleteByIds(deletableExecutionIds)
}

export async function deleteRetiredGraphWorkflowArtifacts(artifactIds: number[]) {
  if (artifactIds.length === 0) {
    return { deleted_count: 0, deleted_file_count: 0, deleted_execution_count: 0 }
  }

  const artifacts = GraphExecutionArtifactModel.findByIds(artifactIds)
  const executionById = new Map(GraphExecutionModel.findByIds(Array.from(new Set(artifacts.map((artifact) => artifact.execution_id)))).map((execution) => [execution.id, execution]))
  const graphExecutionTempRoot = path.resolve(runtimePaths.tempDir, 'graph-executions')
  const useRecycleBin = settingsService.loadSettings().general.deleteProtection.enabled
  let deletedFileCount = 0

  const deletableArtifacts = artifacts.filter((artifact) => {
    const execution = executionById.get(artifact.execution_id)
    return execution?.status !== 'queued' && execution?.status !== 'running'
  })

  for (let index = 0; index < deletableArtifacts.length; index += 1) {
    const artifact = deletableArtifacts[index]
    if (index > 0 && index % RETENTION_FILE_DELETE_YIELD_INTERVAL === 0) {
      await yieldToEventLoop()
    }

    if (!artifact.storage_path) {
      continue
    }

    const resolvedPath = path.resolve(artifact.storage_path)
    if (!isPathInsideRoot(graphExecutionTempRoot, resolvedPath)) {
      continue
    }

    try {
      await recycleBinDeleteFile(resolvedPath, useRecycleBin)
      deletedFileCount += 1
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        console.warn('[GraphWorkflowOutputRetention] Failed to delete retired artifact file:', artifact.storage_path)
      }
    }
  }

  GraphExecutionFinalResultModel.deleteBySourceArtifactIds(deletableArtifacts.map((artifact) => artifact.id))
  const deletedCount = GraphExecutionArtifactModel.deleteByIds(deletableArtifacts.map((artifact) => artifact.id))
  const deletedExecutionCount = cleanupEmptyRetiredExecutions(Array.from(new Set(deletableArtifacts.map((artifact) => artifact.execution_id))))

  return {
    deleted_count: deletedCount,
    deleted_file_count: deletedFileCount,
    deleted_execution_count: deletedExecutionCount,
  }
}

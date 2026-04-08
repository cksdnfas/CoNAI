import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionModel } from '../models/GraphExecution'
import { WatchedFolderService } from './watchedFolderService'
import { decorateGraphExecutionRecord } from './graphWorkflowViewService'

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Resolve a collision-safe target path inside one watched folder. */
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

/** Delete finished output-less executions and keep non-empty or active ones. */
export function cleanupEmptyGraphExecutions(executionIds: number[]) {
  const executions = GraphExecutionModel.findByIds(executionIds).map(decorateGraphExecutionRecord)
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

  return {
    requested_count: executionIds.length,
    deleted_count: deletedCount,
    missing,
    deleted_execution_ids: deletableExecutionIds,
    skipped,
  }
}

/** Delete artifact rows and best-effort temp files for one artifact id set. */
export async function deleteGraphExecutionArtifacts(artifactIds: number[]) {
  const artifacts = GraphExecutionArtifactModel.findByIds(artifactIds)
  const foundArtifactIds = new Set(artifacts.map((artifact) => artifact.id))
  const missing = artifactIds.filter((artifactId) => !foundArtifactIds.has(artifactId))
  const graphExecutionTempRoot = path.resolve(runtimePaths.tempDir, 'graph-executions')
  const deletedFiles: string[] = []
  const skippedFiles: Array<{ artifact_id: number; path: string; reason: string }> = []

  for (const artifact of artifacts) {
    if (!artifact.storage_path) {
      continue
    }

    const resolvedPath = path.resolve(artifact.storage_path)
    if (!isPathInsideRoot(graphExecutionTempRoot, resolvedPath)) {
      skippedFiles.push({ artifact_id: artifact.id, path: artifact.storage_path, reason: 'Artifact file is outside the graph execution temp root' })
      continue
    }

    try {
      await fs.promises.unlink(resolvedPath)
      deletedFiles.push(resolvedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        skippedFiles.push({ artifact_id: artifact.id, path: artifact.storage_path, reason: 'Failed to delete artifact file' })
      }
    }
  }

  GraphExecutionFinalResultModel.deleteBySourceArtifactIds(artifacts.map((artifact) => artifact.id))
  const deletedCount = GraphExecutionArtifactModel.deleteByIds(artifacts.map((artifact) => artifact.id))

  return {
    requested_count: artifactIds.length,
    deleted_count: deletedCount,
    missing,
    deleted_artifact_ids: artifacts.map((artifact) => artifact.id),
    deleted_file_count: deletedFiles.length,
    skipped_files: skippedFiles,
  }
}

/** Copy generated workflow artifacts into one watched folder target. */
export async function copyGraphWorkflowArtifactsToWatchedFolder(folderId: number, sourcePaths: string[]) {
  const watchedFolder = await WatchedFolderService.getFolder(folderId)
  if (!watchedFolder) {
    return null
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

  return {
    folder_id: watchedFolder.id,
    folder_name: watchedFolder.folder_name ?? path.basename(targetFolderPath),
    folder_path: targetFolderPath,
    copied_count: copied.length,
    skipped_count: skipped.length,
    copied,
    skipped,
  }
}

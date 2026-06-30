import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionNodeIoModel } from '../models/GraphExecutionNodeIo'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord, GraphWorkflowRecord } from '../types/moduleGraph'
import { deleteFile as recycleBinDeleteFile } from '../utils/recycleBin'
import { settingsService } from './settingsService'
import { WatchedFolderService } from './watchedFolderService'
import { BackgroundProcessorService } from './backgroundProcessorService'
import { FileDiscoveryService } from './folderScan/fileDiscoveryService'
import { decorateGraphExecutionRecords } from './graphWorkflowViewService'

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const DELETE_ARTIFACT_BATCH_SIZE = 500

const GRAPH_ARTIFACT_MEDIA_EXTENSION_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
}

function chunkIds(ids: number[], chunkSize = DELETE_ARTIFACT_BATCH_SIZE) {
  const chunks: number[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
}

function parseArtifactMetadataRecord(value?: string | null) {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function inferArtifactMimeTypeFromPath(storagePath?: string | null) {
  if (!storagePath) {
    return null
  }

  const normalized = storagePath.replace(/\\/g, '/').toLowerCase()
  const lastDotIndex = normalized.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return null
  }

  return GRAPH_ARTIFACT_MEDIA_EXTENSION_MIME_MAP[normalized.slice(lastDotIndex)] ?? null
}

function resolveArtifactMimeType(artifact: GraphExecutionArtifactRecord | GraphExecutionFinalResultRecord) {
  const metadataValue = (artifact as GraphExecutionFinalResultRecord).source_metadata ?? (artifact as GraphExecutionArtifactRecord).metadata
  const storagePath = (artifact as GraphExecutionFinalResultRecord).source_storage_path ?? (artifact as GraphExecutionArtifactRecord).storage_path
  const metadata = parseArtifactMetadataRecord(metadataValue)
  const metadataMimeType = typeof metadata?.mimeType === 'string'
    ? metadata.mimeType
    : (typeof metadata?.mime_type === 'string' ? metadata.mime_type : null)

  if (metadataMimeType?.trim()) {
    return metadataMimeType
  }

  if (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') {
    return inferArtifactMimeTypeFromPath(storagePath) ?? 'image/png'
  }

  return inferArtifactMimeTypeFromPath(storagePath)
}

function isVisualArtifact(artifact: GraphExecutionArtifactRecord | GraphExecutionFinalResultRecord) {
  const mimeType = resolveArtifactMimeType(artifact)
  if (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) {
    return true
  }

  return artifact.artifact_type === 'image'
}

function getWorkflowNameByExecutionId(workflows: GraphWorkflowRecord[]) {
  const workflowNameById = new Map(workflows.map((workflow) => [workflow.id, workflow.name]))
  const executions = GraphExecutionModel.findAllByWorkflowIds(workflows.map((workflow) => workflow.id))
  return new Map(executions.map((execution) => [execution.id, workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`]))
}

function matchesTechnicalArtifactFilter({
  artifact,
  workflowNameByExecutionId,
  artifactTypeFilter,
  searchTerm,
}: {
  artifact: GraphExecutionArtifactRecord
  workflowNameByExecutionId: Map<number, string>
  artifactTypeFilter?: string | null
  searchTerm?: string | null
}) {
  if (artifactTypeFilter && artifactTypeFilter !== 'all' && artifact.artifact_type !== artifactTypeFilter) {
    return false
  }

  const normalizedSearch = searchTerm?.trim().toLowerCase()
  if (!normalizedSearch) {
    return true
  }

  const haystack = [
    workflowNameByExecutionId.get(artifact.execution_id) ?? '',
    artifact.artifact_type,
    artifact.port_key,
    artifact.metadata ?? '',
    artifact.storage_path ?? '',
  ].join(' ').toLowerCase()

  return haystack.includes(normalizedSearch)
}

function resolveWorkflowScope(folderId: number | null) {
  const folderScopeIds = folderId !== null ? GraphWorkflowFolderModel.getSubtreeFolderIds(folderId) : []
  return folderId !== null
    ? GraphWorkflowModel.findByFolderIds(folderScopeIds, true)
    : GraphWorkflowModel.findAll(true)
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
  const executions = decorateGraphExecutionRecords(GraphExecutionModel.findByIds(executionIds))
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
  GraphExecutionNodeIoModel.deleteByExecutionIds(deletableExecutionIds)
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
  const executionById = new Map(GraphExecutionModel.findByIds(Array.from(new Set(artifacts.map((artifact) => artifact.execution_id)))).map((execution) => [execution.id, execution]))
  const settings = settingsService.loadSettings()
  const useRecycleBin = settings.general.deleteProtection.enabled
  const deletedFiles: string[] = []
  const skippedFiles: Array<{ artifact_id: number; path: string; reason: string }> = []
  const deletableArtifacts = artifacts.filter((artifact) => {
    const execution = executionById.get(artifact.execution_id)
    if (execution?.status === 'queued' || execution?.status === 'running') {
      skippedFiles.push({
        artifact_id: artifact.id,
        path: artifact.storage_path ?? '',
        reason: 'Artifact belongs to an active execution',
      })
      return false
    }

    return true
  })

  for (const artifact of deletableArtifacts) {
    if (!artifact.storage_path) {
      continue
    }

    const resolvedPath = path.resolve(artifact.storage_path)
    if (!isPathInsideRoot(graphExecutionTempRoot, resolvedPath)) {
      skippedFiles.push({ artifact_id: artifact.id, path: artifact.storage_path, reason: 'Artifact file is outside the graph execution temp root' })
      continue
    }

    try {
      await recycleBinDeleteFile(resolvedPath, useRecycleBin)
      deletedFiles.push(resolvedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        skippedFiles.push({ artifact_id: artifact.id, path: artifact.storage_path, reason: 'Failed to delete artifact file' })
      }
    }
  }

  GraphExecutionFinalResultModel.deleteBySourceArtifactIds(deletableArtifacts.map((artifact) => artifact.id))
  const deletedCount = GraphExecutionArtifactModel.deleteByIds(deletableArtifacts.map((artifact) => artifact.id))
  const executionCleanup = cleanupEmptyGraphExecutions(Array.from(new Set(deletableArtifacts.map((artifact) => artifact.execution_id))))

  return {
    requested_count: artifactIds.length,
    deleted_count: deletedCount,
    missing,
    deleted_artifact_ids: deletableArtifacts.map((artifact) => artifact.id),
    deleted_file_count: deletedFiles.length,
    skipped_files: skippedFiles,
    execution_cleanup: executionCleanup,
  }
}

function mergeArtifactDeleteResults(results: Awaited<ReturnType<typeof deleteGraphExecutionArtifacts>>[]) {
  return results.reduce((acc, result) => {
    acc.requested_count += result.requested_count
    acc.deleted_count += result.deleted_count
    acc.missing.push(...result.missing)
    acc.deleted_artifact_ids.push(...result.deleted_artifact_ids)
    acc.deleted_file_count += result.deleted_file_count
    acc.skipped_files.push(...result.skipped_files)

    const cleanup = result.execution_cleanup
    if (cleanup) {
      acc.execution_cleanup.requested_count += cleanup.requested_count
      acc.execution_cleanup.deleted_count += cleanup.deleted_count
      acc.execution_cleanup.missing.push(...cleanup.missing)
      acc.execution_cleanup.deleted_execution_ids.push(...cleanup.deleted_execution_ids)
      acc.execution_cleanup.skipped.push(...cleanup.skipped)
    }

    return acc
  }, {
    requested_count: 0,
    deleted_count: 0,
    missing: [] as number[],
    deleted_artifact_ids: [] as number[],
    deleted_file_count: 0,
    skipped_files: [] as Array<{ artifact_id: number; path: string; reason: string }>,
    execution_cleanup: {
      requested_count: 0,
      deleted_count: 0,
      missing: [] as number[],
      deleted_execution_ids: [] as number[],
      skipped: [] as Array<{ execution_id: number; reason: string }>,
    },
  })
}

/** Delete every generated-output or technical artifact in one workflow browse scope. */
export async function deleteGraphWorkflowArtifactsInScope({
  folderId,
  kind,
  artifactTypeFilter,
  searchTerm,
}: {
  folderId: number | null
  kind: 'outputs' | 'artifacts'
  artifactTypeFilter?: string | null
  searchTerm?: string | null
}) {
  const workflows = resolveWorkflowScope(folderId)
  const workflowIds = workflows.map((workflow) => workflow.id)
  const artifacts = GraphExecutionArtifactModel.findByWorkflowIds(workflowIds)
  const finalResults = GraphExecutionFinalResultModel.findByWorkflowIds(workflowIds)
  const visualFinalResults = finalResults.filter((result) => isVisualArtifact(result))
  const executionIdsWithVisualFinalResults = new Set(visualFinalResults.map((result) => result.execution_id))
  const fallbackVisualArtifacts = artifacts.filter((artifact) => (
    isVisualArtifact(artifact) && !executionIdsWithVisualFinalResults.has(artifact.execution_id)
  ))
  const representedArtifactIds = new Set<number>([
    ...visualFinalResults.map((result) => result.source_artifact_id),
    ...fallbackVisualArtifacts.map((artifact) => artifact.id),
  ])
  const workflowNameByExecutionId = kind === 'artifacts'
    ? getWorkflowNameByExecutionId(workflows)
    : new Map<number, string>()

  const targetArtifactIds = kind === 'outputs'
    ? Array.from(representedArtifactIds)
    : artifacts
      .filter((artifact) => !representedArtifactIds.has(artifact.id))
      .filter((artifact) => matchesTechnicalArtifactFilter({
        artifact,
        workflowNameByExecutionId,
        artifactTypeFilter,
        searchTerm,
      }))
      .map((artifact) => artifact.id)

  const results = []
  for (const batch of chunkIds(targetArtifactIds)) {
    results.push(await deleteGraphExecutionArtifacts(batch))
  }

  return mergeArtifactDeleteResults(results)
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

    try {
      await BackgroundProcessorService.processSavedMediaFile(targetPath, {
        folderId: watchedFolder.id,
        mimeType: FileDiscoveryService.getMimeType(targetPath),
        quiet: true,
      })
    } catch (processingError) {
      console.warn(
        '[GraphWorkflowOutputManagement] Copied artifact but immediate media processing failed:',
        processingError instanceof Error ? processingError.message : processingError,
      )
    }

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

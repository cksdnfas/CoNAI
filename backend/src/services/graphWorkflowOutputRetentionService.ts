import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionLogModel } from '../models/GraphExecutionLog'
import { GraphExecutionModel } from '../models/GraphExecution'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord } from '../types/moduleGraph'
import { deleteFile as recycleBinDeleteFile } from '../utils/recycleBin'
import { settingsService } from './settingsService'

export const DEFAULT_GRAPH_WORKFLOW_OUTPUT_RETENTION_LIMIT = 200

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

function parseRetentionLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }

  return fallback
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

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function compareArtifactsNewestFirst(left: GraphExecutionArtifactRecord, right: GraphExecutionArtifactRecord) {
  const dateOrder = String(right.created_date ?? '').localeCompare(String(left.created_date ?? ''))
  return dateOrder !== 0 ? dateOrder : right.id - left.id
}

function sliceOverflowArtifactIds(artifacts: GraphExecutionArtifactRecord[], retentionLimit: number) {
  const safeLimit = Math.max(0, Math.floor(retentionLimit))
  if (safeLimit === 0) {
    return []
  }

  return artifacts
    .slice()
    .sort(compareArtifactsNewestFirst)
    .slice(safeLimit)
    .map((artifact) => artifact.id)
}

/** Resolve how many generated outputs and technical artifacts each graph workflow should retain. */
export function getGraphWorkflowOutputRetentionLimit() {
  return parseRetentionLimit(process.env.CONAI_GRAPH_WORKFLOW_OUTPUT_RETENTION_LIMIT, DEFAULT_GRAPH_WORKFLOW_OUTPUT_RETENTION_LIMIT)
}

/** Find graph workflow output/artifact rows outside the retained recent windows. */
export function findGraphWorkflowRetentionOverflowArtifactIds(workflowId: number, retentionLimit = getGraphWorkflowOutputRetentionLimit()) {
  const artifacts = GraphExecutionArtifactModel.findByWorkflowIds([workflowId])
  const finalResults = GraphExecutionFinalResultModel.findByWorkflowIds([workflowId])
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const visualFinalResults = finalResults.filter((result) => isVisualArtifact(result))
  const executionIdsWithVisualFinalResults = new Set(visualFinalResults.map((result) => result.execution_id))
  const fallbackVisualArtifacts = artifacts.filter((artifact) => (
    isVisualArtifact(artifact) && !executionIdsWithVisualFinalResults.has(artifact.execution_id)
  ))
  const outputArtifactIds = new Set<number>([
    ...visualFinalResults.map((result) => result.source_artifact_id),
    ...fallbackVisualArtifacts.map((artifact) => artifact.id),
  ])
  const generatedOutputArtifacts = Array.from(outputArtifactIds)
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact): artifact is GraphExecutionArtifactRecord => Boolean(artifact))
  const technicalArtifacts = artifacts.filter((artifact) => !outputArtifactIds.has(artifact.id))

  return {
    retention_limit: retentionLimit,
    generated_output_artifact_ids: sliceOverflowArtifactIds(generatedOutputArtifacts, retentionLimit),
    technical_artifact_ids: sliceOverflowArtifactIds(technicalArtifacts, retentionLimit),
  }
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
  return GraphExecutionModel.deleteByIds(deletableExecutionIds)
}

async function deleteRetiredArtifacts(artifactIds: number[]) {
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

  for (const artifact of deletableArtifacts) {
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

/** Prune old graph workflow generated outputs and technical/text artifact rows. */
export async function pruneGraphWorkflowOutputRetention(workflowId: number, retentionLimit = getGraphWorkflowOutputRetentionLimit()) {
  const overflow = findGraphWorkflowRetentionOverflowArtifactIds(workflowId, retentionLimit)
  const targetArtifactIds = Array.from(new Set([
    ...overflow.generated_output_artifact_ids,
    ...overflow.technical_artifact_ids,
  ]))
  const deletion = await deleteRetiredArtifacts(targetArtifactIds)

  return {
    ...overflow,
    requested_count: targetArtifactIds.length,
    ...deletion,
  }
}

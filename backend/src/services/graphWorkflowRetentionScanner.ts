import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord } from '../types/moduleGraph'

const RETENTION_SCAN_PAGE_SIZE = 1_000

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

function collectVisualFinalResultKeys(workflowId: number) {
  const sourceArtifactIds = new Set<number>()
  const executionIds = new Set<number>()
  let cursor: { created_date: string; id: number } | undefined

  while (true) {
    const page = GraphExecutionFinalResultModel.findByWorkflowIdPage(workflowId, RETENTION_SCAN_PAGE_SIZE, cursor)
    if (page.length === 0) {
      break
    }

    for (const result of page) {
      if (isVisualArtifact(result)) {
        sourceArtifactIds.add(result.source_artifact_id)
        executionIds.add(result.execution_id)
      }
    }

    const lastResult = page[page.length - 1]
    cursor = { created_date: lastResult.created_date, id: lastResult.id }
  }

  return { sourceArtifactIds, executionIds }
}

/** Find graph workflow output/artifact rows outside the retained recent windows. */
export function findGraphWorkflowRetentionOverflowArtifactIds(workflowId: number, retentionLimit: number) {
  const safeLimit = Math.max(0, Math.floor(retentionLimit))
  if (safeLimit === 0) {
    return {
      retention_limit: retentionLimit,
      generated_output_artifact_ids: [],
      technical_artifact_ids: [],
    }
  }

  const visualFinalResultKeys = collectVisualFinalResultKeys(workflowId)
  const generatedOutputArtifactIds: number[] = []
  const technicalArtifactIds: number[] = []
  let generatedOutputCount = 0
  let technicalArtifactCount = 0
  let cursor: { created_date: string; id: number } | undefined

  while (true) {
    const page = GraphExecutionArtifactModel.findByWorkflowIdPage(workflowId, RETENTION_SCAN_PAGE_SIZE, cursor)
    if (page.length === 0) {
      break
    }

    for (const artifact of page) {
      const isGeneratedOutput = visualFinalResultKeys.sourceArtifactIds.has(artifact.id)
        || (
          isVisualArtifact(artifact)
          && !visualFinalResultKeys.executionIds.has(artifact.execution_id)
        )

      if (isGeneratedOutput) {
        generatedOutputCount += 1
        if (generatedOutputCount > safeLimit) {
          generatedOutputArtifactIds.push(artifact.id)
        }
        continue
      }

      technicalArtifactCount += 1
      if (technicalArtifactCount > safeLimit) {
        technicalArtifactIds.push(artifact.id)
      }
    }

    const lastArtifact = page[page.length - 1]
    cursor = { created_date: lastArtifact.created_date, id: lastArtifact.id }
  }

  return {
    retention_limit: retentionLimit,
    generated_output_artifact_ids: generatedOutputArtifactIds,
    technical_artifact_ids: technicalArtifactIds,
  }
}

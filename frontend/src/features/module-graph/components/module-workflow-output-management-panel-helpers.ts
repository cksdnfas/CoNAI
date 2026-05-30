import type {
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionRecord,
  GraphWorkflowBrowseContentRecord,
} from '@/lib/api-module-graph'
import type { ImageRecord } from '@/types/image'
import { buildArtifactTextPreview, getArtifactPreviewUrl, parseArtifactMetadataRecord, resolveGraphArtifactMimeType } from '../module-graph-shared'

export type ModuleWorkflowGeneratedOutputItem = {
  id: string
  sourceArtifactId: number
  type: string
  mimeType: string | null
  previewUrl: string | null
  downloadUrl: string | null
  downloadName: string
  createdDate: string
  workflowName: string
  executionId: number
  storagePath: string | null
  label: string
  status?: GraphExecutionRecord['status']
}

function buildDownloadName(path: string | null | undefined, fallbackLabel: string, executionId: number) {
  // Derive a stable download file name from the storage path or artifact label.
  if (path) {
    const normalized = path.replace(/\\/g, '/')
    const baseName = normalized.split('/').pop()
    if (baseName && baseName.trim().length > 0) {
      return baseName
    }
  }

  const sanitizedLabel = fallbackLabel.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'
  return `execution-${executionId}-${sanitizedLabel}`
}

function getArtifactLabel(artifact: GraphExecutionArtifactRecord | GraphExecutionFinalResultRecord) {
  // Pick the most helpful display label from metadata before falling back to the artifact type.
  const rawMetadata = 'source_metadata' in artifact
    ? artifact.source_metadata
    : ('metadata' in artifact ? artifact.metadata : null)
  const metadata = parseArtifactMetadataRecord(rawMetadata)
  if (metadata) {
    const candidate = metadata.label ?? metadata.kind ?? metadata.mimeType
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }

  return artifact.artifact_type
}

function isVisualArtifact(artifact: GraphExecutionArtifactRecord | GraphExecutionFinalResultRecord) {
  // Identify artifacts that belong in the generated outputs surface.
  const mimeType = resolveGraphArtifactMimeType(artifact)
  if (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) {
    return true
  }

  return artifact.artifact_type === 'image' || artifact.artifact_type === 'mask'
}

function getWorkflowNameForExecution(
  executionId: number,
  executionById: Map<number, GraphExecutionRecord>,
  workflowNameById: Map<number, string>,
) {
  // Resolve the workflow label shown beside an execution-backed item.
  const execution = executionById.get(executionId)
  if (!execution) {
    return { execution: null, workflowName: 'Unknown workflow' }
  }

  return {
    execution,
    workflowName: workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`,
  }
}

function buildOutputImageRecord(item: ModuleWorkflowGeneratedOutputItem): ImageRecord {
  // Adapt generated output items to the shared image-list record shape.
  const mimeType = item.mimeType
  const fileType = mimeType?.startsWith('video/')
    ? 'video'
    : mimeType === 'image/gif'
      ? 'animated'
      : 'image'

  return {
    id: item.id,
    composite_hash: null,
    original_file_path: item.storagePath ?? item.downloadName,
    thumbnail_url: item.previewUrl,
    image_url: item.downloadUrl,
    mime_type: mimeType,
    file_type: fileType,
  }
}

export function buildModuleWorkflowOutputCollections({
  browseContent,
  executionById,
  workflowNameById,
}: {
  browseContent: GraphWorkflowBrowseContentRecord
  executionById: Map<number, GraphExecutionRecord>
  workflowNameById: Map<number, string>
}) {
  // Build the browse-ready output and technical artifact collections from raw workflow content.
  const visualFinalResults = browseContent.final_results.filter((result) => isVisualArtifact(result))
  const executionIdsWithVisualFinalResults = new Set(visualFinalResults.map((result) => result.execution_id))
  const fallbackVisualArtifacts = browseContent.artifacts.filter((artifact) => (
    isVisualArtifact(artifact) && !executionIdsWithVisualFinalResults.has(artifact.execution_id)
  ))

  const outputItems: ModuleWorkflowGeneratedOutputItem[] = [
    ...visualFinalResults.map((result) => {
      const { execution, workflowName } = getWorkflowNameForExecution(result.execution_id, executionById, workflowNameById)
      const downloadUrl = getArtifactPreviewUrl(result)
      const label = getArtifactLabel(result)
      return {
        id: `final-${result.id}`,
        sourceArtifactId: result.source_artifact_id,
        type: result.artifact_type,
        mimeType: resolveGraphArtifactMimeType(result),
        previewUrl: downloadUrl,
        downloadUrl,
        downloadName: buildDownloadName(result.source_storage_path, label, result.execution_id),
        createdDate: result.created_date,
        workflowName,
        executionId: result.execution_id,
        storagePath: result.source_storage_path ?? null,
        label,
        status: execution?.status,
      }
    }),
    ...fallbackVisualArtifacts.map((artifact) => {
      const { execution, workflowName } = getWorkflowNameForExecution(artifact.execution_id, executionById, workflowNameById)
      const downloadUrl = getArtifactPreviewUrl(artifact)
      const label = getArtifactLabel(artifact)
      return {
        id: `artifact-${artifact.id}`,
        sourceArtifactId: artifact.id,
        type: artifact.artifact_type,
        mimeType: resolveGraphArtifactMimeType(artifact),
        previewUrl: downloadUrl,
        downloadUrl,
        downloadName: buildDownloadName(artifact.storage_path, label, artifact.execution_id),
        createdDate: artifact.created_date,
        workflowName,
        executionId: artifact.execution_id,
        storagePath: artifact.storage_path ?? null,
        label,
        status: execution?.status,
      }
    }),
  ].sort((left, right) => new Date(right.createdDate).getTime() - new Date(left.createdDate).getTime())

  const representedArtifactIds = new Set<number>([
    ...visualFinalResults.map((result) => result.source_artifact_id),
    ...fallbackVisualArtifacts.map((artifact) => artifact.id),
  ])

  const technicalArtifacts = [...browseContent.artifacts]
    .filter((artifact) => !representedArtifactIds.has(artifact.id))
    .sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())

  return {
    outputItems,
    outputImageItems: outputItems.map(buildOutputImageRecord),
    technicalArtifacts,
  }
}

export function listModuleWorkflowArtifactTypes(artifacts: GraphExecutionArtifactRecord[]) {
  // List the distinct technical artifact types shown by the artifact filter.
  return Array.from(new Set(artifacts.map((artifact) => artifact.artifact_type))).sort((left, right) => left.localeCompare(right, 'en'))
}

export function filterModuleWorkflowTechnicalArtifacts({
  artifacts,
  artifactSearchTerm,
  artifactTypeFilter,
  executionById,
  workflowNameById,
}: {
  artifacts: GraphExecutionArtifactRecord[]
  artifactSearchTerm: string
  artifactTypeFilter: string
  executionById: Map<number, GraphExecutionRecord>
  workflowNameById: Map<number, string>
}) {
  // Apply the panel's search and type filters to technical artifacts.
  const normalizedSearch = artifactSearchTerm.trim().toLowerCase()

  return artifacts.filter((artifact) => {
    if (artifactTypeFilter !== 'all' && artifact.artifact_type !== artifactTypeFilter) {
      return false
    }

    if (!normalizedSearch) {
      return true
    }

    const { workflowName } = getWorkflowNameForExecution(artifact.execution_id, executionById, workflowNameById)
    const previewText = buildArtifactTextPreview(artifact, 220) ?? ''
    const haystack = [
      workflowName,
      artifact.artifact_type,
      artifact.port_key,
      previewText,
      artifact.storage_path ?? '',
    ].join(' ').toLowerCase()

    return haystack.includes(normalizedSearch)
  })
}

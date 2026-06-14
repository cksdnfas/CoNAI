import { buildApiUrl } from '@/lib/api-client'
import type {
  GraphExecutionArtifactRecord,
  ModulePortDefinition,
} from '@/lib/api-module-graph'
import type { NodeArtifactGroupPreview } from './module-graph-types'

type GraphArtifactPreviewLike = {
  artifact_type: string
  storage_path?: string | null
  metadata?: string | null
  source_storage_path?: string | null
  source_metadata?: string | null
}

function getArtifactCompositeHash(metadata?: Record<string, unknown> | null) {
  const compositeHash = metadata?.actualCompositeHash
    ?? metadata?.actual_composite_hash
    ?? metadata?.compositeHash
    ?? metadata?.composite_hash
  return typeof compositeHash === 'string' && compositeHash.trim().length > 0
    ? compositeHash.trim()
    : null
}

function getArtifactMetadataString(metadata: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value !== 'string') {
      continue
    }

    const trimmedValue = value.trim()
    if (trimmedValue) {
      return trimmedValue
    }
  }

  return null
}

function resolveGraphArtifactStoragePath(artifact: GraphArtifactPreviewLike, metadata: Record<string, unknown> | null) {
  return artifact.source_storage_path
    ?? artifact.storage_path
    ?? getArtifactMetadataString(metadata, ['storagePath', 'storage_path', 'outputPath', 'output_path', 'originalFilePath', 'original_file_path', 'filePath', 'file_path'])
}

/** Map a stored artifact path or media record reference back into a backend-served preview URL. */
export function getArtifactPreviewUrl(artifact: GraphArtifactPreviewLike) {
  const metadata = resolveGraphArtifactPreviewMetadata(artifact)
  const storagePath = resolveGraphArtifactStoragePath(artifact, metadata)
  const compositeHash = getArtifactCompositeHash(metadata)

  if (compositeHash) {
    return buildApiUrl(`/api/images/${encodeURIComponent(compositeHash)}/file`)
  }

  if (!storagePath) {
    return null
  }

  const normalized = storagePath.replace(/\\/g, '/')
  const graphExecutionMarker = '/graph-executions/'
  const graphExecutionMarkerIndex = normalized.lastIndexOf(graphExecutionMarker)
  if (graphExecutionMarkerIndex !== -1) {
    return buildApiUrl(`/temp${normalized.slice(graphExecutionMarkerIndex)}`)
  }

  const uploadsMarker = '/uploads/'
  const uploadsMarkerIndex = normalized.lastIndexOf(uploadsMarker)
  if (uploadsMarkerIndex !== -1) {
    return buildApiUrl(`/uploads/${normalized.slice(uploadsMarkerIndex + uploadsMarker.length)}`)
  }

  return null
}

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

/** Parse a JSON-ish metadata string into an inspectable value. */
export function parseMetadataValue(value?: string | null) {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return value
  }
}

/** Normalize artifact metadata into one object record when it stores structured fields. */
export function parseArtifactMetadataRecord(value?: string | null) {
  const metadata = parseMetadataValue(value)
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null
}

/** Merge source and artifact metadata so source fields fill sparse final-result rows without overriding artifact values. */
function resolveGraphArtifactPreviewMetadata(artifact: GraphArtifactPreviewLike) {
  const sourceMetadata = parseArtifactMetadataRecord(artifact.source_metadata)
  const artifactMetadata = parseArtifactMetadataRecord(artifact.metadata)

  if (sourceMetadata && artifactMetadata) {
    return { ...sourceMetadata, ...artifactMetadata }
  }

  return artifactMetadata ?? sourceMetadata
}

/** Infer one media MIME type from the stored artifact file extension. */
function inferArtifactMimeTypeFromPath(path?: string | null) {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const lastDotIndex = normalized.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return null
  }

  return GRAPH_ARTIFACT_MEDIA_EXTENSION_MIME_MAP[normalized.slice(lastDotIndex)] ?? null
}

/** Resolve the best available MIME type for one stored execution artifact or final-result source. */
export function resolveGraphArtifactMimeType(artifact: GraphArtifactPreviewLike) {
  const metadata = resolveGraphArtifactPreviewMetadata(artifact)
  const storagePath = resolveGraphArtifactStoragePath(artifact, metadata)
  const metadataMimeType = getArtifactMetadataString(metadata, ['mimeType', 'mime_type', 'outputMimeType', 'output_mime_type', 'contentType', 'content_type'])

  if (metadataMimeType?.trim()) {
    return metadataMimeType
  }

  if (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') {
    return inferArtifactMimeTypeFromPath(storagePath) ?? 'image/png'
  }

  return inferArtifactMimeTypeFromPath(storagePath)
}

/** Check whether one artifact should render through the shared inline media preview. */
export function isGraphArtifactVisualMedia(artifact: GraphArtifactPreviewLike) {
  const mimeType = resolveGraphArtifactMimeType(artifact)
  if (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) {
    return true
  }

  return artifact.artifact_type === 'image' || artifact.artifact_type === 'mask'
}

/** Check whether one execution artifact has a usable visual preview URL and media type. */
export function hasGraphArtifactVisualPreview(artifact: GraphExecutionArtifactRecord) {
  return Boolean(getArtifactPreviewUrl(artifact) && isGraphArtifactVisualMedia(artifact))
}

/** Recover the structured value payload stored inside one execution artifact metadata blob. */
export function getArtifactStoredValue(artifact: GraphExecutionArtifactRecord) {
  const parsedMetadata = parseMetadataValue(artifact.metadata)
  if (!parsedMetadata || typeof parsedMetadata !== 'object' || Array.isArray(parsedMetadata)) {
    return parsedMetadata
  }

  return 'value' in parsedMetadata ? parsedMetadata.value : parsedMetadata
}

/** Detect legacy LLM/Codex json artifacts that only carried a null placeholder in text mode. */
export function isEmptyLlmJsonArtifact(artifact: GraphExecutionArtifactRecord) {
  if (artifact.port_key !== 'json' || artifact.artifact_type !== 'json') {
    return false
  }

  const parsedMetadata = parseMetadataValue(artifact.metadata)
  if (!parsedMetadata || typeof parsedMetadata !== 'object' || Array.isArray(parsedMetadata)) {
    return false
  }

  return (parsedMetadata.kind === 'system-llm-json' || parsedMetadata.kind === 'system-codex-message-json')
    && ('value' in parsedMetadata)
    && (parsedMetadata.value === null || parsedMetadata.value === undefined)
}

/** Build the full readable text payload for prompt/text/json artifacts. */
export function buildArtifactTextValue(artifact: GraphExecutionArtifactRecord) {
  const storedValue = getArtifactStoredValue(artifact)
  if (storedValue === null || storedValue === undefined) {
    return null
  }

  if (typeof storedValue === 'string') {
    return storedValue.trim() || null
  }

  if (typeof storedValue === 'number' || typeof storedValue === 'boolean') {
    return String(storedValue)
  }

  return JSON.stringify(storedValue, null, 2)
}

/** Build a compact one-line text preview for prompt/text/json artifacts. */
export function buildArtifactTextPreview(artifact: GraphExecutionArtifactRecord, maxLength = 140) {
  const rawText = buildArtifactTextValue(artifact)
  if (!rawText) {
    return null
  }

  const normalizedText = rawText.replace(/\s+/g, ' ').trim()
  if (!normalizedText) {
    return null
  }

  return normalizedText.length > maxLength
    ? `${normalizedText.slice(0, maxLength - 1)}…`
    : normalizedText
}

/** Pick the most useful inline preview payload for one node artifact list. */
export function buildNodeArtifactPreview(artifacts: GraphExecutionArtifactRecord[]) {
  let primaryTextArtifact: GraphExecutionArtifactRecord | null = null
  let fallbackTextArtifact: GraphExecutionArtifactRecord | null = null
  let structuredTextArtifact: GraphExecutionArtifactRecord | null = null

  for (const artifact of artifacts) {
    if (isEmptyLlmJsonArtifact(artifact)) {
      continue
    }

    if (hasGraphArtifactVisualPreview(artifact)) {
      return {
        latestArtifactLabel: `${artifact.port_key} · ${artifact.artifact_type}`,
        latestArtifactPreviewUrl: getArtifactPreviewUrl(artifact),
        latestArtifactTextPreview: null,
        latestArtifactTextValue: null,
      }
    }

    if (artifact.port_key === 'metadata') {
      continue
    }

    if (!primaryTextArtifact && artifact.port_key === 'text' && artifact.artifact_type === 'text') {
      primaryTextArtifact = artifact
    }

    if (!fallbackTextArtifact && (artifact.artifact_type === 'prompt' || artifact.artifact_type === 'text')) {
      fallbackTextArtifact = artifact
    }

    if (!structuredTextArtifact && (artifact.artifact_type === 'json' || artifact.artifact_type === 'number' || artifact.artifact_type === 'boolean')) {
      structuredTextArtifact = artifact
    }
  }

  const latestTextArtifact = primaryTextArtifact ?? fallbackTextArtifact ?? structuredTextArtifact

  if (latestTextArtifact) {
    return {
      latestArtifactLabel: `${latestTextArtifact.port_key} · ${latestTextArtifact.artifact_type}`,
      latestArtifactPreviewUrl: null,
      latestArtifactTextPreview: buildArtifactTextPreview(latestTextArtifact),
      latestArtifactTextValue: buildArtifactTextValue(latestTextArtifact),
    }
  }

  return {
    latestArtifactLabel: null,
    latestArtifactPreviewUrl: null,
    latestArtifactTextPreview: null,
    latestArtifactTextValue: null,
  }
}

/** Keep rapid same-timestamp outputs newest-first across compact workflow result surfaces. */
export function compareGraphArtifactsNewestFirst(left: GraphExecutionArtifactRecord, right: GraphExecutionArtifactRecord) {
  const dateDelta = Date.parse(right.created_date) - Date.parse(left.created_date)
  if (Number.isFinite(dateDelta) && dateDelta !== 0) {
    return dateDelta
  }

  return right.id - left.id
}

/** Build compact per-port artifact previews so node cards can expose outputs without opening the results panel. */
export function buildNodeArtifactGroups(
  artifacts: GraphExecutionArtifactRecord[],
  outputPorts: ModulePortDefinition[],
): NodeArtifactGroupPreview[] {
  const outputPortMap = new Map(outputPorts.map((port, index) => [port.key, { port, index }]))
  const groupedArtifacts = new Map<string, GraphExecutionArtifactRecord[]>()

  for (const artifact of artifacts) {
    if (isEmptyLlmJsonArtifact(artifact)) {
      continue
    }

    const current = groupedArtifacts.get(artifact.port_key)
    if (current) {
      current.push(artifact)
    } else {
      groupedArtifacts.set(artifact.port_key, [artifact])
    }
  }

  return Array.from(groupedArtifacts.entries())
    .map(([portKey, portArtifacts]) => {
      const sortedArtifacts = [...portArtifacts].sort(compareGraphArtifactsNewestFirst)
      const artifactPreview = buildNodeArtifactPreview(sortedArtifacts)
      const outputPort = outputPortMap.get(portKey)?.port ?? null

      return {
        portKey,
        portLabel: outputPort?.label ?? portKey,
        portType: outputPort?.data_type ?? (sortedArtifacts[0]?.artifact_type === 'file' ? null : sortedArtifacts[0]?.artifact_type ?? null),
        artifactCount: sortedArtifacts.length,
        latestArtifactLabel: artifactPreview.latestArtifactLabel,
        latestArtifactPreviewUrl: artifactPreview.latestArtifactPreviewUrl,
        latestArtifactTextPreview: artifactPreview.latestArtifactTextPreview,
        latestArtifactTextValue: artifactPreview.latestArtifactTextValue,
      } satisfies NodeArtifactGroupPreview
    })
    .sort((left, right) => {
      const leftIndex = outputPortMap.get(left.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      const rightIndex = outputPortMap.get(right.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex
      }

      return left.portLabel.localeCompare(right.portLabel, 'ko')
    })
}

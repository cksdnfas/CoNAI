import { MarkerType } from '@xyflow/react'
import { buildApiUrl } from '@/lib/api-client'
import { applySavedWorkflowInputMetadataToNodes } from './module-graph-workflow-inputs'
import {
  getModuleBaseDisplayName,
  getModuleNodeDisplayLabel,
  getModuleOperationKey,
  getPortTypeColor,
} from './module-graph-module-helpers'
import type {
  ModuleGraphClipboardEdge,
  ModuleGraphClipboardNode,
  ModuleGraphClipboardPayload,
  ModuleGraphEdge,
  ModuleGraphNode,
  ModuleGraphNodeData,
  NodeArtifactGroupPreview,
} from './module-graph-types'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionStatus,
  GraphWorkflowMetadata,
  GraphWorkflowRecord,
  GraphWorkflowScheduleStatus,
  ModuleDefinitionRecord,
  ModulePortDataType,
  ModulePortDefinition,
} from '@/lib/api-module-graph'

export { normalizeOptionalString, parsePositiveIntegerish } from '@/lib/primitive-normalizers'
export {
  getModuleBaseDisplayName,
  getModuleColor,
  getModuleNodeDisplayLabel,
  getModuleNodeDisplayLabelFromData,
  getModuleOperationKey,
  getPortTypeColor,
  hasCustomModuleNodeLabel,
  isFinalResultModule,
  normalizeModulePortDescription,
} from './module-graph-module-helpers'
export type {
  ModuleGraphClipboardEdge,
  ModuleGraphClipboardNode,
  ModuleGraphClipboardPayload,
  ModuleGraphEdge,
  ModuleGraphNode,
  ModuleGraphNodeData,
  NodeArtifactGroupPreview,
} from './module-graph-types'

export const ADVANCED_OUTPUT_PORTS_ENABLED_KEY = '__advanced_output_ports_enabled'

function hasConfiguredGraphValue(value: unknown) {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0
  }

  return true
}

export function isAdvancedOutputPortsEnabled(inputValues: Record<string, unknown> | undefined) {
  return inputValues?.[ADVANCED_OUTPUT_PORTS_ENABLED_KEY] === true
}

/** Resolve whether one output port is secondary/debug-like enough to hide in normal node mode. */
function isAdvancedModuleOutputPort(module: ModuleDefinitionRecord, port: ModulePortDefinition, inputValues: Record<string, unknown> | undefined) {
  const operationKey = getModuleOperationKey(module)
  const hasStructuredOutput = hasConfiguredGraphValue(inputValues?.structured_output_json)

  if (operationKey === 'system.load_llm_preset') {
    return false
  }

  if (operationKey === 'system.call_llm' || operationKey === 'system.call_codex_message') {
    if (port.key === 'metadata') {
      return true
    }

    if (port.key === 'text') {
      return hasStructuredOutput
    }

    if (port.key === 'json') {
      return !hasStructuredOutput
    }
  }

  if (operationKey === 'system.json_extract') {
    return false
  }

  if (port.key === 'metadata' || port.key.endsWith('_ref') || port.key.endsWith('_json')) {
    return true
  }

  return false
}

export function hasAdvancedModuleOutputPorts(module: ModuleDefinitionRecord, inputValues: Record<string, unknown> | undefined) {
  return (module.output_ports ?? []).some((port) => isAdvancedModuleOutputPort(module, port, inputValues))
}

export function getVisibleModuleOutputPorts(
  module: ModuleDefinitionRecord,
  inputValues: Record<string, unknown> | undefined,
  options: {
    includeAdvanced?: boolean
    connectedInputKeys?: Iterable<string>
    connectedOutputKeys?: Iterable<string>
  } = {},
) {
  const operationKey = getModuleOperationKey(module)
  if (operationKey === 'system.load_llm_preset') {
    const activePortKey = inputValues?.preset_type === 'structuredOutputJsonPresets' ? 'json' : 'text'
    return (module.output_ports ?? []).filter((port) => port.key === activePortKey)
  }

  const connectedInputKeys = new Set(options.connectedInputKeys ?? [])
  const connectedOutputKeys = new Set(options.connectedOutputKeys ?? [])
  if (operationKey === 'system.call_llm' || operationKey === 'system.call_codex_message') {
    const hasStructuredOutput = hasConfiguredGraphValue(inputValues?.structured_output_json)
      || connectedInputKeys.has('structured_output_json')
    return (module.output_ports ?? []).filter((port) => {
      if (port.key === 'json') {
        return hasStructuredOutput || connectedOutputKeys.has(port.key)
      }

      if (port.key === 'text') {
        return !hasStructuredOutput || options.includeAdvanced === true || connectedOutputKeys.has(port.key)
      }

      if (port.key === 'metadata') {
        return options.includeAdvanced === true || connectedOutputKeys.has(port.key)
      }

      return true
    })
  }

  return (module.output_ports ?? []).filter((port) => {
    const isAdvanced = isAdvancedModuleOutputPort(module, port, inputValues)
    return !isAdvanced || options.includeAdvanced === true || connectedOutputKeys.has(port.key)
  })
}

/** Parse a React Flow handle id and recover the port key. */
export function parseHandleId(handleId?: string | null) {
  if (!handleId) {
    return null
  }

  const [direction, ...rest] = handleId.split(':')
  return {
    direction,
    portKey: rest.join(':'),
  }
}

/** Build a stable React Flow handle id for module ports. */
export function buildHandleId(direction: 'in' | 'out', portKey: string) {
  return `${direction}:${portKey}`
}

/** Build one stable node id for locally created editor nodes. */
export function createModuleGraphNodeId() {
  return `module-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Build one stable edge id for locally created editor edges. */
export function createModuleGraphEdgeId() {
  return `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Deep-clone graph input values so duplicated nodes never share mutable data. */
export function cloneModuleGraphValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  if (value === undefined) {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as T
}

/** Build one clipboard payload from the currently selected nodes and their internal edges. */
export function buildModuleGraphClipboardPayload(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[]): ModuleGraphClipboardPayload {
  const selectedNodeIds = new Set(nodes.map((node) => node.id))

  return {
    kind: 'conai/module-graph-selection',
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      moduleId: node.data.module.id,
      position: { x: node.position.x, y: node.position.y },
      label: node.data.label,
      disabled: node.data.disabled === true ? true : undefined,
      inputValues: cloneModuleGraphValue(node.data.inputValues || {}),
    })),
    edges: edges
      .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
  }
}

/** Serialize one graph-selection clipboard payload into plain text. */
export function serializeModuleGraphClipboardPayload(payload: ModuleGraphClipboardPayload) {
  return JSON.stringify(payload)
}

/** Parse one graph-selection clipboard payload from plain text when it matches this editor format. */
export function parseModuleGraphClipboardPayload(value: string): ModuleGraphClipboardPayload | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<ModuleGraphClipboardPayload>
    if (parsed.kind !== 'conai/module-graph-selection' || parsed.version !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null
    }

    const nodes = parsed.nodes.filter((node): node is ModuleGraphClipboardNode => (
      typeof node?.id === 'string'
      && typeof node?.moduleId === 'number'
      && typeof node?.position?.x === 'number'
      && typeof node?.position?.y === 'number'
      && (node.label === undefined || typeof node.label === 'string')
      && (node.disabled === undefined || typeof node.disabled === 'boolean')
      && typeof node.inputValues === 'object'
      && node.inputValues !== null
      && !Array.isArray(node.inputValues)
    ))

    const edges = parsed.edges.filter((edge): edge is ModuleGraphClipboardEdge => (
      typeof edge?.source === 'string'
      && typeof edge?.target === 'string'
      && (edge.sourceHandle === undefined || edge.sourceHandle === null || typeof edge.sourceHandle === 'string')
      && (edge.targetHandle === undefined || edge.targetHandle === null || typeof edge.targetHandle === 'string')
    ))

    if (nodes.length === 0 || nodes.length !== parsed.nodes.length || edges.length !== parsed.edges.length) {
      return null
    }

    return {
      kind: 'conai/module-graph-selection',
      version: 1,
      nodes,
      edges,
    }
  } catch {
    return null
  }
}

/** Format timestamps for compact execution history display. */
export function formatDateTime(value?: string | null) {
  if (!value) {
    return '시간 정보 없음'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const locale = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

const GRAPH_WORKFLOW_STOP_REASON_LABELS: Partial<Record<string, string>> = {
  manual_pause: '사용자가 예약작업을 일시정지했어.',
  workflow_changed: '워크플로우가 바뀌어서 다시 시작 전에 검토가 필요해.',
  workflow_missing: '연결된 워크플로우가 더 이상 없어.',
  execution_failed: '예약 실행에 실패했어.',
  overlap_detected: '이전 실행이 아직 대기 중이거나 실행 중일 때 다음 예약 시점이 도착했어.',
  max_run_count_reached: '최대 예약 횟수에 도달했어.',
  one_time_consumed: '1회 실행 예약이 이미 사용됐어.',
}

const GRAPH_WORKFLOW_ERROR_MESSAGE_LABELS: Record<string, string> = {
  'Workflow changed and schedule review is required before restart.': '워크플로우가 바뀌어서 다시 시작 전에 검토가 필요해.',
  'Linked workflow no longer exists.': '연결된 워크플로우가 더 이상 없어.',
  'Scheduled execution failed.': '예약 실행에 실패했어.',
  'The next scheduled run arrived while a prior run was still queued or running.': '이전 실행이 아직 대기 중이거나 실행 중일 때 다음 예약 시점이 도착했어.',
  'Maximum scheduled run count has been reserved or completed.': '최대 예약 횟수에 도달했어.',
  'One-time schedule has been consumed.': '1회 실행 예약이 이미 사용됐어.',
  'Schedule paused by user.': '사용자가 예약작업을 일시정지했어.',
  'Schedule paused.': '예약작업이 일시정지 상태야.',
  'Schedule created in paused state.': '예약작업이 일시정지 상태로 생성됐어.',
  'Queue job cancelled before ComfyUI output handoff completed': '취소 요청 뒤에 ComfyUI 결과 전달이 끝나기 전에 작업이 정리됐어.',
}

function looksMostlyEnglishMessage(value: string) {
  return /[A-Za-z]/.test(value) && !/[가-힣]/.test(value)
}

/** Resolve one localized label for graph workflow schedule status badges. */
export function getGraphWorkflowScheduleStatusLabel(status: GraphWorkflowScheduleStatus) {
  if (status === 'active') {
    return '활성'
  }
  if (status === 'paused') {
    return '일시정지'
  }
  if (status === 'error_stopped') {
    return '오류로 중지'
  }
  if (status === 'overlap_stopped') {
    return '중복으로 중지'
  }
  return '완료'
}

/** Resolve one localized label for graph execution status badges. */
export function getGraphExecutionStatusLabel(status: GraphExecutionStatus) {
  if (status === 'draft') {
    return '초안'
  }
  if (status === 'queued') {
    return '대기 중'
  }
  if (status === 'running') {
    return '실행 중'
  }
  if (status === 'completed') {
    return '완료'
  }
  if (status === 'failed') {
    return '실패'
  }
  return '취소됨'
}

/** Convert one graph workflow error string into Korean when the source is a known English backend message. */
export function localizeGraphWorkflowErrorMessage(message?: string | null, fallback = '오류가 발생했어.') {
  const trimmedMessage = typeof message === 'string' ? message.trim() : ''
  if (!trimmedMessage) {
    return null
  }

  const exactLabel = GRAPH_WORKFLOW_ERROR_MESSAGE_LABELS[trimmedMessage]
  if (exactLabel) {
    return exactLabel
  }

  if (looksMostlyEnglishMessage(trimmedMessage)) {
    return fallback
  }

  return trimmedMessage
}

/** Resolve one localized stop reason for workflow reservations, preferring stable reason codes. */
export function getGraphWorkflowStopReasonLabel(stopReasonCode?: string | null, stopReasonMessage?: string | null) {
  if (stopReasonCode && GRAPH_WORKFLOW_STOP_REASON_LABELS[stopReasonCode]) {
    if (stopReasonCode === 'execution_failed' && stopReasonMessage) {
      return localizeGraphWorkflowErrorMessage(stopReasonMessage, '예약 실행에 실패했어.')
    }

    return GRAPH_WORKFLOW_STOP_REASON_LABELS[stopReasonCode] ?? null
  }

  return localizeGraphWorkflowErrorMessage(stopReasonMessage, '예약작업이 중지됐어.')
}

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

/** Build per-node execution-order positions so large graphs avoid repeated array scans. */
export function buildNodeOrderIndex(orderedNodeIds: string[]): ReadonlyMap<string, number> {
  return new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]))
}

/** Resolve a compact node execution status from the selected execution detail. */
export function getNodeExecutionStatus(params: {
  nodeId: string
  orderedNodeIds: string[]
  nodeOrderIndex: ReadonlyMap<string, number>
  artifactNodeIds: Set<string>
  executionStatus: GraphExecutionStatus
  failedNodeId?: string | null
}): 'idle' | 'completed' | 'failed' | 'blocked' {
  const { nodeId, orderedNodeIds, nodeOrderIndex, artifactNodeIds, executionStatus, failedNodeId } = params

  if (artifactNodeIds.has(nodeId)) {
    return 'completed'
  }

  if (executionStatus !== 'failed') {
    return 'idle'
  }

  if (failedNodeId) {
    if (failedNodeId === nodeId) {
      return 'failed'
    }

    const failedIndex = nodeOrderIndex.get(failedNodeId) ?? -1
    const nodeIndex = nodeOrderIndex.get(nodeId) ?? -1
    return failedIndex !== -1 && nodeIndex > failedIndex ? 'blocked' : 'idle'
  }

  const firstMissingExecutedNode = orderedNodeIds.find((orderedNodeId) => !artifactNodeIds.has(orderedNodeId))
  if (!firstMissingExecutedNode) {
    return 'idle'
  }

  if (firstMissingExecutedNode === nodeId) {
    return 'failed'
  }

  const failedIndex = nodeOrderIndex.get(firstMissingExecutedNode) ?? -1
  const nodeIndex = nodeOrderIndex.get(nodeId) ?? -1
  return failedIndex !== -1 && nodeIndex > failedIndex ? 'blocked' : 'idle'
}

/** Resolve one module port from a node/handle pair. */
export function findNodePort(node: ModuleGraphNode | undefined, direction: 'in' | 'out', portKey?: string | null): ModulePortDefinition | null {
  if (!node || !portKey) {
    return null
  }

  const portList = direction === 'out' ? node.data.module.output_ports : node.data.module.exposed_inputs
  const directPort = portList.find((port) => port.key === portKey)
  if (directPort) {
    return directPort
  }

  const operationKey = getModuleOperationKey(node.data.module)

  if (direction !== 'in') {
    return null
  }

  if (operationKey === 'system.random_text_choice') {
    const dynamicKey = portKey.startsWith('options.') ? portKey.slice('options.'.length).trim() : ''
    const parentPort = node.data.module.exposed_inputs.find((port) => port.key === 'options')
    if (!parentPort || !dynamicKey) {
      return null
    }

    return {
      ...parentPort,
      key: portKey,
      label: dynamicKey,
      data_type: 'text',
      required: false,
      multiple: false,
      default_value: undefined,
      description: '랜덤 선택 후보 텍스트야.',
    }
  }

  if (operationKey !== 'system.api_request') {
    return null
  }

  const dynamicParentKey = portKey.startsWith('values.') ? 'values' : portKey.startsWith('headers.') ? 'headers' : null
  if (!dynamicParentKey) {
    return null
  }

  const parentPort = node.data.module.exposed_inputs.find((port) => port.key === dynamicParentKey)
  const dynamicLabel = portKey.slice(`${dynamicParentKey}.`.length).trim()
  if (!parentPort || !dynamicLabel) {
    return null
  }

  return {
    ...parentPort,
    key: portKey,
    label: dynamicLabel,
    data_type: dynamicParentKey === 'headers' ? 'text' : 'any',
    required: false,
    multiple: false,
    default_value: undefined,
    description: dynamicParentKey === 'headers'
      ? 'API 요청 헤더 항목 값이야.'
      : 'API 요청 입력 값 항목이야.',
  }
}

/** Group prompt/text into one string family so graph users can bridge them intentionally. */
export function getModulePortCompatibility(sourceType?: ModulePortDataType | null, targetType?: ModulePortDataType | null) {
  if (!sourceType || !targetType) {
    return 'incompatible' as const
  }

  if (sourceType === targetType || targetType === 'any' || sourceType === 'any') {
    return 'exact' as const
  }

  const isStringBridge = (sourceType === 'text' && targetType === 'prompt') || (sourceType === 'prompt' && targetType === 'text')
  return isStringBridge ? 'string-bridge' as const : 'incompatible' as const
}

/** Build a minimal colored edge style so graph wiring stays readable without extra labels. */
export function buildModuleEdgePresentation(sourcePort: ModulePortDefinition | null, targetPort: ModulePortDefinition | null) {
  const dataType = sourcePort?.data_type ?? targetPort?.data_type ?? null
  const accentColor = dataType ? getPortTypeColor(dataType) : '#94a3b8'
  const compatibility = getModulePortCompatibility(sourcePort?.data_type, targetPort?.data_type)

  return {
    label: '',
    style: {
      stroke: accentColor,
      strokeWidth: compatibility === 'string-bridge' ? 3 : 2.5,
      strokeDasharray: compatibility === 'string-bridge' ? '7 5' : undefined,
      opacity: compatibility === 'string-bridge' ? 0.9 : 1,
    },
  }
}

/** Convert a saved graph workflow into React Flow nodes and edges. */
export function buildFlowFromGraphRecord(graph: GraphWorkflowRecord, modules: ModuleDefinitionRecord[]) {
  const moduleMap = new Map(modules.map((module) => [module.id, module]))

  const baseNodes: ModuleGraphNode[] = graph.graph.nodes
    .map<ModuleGraphNode | null>((node) => {
      const module = moduleMap.get(node.module_id)
      if (!module) {
        return null
      }

      const data: ModuleGraphNodeData = {
        module,
        inputValues: node.input_values || {},
      }

      if (node.disabled === true) {
        data.disabled = true
      }

      if (typeof node.label === 'string' && node.label.trim().length > 0) {
        data.label = node.label.trim()
      }

      return {
        id: node.id,
        type: 'module',
        position: node.position,
        data,
      }
    })
    .filter((node): node is ModuleGraphNode => node !== null)

  const nodes = applySavedWorkflowInputMetadataToNodes(baseNodes, graph.graph.metadata?.exposed_inputs)

  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  const edges: ModuleGraphEdge[] = graph.graph.edges.map((edge) => {
    const sourceNode = nodeById.get(edge.source_node_id)
    const targetNode = nodeById.get(edge.target_node_id)
    const sourcePort = findNodePort(sourceNode, 'out', edge.source_port_key)
    const targetPort = findNodePort(targetNode, 'in', edge.target_port_key)

    return {
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      sourceHandle: buildHandleId('out', edge.source_port_key),
      targetHandle: buildHandleId('in', edge.target_port_key),
      markerEnd: { type: MarkerType.ArrowClosed },
      ...buildModuleEdgePresentation(sourcePort, targetPort),
    }
  })

  return { nodes, edges }
}

/** Build a graph-workflow payload from the current React Flow state. */
export function buildGraphPayload(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[], metadata?: GraphWorkflowMetadata) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      module_id: node.data.module.id,
      label: getModuleNodeDisplayLabel(node),
      disabled: node.data.disabled === true ? true : undefined,
      position: node.position,
      input_values: node.data.inputValues || {},
    })),
    edges: edges
      .map((edge) => {
        const sourceHandle = parseHandleId(edge.sourceHandle)
        const targetHandle = parseHandleId(edge.targetHandle)

        if (!sourceHandle || !targetHandle) {
          return null
        }

        return {
          id: edge.id,
          source_node_id: edge.source,
          source_port_key: sourceHandle.portKey,
          target_node_id: edge.target,
          target_port_key: targetHandle.portKey,
        }
      })
      .filter((edge): edge is NonNullable<typeof edge> => edge !== null),
    metadata,
  }
}

/** Serialize the editable graph state so UI can compare clean vs dirty changes. */
export function buildGraphEditorSnapshot(params: {
  name: string
  description: string
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  workflowMetadata?: GraphWorkflowMetadata
}) {
  return JSON.stringify({
    name: params.name.trim(),
    description: params.description.trim(),
    graph: buildGraphPayload(params.nodes, params.edges, params.workflowMetadata),
  })
}

/** Arrange graph nodes into simple left-to-right layers based on edge flow. */
export function buildAutoLayoutedNodes(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[]) {
  if (nodes.length === 0) {
    return nodes
  }

  const nodeIds = nodes.map((node) => node.id)
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const depthByNode = new Map<string, number>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
    depthByNode.set(node.id, 0)
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue = nodeIds.filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
  const visited = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    visited.add(nodeId)
    const currentDepth = depthByNode.get(nodeId) ?? 0

    for (const nextId of adjacency.get(nodeId) ?? []) {
      depthByNode.set(nextId, Math.max(depthByNode.get(nextId) ?? 0, currentDepth + 1))
      const nextDegree = (inDegree.get(nextId) ?? 0) - 1
      inDegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        queue.push(nextId)
      }
    }
  }

  const fallbackDepthStart = Math.max(...Array.from(depthByNode.values()), 0) + 1
  let fallbackDepth = fallbackDepthStart
  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) {
      depthByNode.set(nodeId, fallbackDepth)
      fallbackDepth += 1
    }
  }

  const grouped = new Map<number, ModuleGraphNode[]>()
  for (const node of nodes) {
    const depth = depthByNode.get(node.id) ?? 0
    const bucket = grouped.get(depth) ?? []
    bucket.push(node)
    grouped.set(depth, bucket)
  }

  const xSpacing = 320
  const ySpacing = 180
  const startX = 80
  const startY = 80

  return nodes.map((node) => {
    const depth = depthByNode.get(node.id) ?? 0
    const columnNodes = (grouped.get(depth) ?? []).slice().sort((left, right) => {
      if (left.position.y !== right.position.y) {
        return left.position.y - right.position.y
      }
      return left.id.localeCompare(right.id)
    })
    const rowIndex = columnNodes.findIndex((item) => item.id === node.id)

    return {
      ...node,
      position: {
        x: startX + depth * xSpacing,
        y: startY + Math.max(rowIndex, 0) * ySpacing,
      },
    }
  })
}

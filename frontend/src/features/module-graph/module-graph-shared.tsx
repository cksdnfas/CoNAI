import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { buildApiUrl } from '@/lib/api-client'
import { applySavedWorkflowInputMetadataToNodes } from './module-graph-workflow-inputs'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionStatus,
  GraphWorkflowMetadata,
  GraphWorkflowRecord,
  GraphWorkflowScheduleStatus,
  ModuleDefinitionRecord,
  ModulePortDataType,
  ModulePortDefinition,
} from '@/lib/api'

export type NodeArtifactGroupPreview = {
  portKey: string
  portLabel: string
  portType: ModulePortDataType | null
  artifactCount: number
  latestArtifactLabel: string | null
  latestArtifactPreviewUrl: string | null
  latestArtifactTextPreview: string | null
  latestArtifactTextValue: string | null
}

export type ModuleGraphNodeData = {
  module: ModuleDefinitionRecord
  label?: string
  inputValues: Record<string, unknown>
  executionStatus?: 'idle' | 'completed' | 'failed' | 'blocked'
  executionArtifactCount?: number
  executionReuseState?: 'reused' | null
  latestArtifactLabel?: string | null
  latestArtifactPreviewUrl?: string | null
  latestArtifactTextPreview?: string | null
  latestArtifactTextValue?: string | null
  executionOutputGroups?: NodeArtifactGroupPreview[]
  executeNodeDisabled?: boolean
  onExecuteNode?: () => void
  onForceExecuteNode?: () => void
  onDisconnectNodeInput?: (nodeId: string, portKey: string) => void
  onNodeValueChange?: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear?: (nodeId: string, portKey: string) => void
  onNodeLabelChange?: (nodeId: string, label: string) => void
  onNodeImageChange?: (nodeId: string, portKey: string, image?: SelectedImageDraft) => Promise<void> | void
  connectedInputKeys?: string[]
  connectedOutputKeys?: string[]
}

export type ModuleGraphNode = Node<ModuleGraphNodeData, 'module'>
export type ModuleGraphEdge = Edge

export type ModuleGraphClipboardNode = {
  id: string
  moduleId: number
  position: { x: number; y: number }
  label?: string
  inputValues: Record<string, unknown>
}

export type ModuleGraphClipboardEdge = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type ModuleGraphClipboardPayload = {
  kind: 'conai/module-graph-selection'
  version: 1
  nodes: ModuleGraphClipboardNode[]
  edges: ModuleGraphClipboardEdge[]
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

/** Read a local file into a data URL for graph input overrides. */
export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as data URL'))
    reader.readAsDataURL(file)
  })
}

const PORT_TYPE_COLORS: Record<ModulePortDataType, string> = {
  image: '#4fc3f7',
  mask: '#ffb74d',
  prompt: '#4db6ac',
  text: '#81c784',
  number: '#ffd54f',
  boolean: '#ef9a9a',
  json: '#90a4ae',
  any: '#b0bec5',
}

const GENERIC_MODULE_PORT_DESCRIPTIONS = new Set([
  '노드 안에 저장해둘 텍스트 값이야.',
  '노드 안에 저장해둘 JSON 값이야.',
  '노드 안에 저장해둘 이미지야.',
  '노드 안에 저장해둘 숫자 값이야.',
  '노드 안에 저장해둘 참/거짓 값이야.',
])

/** Resolve one stable system-operation key from module metadata when present. */
export function getModuleOperationKey(module: ModuleDefinitionRecord) {
  if (typeof module.internal_fixed_values?.operation_key === 'string') {
    return module.internal_fixed_values.operation_key
  }

  if (typeof module.template_defaults?.operation_key === 'string') {
    return module.template_defaults.operation_key
  }

  return null
}

/** Resolve whether one module is the built-in explicit final-result marker. */
export function isFinalResultModule(module: ModuleDefinitionRecord) {
  return module.engine_type === 'system' && getModuleOperationKey(module) === 'system.final_result'
}

/** Resolve a visible color for module nodes when the module does not define one. */
export function getModuleColor(module: ModuleDefinitionRecord) {
  if (module.color) {
    return module.color
  }

  if (module.engine_type === 'nai') {
    return '#7c4dff'
  }

  if (module.engine_type === 'codex') {
    return '#26a69a'
  }

  if (module.engine_type === 'comfyui') {
    return '#2196f3'
  }

  if (module.engine_type === 'custom_js') {
    return '#ff8a65'
  }

  return '#26a69a'
}

/** Resolve a stable accent color for one module port data type. */
export function getPortTypeColor(dataType: ModulePortDataType) {
  return PORT_TYPE_COLORS[dataType]
}

/** Hide boilerplate per-port help copy so node cards and runners stay concise. */
export function normalizeModulePortDescription(description?: string | null) {
  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if (!trimmedDescription || GENERIC_MODULE_PORT_DESCRIPTIONS.has(trimmedDescription)) {
    return undefined
  }

  return trimmedDescription
}

/** Normalize legacy/built-in system node names into the user-facing names we want to keep. */
export function getModuleBaseDisplayName(module: ModuleDefinitionRecord) {
  const operationKey = getModuleOperationKey(module)
  if (operationKey === 'system.constant_text' || operationKey === 'system.constant_prompt') {
    return '텍스트'
  }
  if (operationKey === 'system.constant_json') {
    return 'JSON'
  }
  if (operationKey === 'system.constant_image') {
    return '이미지'
  }
  if (operationKey === 'system.constant_number') {
    return '숫자'
  }
  if (operationKey === 'system.constant_boolean') {
    return '불리언'
  }
  if (operationKey === 'system.merge_text') {
    return '텍스트 합치기'
  }

  return module.name
}

/** Resolve the user-visible node name, preferring one custom label when present. */
export function getModuleNodeDisplayLabelFromData(data: ModuleGraphNodeData) {
  const trimmedLabel = typeof data.label === 'string' ? data.label.trim() : ''
  return trimmedLabel || getModuleBaseDisplayName(data.module)
}

/** Check whether a node is currently using one custom user-defined label. */
export function hasCustomModuleNodeLabel(data: ModuleGraphNodeData) {
  const trimmedLabel = typeof data.label === 'string' ? data.label.trim() : ''
  return trimmedLabel.length > 0 && trimmedLabel !== getModuleBaseDisplayName(data.module)
}

/** Resolve the visible node name from one graph node. */
export function getModuleNodeDisplayLabel(node: ModuleGraphNode) {
  return getModuleNodeDisplayLabelFromData(node.data)
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

  return new Intl.DateTimeFormat('ko-KR', {
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

/** Map a stored temp artifact path back into a backend-served /temp URL. */
export function getArtifactPreviewUrl(artifact: GraphExecutionArtifactRecord) {
  if (!artifact.storage_path) {
    return null
  }

  const normalized = artifact.storage_path.replace(/\\/g, '/')
  const marker = '/graph-executions/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  return buildApiUrl(`/temp${normalized.slice(markerIndex)}`)
}

type GraphArtifactPreviewLike = {
  artifact_type: string
  storage_path?: string | null
  metadata?: string | null
  source_storage_path?: string | null
  source_metadata?: string | null
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

/** Infer one media MIME type from the stored artifact file extension. */
export function inferArtifactMimeTypeFromPath(path?: string | null) {
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
  const metadataValue = artifact.source_metadata ?? artifact.metadata
  const storagePath = artifact.source_storage_path ?? artifact.storage_path
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
  const visibleArtifacts = artifacts.filter((artifact) => !isEmptyLlmJsonArtifact(artifact))
  const latestVisualArtifact = visibleArtifacts.find((artifact) => hasGraphArtifactVisualPreview(artifact))

  if (latestVisualArtifact) {
    return {
      latestArtifactLabel: `${latestVisualArtifact.port_key} · ${latestVisualArtifact.artifact_type}`,
      latestArtifactPreviewUrl: getArtifactPreviewUrl(latestVisualArtifact),
      latestArtifactTextPreview: null,
      latestArtifactTextValue: null,
    }
  }

  const readableArtifacts = visibleArtifacts.filter((artifact) => artifact.port_key !== 'metadata')
  const latestTextArtifact = readableArtifacts.find((artifact) => artifact.port_key === 'text' && artifact.artifact_type === 'text')
    ?? readableArtifacts.find((artifact) => artifact.artifact_type === 'prompt' || artifact.artifact_type === 'text')
    ?? readableArtifacts.find((artifact) => artifact.artifact_type === 'json' || artifact.artifact_type === 'number' || artifact.artifact_type === 'boolean')

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

/** Build compact per-port artifact previews so node cards can expose outputs without opening the results panel. */
export function buildNodeArtifactGroups(
  artifacts: GraphExecutionArtifactRecord[],
  outputPorts: ModulePortDefinition[],
): NodeArtifactGroupPreview[] {
  const outputPortMap = new Map(outputPorts.map((port, index) => [port.key, { port, index }]))
  const groupedArtifacts = artifacts
    .filter((artifact) => !isEmptyLlmJsonArtifact(artifact))
    .reduce<Map<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
      const current = acc.get(artifact.port_key) ?? []
      current.push(artifact)
      acc.set(artifact.port_key, current)
      return acc
    }, new Map())

  return Array.from(groupedArtifacts.entries())
    .map(([portKey, portArtifacts]) => {
      const sortedArtifacts = [...portArtifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
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

/** Resolve a compact node execution status from the selected execution detail. */
export function getNodeExecutionStatus(params: {
  nodeId: string
  orderedNodeIds: string[]
  artifactNodeIds: Set<string>
  executionStatus: GraphExecutionStatus
  failedNodeId?: string | null
}): 'idle' | 'completed' | 'failed' | 'blocked' {
  const { nodeId, orderedNodeIds, artifactNodeIds, executionStatus, failedNodeId } = params

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

    const failedIndex = orderedNodeIds.indexOf(failedNodeId)
    const nodeIndex = orderedNodeIds.indexOf(nodeId)
    return failedIndex !== -1 && nodeIndex > failedIndex ? 'blocked' : 'idle'
  }

  const firstMissingExecutedNode = orderedNodeIds.find((orderedNodeId) => !artifactNodeIds.has(orderedNodeId))
  if (!firstMissingExecutedNode) {
    return 'idle'
  }

  if (firstMissingExecutedNode === nodeId) {
    return 'failed'
  }

  const failedIndex = orderedNodeIds.indexOf(firstMissingExecutedNode)
  const nodeIndex = orderedNodeIds.indexOf(nodeId)
  return nodeIndex > failedIndex ? 'blocked' : 'idle'
}

/** Resolve one module port from a node/handle pair. */
export function findNodePort(node: ModuleGraphNode | undefined, direction: 'in' | 'out', portKey?: string | null): ModulePortDefinition | null {
  if (!node || !portKey) {
    return null
  }

  const portList = direction === 'out' ? node.data.module.output_ports : node.data.module.exposed_inputs
  return portList.find((port) => port.key === portKey) ?? null
}

/** Group prompt/text into one string family so graph users can bridge them intentionally. */
export function getModulePortCompatibility(sourceType?: ModulePortDataType | null, targetType?: ModulePortDataType | null) {
  if (!sourceType || !targetType) {
    return 'incompatible' as const
  }

  if (sourceType === targetType || targetType === 'any') {
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

/** Clamp per-port handle offsets so small nodes stay readable. */
export function getPortOffset(index: number, total: number) {
  if (total <= 1) {
    return '50%'
  }

  const step = 100 / (total + 1)
  return `${step * (index + 1)}%`
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

  const edges: ModuleGraphEdge[] = graph.graph.edges.map((edge) => {
    const sourceNode = nodes.find((node) => node.id === edge.source_node_id)
    const targetNode = nodes.find((node) => node.id === edge.target_node_id)
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

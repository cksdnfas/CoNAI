import type {
  GraphExecutionArtifactRecord,
  GraphWorkflowExposedInput,
  GraphWorkflowRecord,
} from '@/lib/api-module-graph'
import {
  buildArtifactTextPreview,
  buildArtifactTextValue,
  getArtifactStoredValue,
  hasGraphArtifactVisualPreview,
  isEmptyLlmJsonArtifact,
} from '../module-graph-shared'

export type ParsedExecutionPlan = {
  orderedNodeIds?: string[]
  targetNodeId?: string | null
  runtimeInputSignature?: string | null
  runtimeInputValues?: Record<string, unknown>
  forceRerun?: boolean
  reusedFromExecutionId?: number | null
  reusedNodeIds?: string[]
  inputValues?: Record<string, unknown>
  input_values?: Record<string, unknown>
  runtimeInputs?: Record<string, unknown>
  runtime_inputs?: Record<string, unknown>
  resolvedInputs?: Record<string, unknown>
  resolved_inputs?: Record<string, unknown>
}

export type ExecutionInputEntry = {
  key: string
  label: string
  value: unknown
}

const COMPACT_HIDDEN_ARTIFACT_PORT_KEYS = new Set(['image_ref', 'metadata'])

/** Parse one execution-plan JSON string into the normalized panel view model. */
export function parseExecutionPlan(value?: string | null): ParsedExecutionPlan | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as ParsedExecutionPlan
  } catch {
    return null
  }
}

/** Resolve a user-facing execution mode label from one parsed execution plan. */
export function getExecutionModeLabel(plan: ParsedExecutionPlan | null) {
  if (plan?.targetNodeId) {
    return plan.forceRerun ? '강제 노드 재실행' : '선택 노드 실행'
  }

  return '워크플로우 실행'
}

/** Pick the runtime-input object from the execution plan's possible payload keys. */
function getExecutionInputCandidate(plan: ParsedExecutionPlan | null) {
  return (
    plan?.runtimeInputValues
    ?? plan?.inputValues
    ?? plan?.input_values
    ?? plan?.runtimeInputs
    ?? plan?.runtime_inputs
    ?? plan?.resolvedInputs
    ?? plan?.resolved_inputs
    ?? null
  )
}

/** Format one primitive or structured execution value for compact UI display. */
export function formatPrimitiveValue(value: unknown) {
  if (value === null || value === undefined) {
    return '없음'
  }

  if (typeof value === 'boolean') {
    return value ? '예' : '아니오'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return '미디어 데이터'
    }

    return value
  }

  return JSON.stringify(value)
}

/** Summarize one structured value into a small list of readable preview lines. */
function summarizeStructuredValue(value: unknown, maxEntries = 4) {
  if (!value || typeof value !== 'object') {
    return [] as string[]
  }

  if (Array.isArray(value)) {
    return value.slice(0, maxEntries).map((entry, index) => `${index + 1}. ${formatPrimitiveValue(entry)}`)
  }

  return Object.entries(value)
    .slice(0, maxEntries)
    .map(([key, entryValue]) => `${key}: ${formatPrimitiveValue(entryValue)}`)
}

/** Build the compact summary text shown for non-visual execution artifacts. */
export function buildArtifactSummaryText(artifact: GraphExecutionArtifactRecord) {
  const storedValue = getArtifactStoredValue(artifact)
  if (storedValue === null || storedValue === undefined) {
    return null
  }

  if (typeof storedValue === 'string' || typeof storedValue === 'number' || typeof storedValue === 'boolean') {
    return buildArtifactTextPreview(artifact, 220) ?? formatPrimitiveValue(storedValue)
  }

  const structuredLines = summarizeStructuredValue(storedValue)
  if (structuredLines.length > 0) {
    return structuredLines.join(' · ')
  }

  return buildArtifactTextPreview(artifact, 220)
}

/** Build the full readable text shown in the output-content modal for one artifact. */
export function buildArtifactFullText(artifact: GraphExecutionArtifactRecord) {
  const textValue = buildArtifactTextValue(artifact)
  if (textValue) {
    return textValue
  }

  if (artifact.storage_path) {
    return artifact.storage_path
  }

  return buildArtifactSummaryText(artifact) ?? '내용 없음'
}

/** Build the detail lines shown under one visual execution artifact preview. */
export function buildArtifactDetailLines(artifact: GraphExecutionArtifactRecord) {
  const storedValue = getArtifactStoredValue(artifact)
  const lines = summarizeStructuredValue(storedValue, 6)
  if (lines.length > 0) {
    return lines
  }

  const summaryText = buildArtifactSummaryText(artifact)
  return summaryText ? [summaryText] : []
}

/** Hide low-value technical artifacts from the compact execution summary surface. */
export function isCompactExecutionArtifactVisible(artifact: GraphExecutionArtifactRecord) {
  return !COMPACT_HIDDEN_ARTIFACT_PORT_KEYS.has(artifact.port_key) && !isEmptyLlmJsonArtifact(artifact)
}

/** Resolve the short user-facing label used by compact artifact cards. */
export function getCompactExecutionArtifactLabel(artifact: GraphExecutionArtifactRecord) {
  if (artifact.port_key === 'input') {
    return '입력'
  }

  if (artifact.port_key === 'output') {
    return '출력'
  }

  if (artifact.port_key === 'result' || artifact.port_key === 'value') {
    return '결과물'
  }

  return artifact.port_key
}

/** Build a lookup map from exposed-input ids to display labels. */
function buildInputLabelMap(inputDefinitions: GraphWorkflowExposedInput[]) {
  return new Map(inputDefinitions.map((inputDefinition) => [inputDefinition.id, inputDefinition.label]))
}

/** Resolve the execution input entries shown in the summary/detail panels. */
export function getExecutionInputEntries(plan: ParsedExecutionPlan | null, inputDefinitions: GraphWorkflowExposedInput[]) {
  const candidate = getExecutionInputCandidate(plan)
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return [] as ExecutionInputEntry[]
  }

  const labelMap = buildInputLabelMap(inputDefinitions)
  return Object.entries(candidate).map(([key, value]) => ({
    key,
    label: labelMap.get(key) ?? key,
    value,
  }))
}

/** Resolve a human-readable node label from the selected workflow graph. */
function buildNodeDisplayLabelMap(selectedGraph: GraphWorkflowRecord | null | undefined) {
  return new Map((selectedGraph?.graph.nodes ?? []).map((node) => [node.id, node.label?.trim() ?? ''] as const))
}

function resolveNodeDisplayLabel(
  nodeId: string,
  explicitLabel: string | undefined,
  nodeLabelOverrides?: Record<string, string> | null,
) {
  const overrideLabel = nodeLabelOverrides?.[nodeId]?.trim()
  if (overrideLabel) {
    return overrideLabel
  }

  if (explicitLabel) {
    return explicitLabel
  }

  return `노드 ${nodeId}`
}

export function getNodeDisplayLabel(
  selectedGraph: GraphWorkflowRecord | null | undefined,
  nodeId: string,
  nodeLabelOverrides?: Record<string, string> | null,
) {
  const nodeRecord = selectedGraph?.graph.nodes.find((node) => node.id === nodeId)
  return resolveNodeDisplayLabel(nodeId, nodeRecord?.label?.trim(), nodeLabelOverrides)
}

/** Group artifacts by node so the panel can render per-node outputs. */
export function groupArtifactsByNode(
  artifacts: GraphExecutionArtifactRecord[],
  selectedGraph?: GraphWorkflowRecord | null,
  nodeLabelOverrides?: Record<string, string> | null,
) {
  const groupMap = new Map<string, GraphExecutionArtifactRecord[]>()
  const nodeLabelMap = buildNodeDisplayLabelMap(selectedGraph)

  for (const artifact of artifacts) {
    const current = groupMap.get(artifact.node_id) ?? []
    current.push(artifact)
    groupMap.set(artifact.node_id, current)
  }

  return Array.from(groupMap.entries())
    .map(([nodeId, nodeArtifacts]) => ({
      nodeId,
      nodeLabel: resolveNodeDisplayLabel(nodeId, nodeLabelMap.get(nodeId), nodeLabelOverrides),
      artifacts: [...nodeArtifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime()),
    }))
    .sort((left, right) => {
      const leftTime = new Date(left.artifacts[0]?.created_date ?? 0).getTime()
      const rightTime = new Date(right.artifacts[0]?.created_date ?? 0).getTime()
      return rightTime - leftTime
    })
}

/** Prefer visual artifacts, then readable text, when picking the most useful compact preview set. */
function pickHighlightedArtifacts(artifacts: GraphExecutionArtifactRecord[]) {
  const sortedArtifacts = [...artifacts]
    .filter((artifact) => !isEmptyLlmJsonArtifact(artifact))
    .sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
  const visualArtifacts = sortedArtifacts.filter((artifact) => hasGraphArtifactVisualPreview(artifact))

  if (visualArtifacts.length > 0) {
    return visualArtifacts.slice(0, 4)
  }

  const textArtifacts: GraphExecutionArtifactRecord[] = []
  const structuredArtifacts: GraphExecutionArtifactRecord[] = []

  for (const artifact of sortedArtifacts) {
    if (artifact.port_key === 'metadata') {
      continue
    }

    if (artifact.port_key === 'text' || artifact.artifact_type === 'text' || artifact.artifact_type === 'prompt') {
      textArtifacts.push(artifact)
    } else {
      structuredArtifacts.push(artifact)
    }
  }

  return [...textArtifacts, ...structuredArtifacts].slice(0, 4)
}

/** Pick one representative artifact for the compact per-node execution grid. */
export function pickPrimaryExecutionArtifact(artifacts: GraphExecutionArtifactRecord[]) {
  return pickHighlightedArtifacts(artifacts)[0] ?? null
}

/** Build one simple modal body string for a node's text/json outputs. */
export function buildArtifactGroupModalText(artifacts: GraphExecutionArtifactRecord[]) {
  if (artifacts.length === 0) {
    return '내용 없음'
  }

  if (artifacts.length === 1) {
    return buildArtifactFullText(artifacts[0])
  }

  return artifacts
    .map((artifact) => `${artifact.port_key}\n${buildArtifactFullText(artifact)}`)
    .join('\n\n')
}

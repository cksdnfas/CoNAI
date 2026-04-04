import type {
  GraphExecutionArtifactRecord,
  GraphWorkflowExposedInput,
  GraphWorkflowRecord,
} from '@/lib/api'
import {
  buildArtifactTextPreview,
  getArtifactPreviewUrl,
  getArtifactStoredValue,
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
export function getNodeDisplayLabel(selectedGraph: GraphWorkflowRecord | null | undefined, nodeId: string) {
  const nodeRecord = selectedGraph?.graph.nodes.find((node) => node.id === nodeId)
  const explicitLabel = nodeRecord?.label?.trim()
  if (explicitLabel) {
    return explicitLabel
  }

  return `노드 ${nodeId}`
}

/** Group artifacts by node so the panel can render per-node outputs. */
export function groupArtifactsByNode(artifacts: GraphExecutionArtifactRecord[], selectedGraph?: GraphWorkflowRecord | null) {
  const groupMap = new Map<string, GraphExecutionArtifactRecord[]>()

  for (const artifact of artifacts) {
    const current = groupMap.get(artifact.node_id) ?? []
    current.push(artifact)
    groupMap.set(artifact.node_id, current)
  }

  return Array.from(groupMap.entries())
    .map(([nodeId, nodeArtifacts]) => ({
      nodeId,
      nodeLabel: getNodeDisplayLabel(selectedGraph, nodeId),
      artifacts: [...nodeArtifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime()),
    }))
    .sort((left, right) => {
      const leftTime = new Date(left.artifacts[0]?.created_date ?? 0).getTime()
      const rightTime = new Date(right.artifacts[0]?.created_date ?? 0).getTime()
      return rightTime - leftTime
    })
}

/** Prefer visual artifacts when picking the most useful compact preview set. */
function pickHighlightedArtifacts(artifacts: GraphExecutionArtifactRecord[]) {
  const sortedArtifacts = [...artifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
  const visualArtifacts = sortedArtifacts.filter((artifact) => (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') && getArtifactPreviewUrl(artifact))

  if (visualArtifacts.length > 0) {
    return visualArtifacts.slice(0, 4)
  }

  return sortedArtifacts.slice(0, 4)
}

/** Resolve terminal node ids from the selected workflow graph. */
function getTerminalNodeIds(selectedGraph?: GraphWorkflowRecord | null) {
  if (!selectedGraph) {
    return [] as string[]
  }

  const sourceNodeIds = new Set(selectedGraph.graph.edges.map((edge) => edge.source_node_id))
  return selectedGraph.graph.nodes
    .filter((node) => !sourceNodeIds.has(node.id))
    .map((node) => node.id)
}

/** Pick the best final artifacts for summary display based on execution context. */
export function pickFinalArtifacts(params: {
  artifacts: GraphExecutionArtifactRecord[]
  executionPlan: ParsedExecutionPlan | null
  selectedGraph?: GraphWorkflowRecord | null
}) {
  const { artifacts, executionPlan, selectedGraph } = params
  const sortedArtifacts = [...artifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
  if (sortedArtifacts.length === 0) {
    return [] as GraphExecutionArtifactRecord[]
  }

  const artifactNodeIds = new Set(sortedArtifacts.map((artifact) => artifact.node_id))
  const preferredNodeIds: string[] = []

  if (executionPlan?.targetNodeId) {
    preferredNodeIds.push(executionPlan.targetNodeId)
  }

  const terminalNodeIds = getTerminalNodeIds(selectedGraph)
  for (const nodeId of terminalNodeIds) {
    if (artifactNodeIds.has(nodeId)) {
      preferredNodeIds.push(nodeId)
    }
  }

  const orderedNodeIds = [...(executionPlan?.orderedNodeIds ?? [])].reverse()
  for (const nodeId of orderedNodeIds) {
    if (artifactNodeIds.has(nodeId)) {
      preferredNodeIds.push(nodeId)
      break
    }
  }

  const uniquePreferredNodeIds = preferredNodeIds.filter((nodeId, index) => preferredNodeIds.indexOf(nodeId) === index)
  if (uniquePreferredNodeIds.length > 0) {
    const finalArtifacts = sortedArtifacts.filter((artifact) => uniquePreferredNodeIds.includes(artifact.node_id))
    if (finalArtifacts.length > 0) {
      return pickHighlightedArtifacts(finalArtifacts)
    }
  }

  return pickHighlightedArtifacts(sortedArtifacts)
}

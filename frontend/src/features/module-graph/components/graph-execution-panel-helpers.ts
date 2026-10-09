import type {
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionLogRecord,
  GraphExecutionNodeIoRecord,
  GraphExecutionRecord,
  GraphWorkflowExposedInput,
  GraphWorkflowRecord,
} from '@/lib/api-module-graph'
import {
  buildArtifactTextPreview,
  buildArtifactTextValue,
  compareGraphArtifactsNewestFirst,
  getArtifactStoredValue,
  hasGraphArtifactVisualPreview,
  isEmptyLlmJsonArtifact,
} from '../module-graph-shared'
import { formatWorkflowInputLabel } from '../module-graph-workflow-inputs'
import { listFinalResultLifecycleWarnings } from './workflow-execution-log-alerts'
import type { TranslationInput, TranslationParams } from '@/i18n'

type Translate = (input: TranslationInput, params?: TranslationParams) => string

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

export type ExecutionComparisonSummary = {
  runtimeInputCount: number
  compactInputCount: number
  compactOutputCount: number
  artifactCount: number
  finalResultCount: number
  issueLogCount: number
  finalResultWarningCount: number
}

export type ExecutionComparisonRow = {
  id: number
  direction: GraphExecutionNodeIoRecord['direction']
  nodeLabel: string
  portKey: string
  sourceLabel: string | null
  artifactType: string | null
  refLabel: string | null
  summaryText: string | null
}

export type ExecutionPathDiagnosticRow = {
  id: string
  tone: 'failed' | 'blocked' | 'skipped'
  nodeLabel: string
  reasonLabel: string
  sourceLabel: string | null
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
export function getExecutionModeLabel(plan: ParsedExecutionPlan | null, t: Translate) {
  if (plan?.targetNodeId) {
    return plan.forceRerun
      ? t({ ko: '강제 노드 재실행', en: 'Forced node rerun' })
      : t({ ko: '선택 노드 실행', en: 'Selected node run' })
  }

  return t({ ko: '워크플로우 실행', en: 'Workflow run' })
}

const GRAPH_EXECUTION_LOG_LEVEL_LABELS: Record<GraphExecutionLogRecord['level'], TranslationInput> = {
  info: { ko: '정보', en: 'Info' },
  warn: { ko: '경고', en: 'Warning' },
  error: { ko: '오류', en: 'Error' },
}

/** Resolve one localized label for an execution log level. */
export function getGraphExecutionLogLevelLabel(level: GraphExecutionLogRecord['level'], t: Translate) {
  const label = GRAPH_EXECUTION_LOG_LEVEL_LABELS[level]
  return label ? t(label) : level
}

/** Badge variant per log level: errors must read strongest, info the quietest. */
export function getGraphExecutionLogLevelBadgeVariant(level: GraphExecutionLogRecord['level']) {
  if (level === 'error') {
    return 'destructive' as const
  }

  return level === 'warn' ? 'secondary' as const : 'outline' as const
}

const GRAPH_EXECUTION_LOG_EVENT_LABELS: Record<string, TranslationInput> = {
  execution_queued: { ko: '실행 대기 등록', en: 'Run queued' },
  execution_start: { ko: '실행 시작', en: 'Run started' },
  execution_complete: { ko: '실행 완료', en: 'Run completed' },
  execution_failed: { ko: '실행 실패', en: 'Run failed' },
  execution_cancel_requested: { ko: '실행 취소 요청', en: 'Run cancel requested' },
  execution_cancelled: { ko: '실행 취소됨', en: 'Run cancelled' },
  execution_stopped: { ko: '실행 중지됨', en: 'Run stopped' },
  execution_abort_drain_timeout: { ko: '중단 정리 시간 초과', en: 'Abort cleanup timed out' },
  workflow_stop_requested: { ko: '워크플로우 중지 요청', en: 'Workflow stop requested' },
  node_start: { ko: '노드 시작', en: 'Node started' },
  node_complete: { ko: '노드 완료', en: 'Node completed' },
  node_aborted: { ko: '노드 중단', en: 'Node aborted' },
  node_reused: { ko: '노드 결과 재사용', en: 'Node result reused' },
  node_inputs_resolved: { ko: '노드 입력 확정', en: 'Node inputs resolved' },
  node_skipped_disabled: { ko: '비활성 노드 건너뜀', en: 'Disabled node skipped' },
  node_skipped_inactive_branch: { ko: '비활성 분기 건너뜀', en: 'Inactive branch skipped' },
  node_engine_start: { ko: '엔진 작업 시작', en: 'Engine job started' },
  node_engine_progress: { ko: '엔진 작업 진행', en: 'Engine job progress' },
  node_engine_complete: { ko: '엔진 작업 완료', en: 'Engine job completed' },
  node_queue_registered: { ko: '생성 큐 등록', en: 'Queued for generation' },
  node_queue_complete: { ko: '생성 큐 완료', en: 'Generation queue job completed' },
  node_queue_cancel_requested: { ko: '생성 큐 취소 요청', en: 'Generation queue cancel requested' },
  node_comfy_cancel_requested: { ko: 'ComfyUI 취소 요청', en: 'ComfyUI cancel requested' },
  llm_provider_response: { ko: 'LLM 응답 수신', en: 'LLM response received' },
  llm_json_parse_failed: { ko: 'LLM JSON 해석 실패', en: 'LLM JSON parse failed' },
  provider_response: { ko: '제공자 응답 수신', en: 'Provider response received' },
  json_parse_failed: { ko: 'JSON 해석 실패', en: 'JSON parse failed' },
  final_result_source_artifact_missing: { ko: '최종 결과 원본 없음', en: 'Final result source missing' },
  final_result_promotion_failed: { ko: '최종 결과 기록 연결 실패', en: 'Final result history link failed' },
  custom_node_log: { ko: '커스텀 노드 로그', en: 'Custom node log' },
}

/** Resolve one localized label for an execution log event; unknown events keep their code. */
export function getGraphExecutionLogEventLabel(eventType: string, t: Translate) {
  const label = GRAPH_EXECUTION_LOG_EVENT_LABELS[eventType]
  return label ? t(label) : eventType
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
export function formatPrimitiveValue(value: unknown, t?: Translate) {
  if (value === null || value === undefined) {
    return t ? t({ ko: '없음', en: 'None' }) : '없음'
  }

  if (typeof value === 'boolean') {
    if (t) {
      return value ? t({ ko: '예', en: 'Yes' }) : t({ ko: '아니오', en: 'No' })
    }
    return value ? '예' : '아니오'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return t ? t({ ko: '미디어 데이터', en: 'Media data' }) : '미디어 데이터'
    }

    return value
  }

  return JSON.stringify(value)
}

function compactComparisonText(value: string, maxLength = 72) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function parseNodeIoSummary(value?: string | null) {
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

function parseLogDetails(value?: string | null) {
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

function readSummaryString(summary: Record<string, unknown> | null, key: string) {
  const value = summary?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readSummaryNumber(summary: Record<string, unknown> | null, key: string) {
  const value = summary?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function summarizeNodeIoValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const valueKind = typeof record.valueKind === 'string' ? record.valueKind : null
  const size = typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : null
  const hash = typeof record.hash === 'string' && record.hash.trim() ? record.hash.trim().slice(0, 12) : null
  return [valueKind, size !== null ? `${size}b` : null, hash ? `#${hash}` : null].filter(Boolean).join(' ') || null
}

function summarizeNodeIoSummary(value?: string | null) {
  const summary = parseNodeIoSummary(value)
  if (!summary) {
    return null
  }

  const sourceArtifactId = readSummaryNumber(summary, 'sourceArtifactId')
  const sourceRefKind = readSummaryString(summary, 'sourceRefKind')
  const sourceRefValue = readSummaryString(summary, 'sourceRefValue')
  const artifactRecordId = readSummaryNumber(summary, 'artifactRecordId')
  const metadataKind = readSummaryString(summary, 'metadataKind')
  const mimeType = readSummaryString(summary, 'mimeType')
  const fileName = readSummaryString(summary, 'fileName')
  const queueJobId = readSummaryNumber(summary, 'queueJobId')
  const historyId = readSummaryNumber(summary, 'historyId')
  const valueSummary = summarizeNodeIoValue(summary.value)

  return [
    sourceArtifactId !== null ? `source #${sourceArtifactId}` : null,
    sourceRefKind && sourceRefValue ? `${sourceRefKind}: ${compactComparisonText(sourceRefValue, 48)}` : sourceRefKind,
    artifactRecordId !== null ? `artifact #${artifactRecordId}` : null,
    metadataKind,
    mimeType,
    fileName,
    queueJobId !== null ? `queue #${queueJobId}` : null,
    historyId !== null ? `history #${historyId}` : null,
    valueSummary,
  ].filter(Boolean).join(' · ') || null
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
  return new Map(inputDefinitions.map((inputDefinition) => [inputDefinition.id, formatWorkflowInputLabel(inputDefinition.label)]))
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

export function buildExecutionComparisonSummary({
  inputEntries,
  artifacts,
  finalResults,
  logs,
  nodeIo,
}: {
  inputEntries: ExecutionInputEntry[]
  artifacts: GraphExecutionArtifactRecord[]
  finalResults: GraphExecutionFinalResultRecord[]
  logs: GraphExecutionLogRecord[]
  nodeIo: GraphExecutionNodeIoRecord[]
}): ExecutionComparisonSummary {
  const finalResultWarningCount = listFinalResultLifecycleWarnings(logs).length
  const issueLogCount = logs.filter((log) => log.level === 'warn' || log.level === 'error').length

  return {
    runtimeInputCount: inputEntries.length,
    compactInputCount: nodeIo.filter((record) => record.direction === 'input').length,
    compactOutputCount: nodeIo.filter((record) => record.direction === 'output').length,
    artifactCount: artifacts.length,
    finalResultCount: finalResults.length,
    issueLogCount,
    finalResultWarningCount,
  }
}

export function buildExecutionComparisonRows(
  nodeIo: GraphExecutionNodeIoRecord[],
  selectedGraph?: GraphWorkflowRecord | null,
  nodeLabelOverrides?: Record<string, string> | null,
): ExecutionComparisonRow[] {
  const nodeLabelMap = buildNodeDisplayLabelMap(selectedGraph)

  return nodeIo.map((record) => {
    const nodeLabel = getNodeDisplayLabelFromMap(nodeLabelMap, record.node_id, nodeLabelOverrides)
    const sourceNodeLabel = record.source_node_id
      ? getNodeDisplayLabelFromMap(nodeLabelMap, record.source_node_id, nodeLabelOverrides)
      : null
    const sourceLabel = sourceNodeLabel
      ? [sourceNodeLabel, record.source_port_key].filter(Boolean).join(' · ')
      : null
    const refLabel = [record.ref_kind, record.ref_value ? compactComparisonText(record.ref_value, 64) : null].filter(Boolean).join(': ') || null

    return {
      id: record.id,
      direction: record.direction,
      nodeLabel,
      portKey: record.port_key,
      sourceLabel,
      artifactType: record.artifact_type ?? null,
      refLabel,
      summaryText: summarizeNodeIoSummary(record.summary),
    }
  })
}

function readSkipReasonLabel(details: Record<string, unknown> | null, t: Translate) {
  const disabledInputs = Array.isArray(details?.disabledInputs) ? details.disabledInputs : []
  const inputReasons = disabledInputs
    .filter((input): input is Record<string, unknown> => Boolean(input) && typeof input === 'object' && !Array.isArray(input))
    .map((input) => input.reason)

  if (inputReasons.includes('source_node_skipped')) {
    return t({ ko: '상위 노드가 먼저 건너뜀', en: 'An upstream node was skipped first' })
  }

  if (inputReasons.includes('source_output_disabled')) {
    return t({ ko: '상위 출력이 비활성', en: 'Upstream output is inactive' })
  }

  if (inputReasons.includes('inactive_if_branch')) {
    return t({ ko: 'IF 분기 비활성 경로', en: 'Inactive IF branch' })
  }

  return t({ ko: '건너뛴 경로', en: 'Skipped path' })
}

function readFirstDisabledInputSource(details: Record<string, unknown> | null, nodeLabelMap: ReadonlyMap<string, string>, nodeLabelOverrides?: Record<string, string> | null) {
  const disabledInputs = Array.isArray(details?.disabledInputs) ? details.disabledInputs : []
  const sourceInput = disabledInputs.find((input): input is Record<string, unknown> => Boolean(input) && typeof input === 'object' && !Array.isArray(input))
  const sourceNodeId = typeof sourceInput?.sourceNodeId === 'string' ? sourceInput.sourceNodeId : null
  const sourcePortKey = typeof sourceInput?.sourcePortKey === 'string' ? sourceInput.sourcePortKey : null
  if (!sourceNodeId) {
    return null
  }

  return [getNodeDisplayLabelFromMap(nodeLabelMap, sourceNodeId, nodeLabelOverrides), sourcePortKey].filter(Boolean).join(' · ')
}

/** Build readable skipped/failed/blocked path diagnostics for execution summary surfaces. */
export function buildExecutionPathDiagnosticRows({
  execution,
  logs,
  plan,
  selectedGraph,
  nodeLabelOverrides,
  t,
}: {
  execution: GraphExecutionRecord
  logs: GraphExecutionLogRecord[]
  plan: ParsedExecutionPlan | null
  selectedGraph?: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  t: Translate
}): ExecutionPathDiagnosticRow[] {
  const nodeLabelMap = buildNodeDisplayLabelMap(selectedGraph)
  const rows: ExecutionPathDiagnosticRow[] = []
  const seenNodeDiagnostics = new Set<string>()

  for (const log of logs) {
    if (!log.node_id) {
      continue
    }

    if (log.event_type === 'node_skipped_disabled') {
      const key = `skipped:${log.node_id}`
      if (!seenNodeDiagnostics.has(key)) {
        seenNodeDiagnostics.add(key)
        rows.push({
          id: key,
          tone: 'skipped',
          nodeLabel: getNodeDisplayLabelFromMap(nodeLabelMap, log.node_id, nodeLabelOverrides),
          reasonLabel: t({ ko: '비활성 노드', en: 'Disabled node' }),
          sourceLabel: null,
        })
      }
      continue
    }

    if (log.event_type === 'node_skipped_inactive_branch') {
      const details = parseLogDetails(log.details)
      const key = `skipped:${log.node_id}`
      if (!seenNodeDiagnostics.has(key)) {
        seenNodeDiagnostics.add(key)
        rows.push({
          id: key,
          tone: 'skipped',
          nodeLabel: getNodeDisplayLabelFromMap(nodeLabelMap, log.node_id, nodeLabelOverrides),
          reasonLabel: readSkipReasonLabel(details, t),
          sourceLabel: readFirstDisabledInputSource(details, nodeLabelMap, nodeLabelOverrides),
        })
      }
    }
  }

  if (execution.status === 'failed') {
    const failedNodeId = execution.failed_node_id ?? logs.filter((log) => log.node_id).at(-1)?.node_id ?? null
    if (failedNodeId) {
      rows.push({
        id: `failed:${failedNodeId}`,
        tone: 'failed',
        nodeLabel: getNodeDisplayLabelFromMap(nodeLabelMap, failedNodeId, nodeLabelOverrides),
        reasonLabel: t({ ko: '실패 지점', en: 'Failure point' }),
        sourceLabel: execution.error_message ?? null,
      })

      const orderedNodeIds = plan?.orderedNodeIds ?? []
      const failedIndex = orderedNodeIds.indexOf(failedNodeId)
      if (failedIndex !== -1) {
        for (const blockedNodeId of orderedNodeIds.slice(failedIndex + 1)) {
          rows.push({
            id: `blocked:${blockedNodeId}`,
            tone: 'blocked',
            nodeLabel: getNodeDisplayLabelFromMap(nodeLabelMap, blockedNodeId, nodeLabelOverrides),
            reasonLabel: t({ ko: '실패 이후 미실행', en: 'Not run after failure' }),
            sourceLabel: getNodeDisplayLabelFromMap(nodeLabelMap, failedNodeId, nodeLabelOverrides),
          })
        }
      }
    }
  }

  return rows
}

/** Build a reusable node-label lookup map for execution summary surfaces. */
export function buildNodeDisplayLabelMap(selectedGraph: GraphWorkflowRecord | null | undefined) {
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

/** Resolve a human-readable node label from a precomputed graph-label map. */
export function getNodeDisplayLabelFromMap(
  nodeLabelMap: ReadonlyMap<string, string>,
  nodeId: string,
  nodeLabelOverrides?: Record<string, string> | null,
) {
  return resolveNodeDisplayLabel(nodeId, nodeLabelMap.get(nodeId), nodeLabelOverrides)
}

export function getNodeDisplayLabel(
  selectedGraph: GraphWorkflowRecord | null | undefined,
  nodeId: string,
  nodeLabelOverrides?: Record<string, string> | null,
) {
  return getNodeDisplayLabelFromMap(buildNodeDisplayLabelMap(selectedGraph), nodeId, nodeLabelOverrides)
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
      artifacts: [...nodeArtifacts].sort(compareGraphArtifactsNewestFirst),
    }))
    .sort((left, right) => {
      const leftArtifact = left.artifacts[0]
      const rightArtifact = right.artifacts[0]
      if (leftArtifact && rightArtifact) {
        return compareGraphArtifactsNewestFirst(leftArtifact, rightArtifact)
      }

      return leftArtifact ? -1 : rightArtifact ? 1 : 0
    })
}

/** Prefer visual artifacts, then readable text, when picking the most useful compact preview set. */
function pickHighlightedArtifacts(artifacts: GraphExecutionArtifactRecord[]) {
  const sortedArtifacts = [...artifacts]
    .filter((artifact) => !isEmptyLlmJsonArtifact(artifact))
    .sort(compareGraphArtifactsNewestFirst)
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

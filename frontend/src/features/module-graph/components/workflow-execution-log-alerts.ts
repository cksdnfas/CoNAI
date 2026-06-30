import type { GraphExecutionLogRecord } from '@/lib/api-module-graph'

export const FINAL_RESULT_PROMOTION_FAILED_EVENT = 'final_result_promotion_failed'
export const FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT = 'final_result_source_artifact_missing'
export const LLM_JSON_PARSE_FAILED_EVENT = 'llm_json_parse_failed'
export const LLM_PROVIDER_RESPONSE_EVENT = 'llm_provider_response'

export type FinalResultLifecycleWarningKind = 'promotion_failed' | 'source_artifact_missing'

export type FinalResultLifecycleWarning = {
  kind: FinalResultLifecycleWarningKind
  log: GraphExecutionLogRecord
  sourceNodeId?: string | null
  sourcePortKey?: string | null
  sourceArtifactId?: number | null
  errorMessage?: string | null
}

export type LlmResponseDiagnostic = {
  failedLog: GraphExecutionLogRecord | null
  providerLog: GraphExecutionLogRecord | null
  textPreview: string | null
  rawResponsePreview: string | null
}

function parseLogDetails(log: GraphExecutionLogRecord) {
  if (!log.details) {
    return null
  }

  try {
    return JSON.parse(log.details) as Record<string, unknown>
  } catch {
    return null
  }
}

function isFinalResultSourceArtifactMissingLog(log: GraphExecutionLogRecord) {
  if (log.event_type === FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT) {
    return true
  }

  if (log.event_type !== 'node_engine_complete') {
    return false
  }

  const details = parseLogDetails(log)
  return details?.operationKey === 'system.final_result'
    && details?.skippedReason === 'source_artifact_not_persisted'
}

function readDetailsString(details: Record<string, unknown> | null, key: string) {
  const value = details?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readDetailsNumber(details: Record<string, unknown> | null, key: string) {
  const value = details?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildFinalResultLifecycleWarning(kind: FinalResultLifecycleWarningKind, log: GraphExecutionLogRecord): FinalResultLifecycleWarning {
  const details = parseLogDetails(log)
  return {
    kind,
    log,
    sourceNodeId: readDetailsString(details, 'sourceNodeId'),
    sourcePortKey: readDetailsString(details, 'sourcePortKey'),
    sourceArtifactId: readDetailsNumber(details, 'sourceArtifactId'),
    errorMessage: readDetailsString(details, 'errorMessage'),
  }
}

/** Build a compact source label for final-result warning copy from log details. */
export function buildFinalResultLifecycleWarningSourceLabel(
  warning: FinalResultLifecycleWarning | null | undefined,
  sourceNodeLabel?: string | null,
) {
  if (!warning) {
    return null
  }

  const nodeLabel = sourceNodeLabel?.trim() || warning.sourceNodeId || null
  const portLabel = warning.sourcePortKey?.trim() || null
  const label = [nodeLabel, portLabel].filter(Boolean).join(' · ')
  return label || null
}

export function findFinalResultPromotionWarningLog(logs?: readonly GraphExecutionLogRecord[] | null) {
  return logs?.find((log) => log.event_type === FINAL_RESULT_PROMOTION_FAILED_EVENT) ?? null
}

/** Return final-result lifecycle warnings in the same priority order used by the summary banner. */
export function listFinalResultLifecycleWarnings(logs?: readonly GraphExecutionLogRecord[] | null): FinalResultLifecycleWarning[] {
  if (!logs || logs.length === 0) {
    return []
  }

  const promotionWarnings = logs
    .filter((log) => log.event_type === FINAL_RESULT_PROMOTION_FAILED_EVENT)
    .map((log) => buildFinalResultLifecycleWarning('promotion_failed', log))
  const explicitMissingLogs = logs.filter((log) => log.event_type === FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT)
  const missingSourceLogs = explicitMissingLogs.length > 0
    ? explicitMissingLogs
    : logs.filter(isFinalResultSourceArtifactMissingLog)

  return [
    ...promotionWarnings,
    ...missingSourceLogs.map((log) => buildFinalResultLifecycleWarning('source_artifact_missing', log)),
  ]
}

export function findFinalResultLifecycleWarning(logs?: readonly GraphExecutionLogRecord[] | null): FinalResultLifecycleWarning | null {
  return listFinalResultLifecycleWarnings(logs)[0] ?? null
}

function findLatestLogByEventType(logs: readonly GraphExecutionLogRecord[], eventType: string, nodeId?: string | null) {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const log = logs[index]
    if (log.event_type !== eventType) {
      continue
    }

    if (nodeId && log.node_id !== nodeId) {
      continue
    }

    return log
  }

  return null
}

function readLlmDiagnosticText(log: GraphExecutionLogRecord | null, key: 'text' | 'rawResponse') {
  return log ? readDetailsString(parseLogDetails(log), key) : null
}

export function findLlmResponseDiagnostic(logs?: readonly GraphExecutionLogRecord[] | null): LlmResponseDiagnostic | null {
  if (!logs || logs.length === 0) {
    return null
  }

  const failedLog = findLatestLogByEventType(logs, LLM_JSON_PARSE_FAILED_EVENT)
  if (!failedLog) {
    return null
  }

  const providerLog = findLatestLogByEventType(logs, LLM_PROVIDER_RESPONSE_EVENT, failedLog?.node_id)
    ?? findLatestLogByEventType(logs, LLM_PROVIDER_RESPONSE_EVENT)

  return {
    failedLog,
    providerLog,
    textPreview: readLlmDiagnosticText(failedLog, 'text') ?? readLlmDiagnosticText(providerLog, 'text'),
    rawResponsePreview: readLlmDiagnosticText(failedLog, 'rawResponse') ?? readLlmDiagnosticText(providerLog, 'rawResponse'),
  }
}

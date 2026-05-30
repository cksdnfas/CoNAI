import type { GraphExecutionLogRecord } from '@/lib/api-module-graph'

export const FINAL_RESULT_PROMOTION_FAILED_EVENT = 'final_result_promotion_failed'
export const FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT = 'final_result_source_artifact_missing'

export type FinalResultLifecycleWarningKind = 'promotion_failed' | 'source_artifact_missing'

export type FinalResultLifecycleWarning = {
  kind: FinalResultLifecycleWarningKind
  log: GraphExecutionLogRecord
  sourceNodeId?: string | null
  sourcePortKey?: string | null
  sourceArtifactId?: number | null
  errorMessage?: string | null
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

export function findFinalResultLifecycleWarning(logs?: readonly GraphExecutionLogRecord[] | null): FinalResultLifecycleWarning | null {
  const promotionFailureLog = findFinalResultPromotionWarningLog(logs)
  if (promotionFailureLog) {
    return buildFinalResultLifecycleWarning('promotion_failed', promotionFailureLog)
  }

  const missingSourceArtifactLog = logs?.find(isFinalResultSourceArtifactMissingLog)
  return missingSourceArtifactLog ? buildFinalResultLifecycleWarning('source_artifact_missing', missingSourceArtifactLog) : null
}

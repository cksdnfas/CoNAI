import type { GraphExecutionLogRecord } from '@/lib/api-module-graph'

export const FINAL_RESULT_PROMOTION_FAILED_EVENT = 'final_result_promotion_failed'
export const FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT = 'final_result_source_artifact_missing'

export type FinalResultLifecycleWarningKind = 'promotion_failed' | 'source_artifact_missing'

export type FinalResultLifecycleWarning = {
  kind: FinalResultLifecycleWarningKind
  log: GraphExecutionLogRecord
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

export function findFinalResultPromotionWarningLog(logs?: readonly GraphExecutionLogRecord[] | null) {
  return logs?.find((log) => log.event_type === FINAL_RESULT_PROMOTION_FAILED_EVENT) ?? null
}

export function findFinalResultLifecycleWarning(logs?: readonly GraphExecutionLogRecord[] | null): FinalResultLifecycleWarning | null {
  const promotionFailureLog = findFinalResultPromotionWarningLog(logs)
  if (promotionFailureLog) {
    return { kind: 'promotion_failed', log: promotionFailureLog }
  }

  const missingSourceArtifactLog = logs?.find(isFinalResultSourceArtifactMissingLog)
  return missingSourceArtifactLog ? { kind: 'source_artifact_missing', log: missingSourceArtifactLog } : null
}

import type { GraphExecutionLogRecord } from '@/lib/api-module-graph'

export const FINAL_RESULT_PROMOTION_FAILED_EVENT = 'final_result_promotion_failed'

export function findFinalResultPromotionWarningLog(logs?: readonly GraphExecutionLogRecord[] | null) {
  return logs?.find((log) => log.event_type === FINAL_RESULT_PROMOTION_FAILED_EVENT) ?? null
}

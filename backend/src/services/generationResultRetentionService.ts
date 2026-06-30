import { GenerationHistoryModel } from '../models/GenerationHistory'

export const DEFAULT_GENERATION_RESULT_RETENTION_LIMIT = 200

function parseRetentionLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }

  return fallback
}

/** Resolve how many completed generation-result index rows should remain visible. */
export function getGenerationResultRetentionLimit() {
  return parseRetentionLimit(process.env.CONAI_GENERATION_RESULT_RETENTION_LIMIT, DEFAULT_GENERATION_RESULT_RETENTION_LIMIT)
}

/** Keep only the newest completed generation-result index rows. Saved media stays in the image library. */
export function pruneGenerationResultRetention(retentionLimit = getGenerationResultRetentionLimit()) {
  const overflowIds = GenerationHistoryModel.findCompletedOverflowIds(retentionLimit)
  const deleted = GenerationHistoryModel.deleteMany(overflowIds)

  return {
    retention_limit: retentionLimit,
    requested_count: overflowIds.length,
    deleted_count: deleted,
    deleted_history_ids: overflowIds,
  }
}

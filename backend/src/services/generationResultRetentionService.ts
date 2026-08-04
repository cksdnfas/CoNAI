import { apiGenDb } from '../database/apiGenerationDb'
import {
  DEFAULT_GENERATION_HISTORY_MAX_ITEMS,
  normalizeGenerationHistoryMaxItems,
} from '../constants/generationHistory'
import { settingsService } from './settingsService'

export const DEFAULT_GENERATION_RESULT_RETENTION_LIMIT = DEFAULT_GENERATION_HISTORY_MAX_ITEMS
export const GENERATION_HISTORY_RETENTION_BATCH_SIZE = 1_000

interface GenerationHistoryRetentionBatchReport {
  retention_limit: number
  active_count: number
  retained_terminal_count: number
  deleted_count: number
  remaining_overflow_count: number
}

export interface GenerationHistoryRetentionReport extends GenerationHistoryRetentionBatchReport {
  batch_count: number
}

let backgroundPrunePromise: Promise<void> | null = null
let pendingRetentionLimit: number | null = null

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

/** Resolve the configured maximum number of generation-history rows. */
export function getGenerationResultRetentionLimit() {
  return normalizeGenerationHistoryMaxItems(
    settingsService.loadSettings().general.generationHistoryMaxItems,
  )
}

/**
 * Delete at most one bounded batch of oldest terminal history rows.
 * Pending/processing rows count toward the limit but are never deleted, and no media table or file is touched.
 */
export function pruneGenerationResultRetentionBatch(
  retentionLimit = getGenerationResultRetentionLimit(),
  batchSize = GENERATION_HISTORY_RETENTION_BATCH_SIZE,
): GenerationHistoryRetentionBatchReport {
  const safeLimit = normalizeGenerationHistoryMaxItems(retentionLimit)
  const safeBatchSize = Math.max(1, Math.min(GENERATION_HISTORY_RETENTION_BATCH_SIZE, Math.floor(batchSize)))
  const activeCount = (apiGenDb.prepare(`
    SELECT COUNT(*) as total
    FROM api_generation_history
    WHERE generation_status IN ('pending', 'processing')
  `).get() as { total: number }).total
  const terminalCount = (apiGenDb.prepare(`
    SELECT COUNT(*) as total
    FROM api_generation_history
    WHERE generation_status IN ('completed', 'failed')
  `).get() as { total: number }).total
  const retainedTerminalCount = Math.max(0, safeLimit - activeCount)
  const overflowCount = Math.max(0, terminalCount - retainedTerminalCount)
  const requestedDeleteCount = Math.min(overflowCount, safeBatchSize)

  if (requestedDeleteCount === 0) {
    return {
      retention_limit: safeLimit,
      active_count: activeCount,
      retained_terminal_count: retainedTerminalCount,
      deleted_count: 0,
      remaining_overflow_count: 0,
    }
  }

  const deleted = apiGenDb.prepare(`
    DELETE FROM api_generation_history
    WHERE id IN (
      SELECT id
      FROM api_generation_history
      WHERE generation_status IN ('completed', 'failed')
      ORDER BY id ASC
      LIMIT ?
    )
  `).run(requestedDeleteCount).changes

  return {
    retention_limit: safeLimit,
    active_count: activeCount,
    retained_terminal_count: retainedTerminalCount,
    deleted_count: deleted,
    remaining_overflow_count: Math.max(0, overflowCount - deleted),
  }
}

/** Drain history overflow in bounded batches while yielding between SQLite writes. */
export async function pruneGenerationResultRetention(
  retentionLimit = getGenerationResultRetentionLimit(),
): Promise<GenerationHistoryRetentionReport> {
  const safeLimit = normalizeGenerationHistoryMaxItems(retentionLimit)
  let batchCount = 0
  let totalDeleted = 0
  let latestBatch = pruneGenerationResultRetentionBatch(safeLimit)

  while (true) {
    batchCount += 1
    totalDeleted += latestBatch.deleted_count

    if (latestBatch.remaining_overflow_count === 0 || latestBatch.deleted_count === 0) {
      return {
        ...latestBatch,
        deleted_count: totalDeleted,
        batch_count: batchCount,
      }
    }

    await yieldToEventLoop()
    latestBatch = pruneGenerationResultRetentionBatch(safeLimit)
  }
}

function startRequestedBackgroundPrune() {
  if (backgroundPrunePromise || pendingRetentionLimit === null) {
    return
  }

  const retentionLimit = pendingRetentionLimit
  pendingRetentionLimit = null

  backgroundPrunePromise = (async () => {
    await yieldToEventLoop()
    const report = await pruneGenerationResultRetention(retentionLimit)
    if (report.deleted_count > 0) {
      console.log(`🧹 Generation history retention: ${report.deleted_count} DB rows removed in ${report.batch_count} batches, ${retentionLimit} retained`)
    }
  })()
    .catch((error) => {
      console.warn('⚠️ Failed to prune generation history retention:', error instanceof Error ? error.message : error)
    })
    .finally(() => {
      backgroundPrunePromise = null
      startRequestedBackgroundPrune()
    })
}

/** Coalesce terminal-state writes and settings changes into one background retention pass. */
export function requestGenerationResultRetentionPrune(retentionLimit = getGenerationResultRetentionLimit()) {
  pendingRetentionLimit = normalizeGenerationHistoryMaxItems(retentionLimit)
  startRequestedBackgroundPrune()
}

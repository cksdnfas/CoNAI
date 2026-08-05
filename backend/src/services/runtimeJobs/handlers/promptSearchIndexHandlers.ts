import { PromptSearchIndexService } from '../../promptSearchIndexService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'
import { RuntimeJobConflictError } from '../runtimeJobStore'

export type PromptSearchIndexJobParams = Record<string, never>

export interface PromptSearchIndexJobResult {
  indexed: number
  completed: boolean
}

/**
 * Prompt search index backfill (HEAVY-1).
 *
 * Migration 031 creates the FTS5 index empty on purpose — indexing a 200k-row
 * table takes seconds to minutes and cannot be allowed to hold up the first boot.
 * This job walks the table in bounded rowid ranges and flips the index live when
 * it reaches the end. Until then `PromptSearchIndexService.isReady()` stays false
 * and every search runs the original LIKE path, so the index being half-built is
 * never observable in search results.
 */

/** Per-batch wall-clock budget. The batch size adapts to stay inside it. */
const BATCH_TIME_BUDGET_MS = 10
/** Hard cap on how long one write transaction may stall the event loop. */
const MAX_PAUSE_MS = 50
const MIN_BATCH_ROWS = 50
const MAX_BATCH_ROWS = 4000
const INITIAL_BATCH_ROWS = 400

/** Do not re-ask for a backfill on every search while one is already queued. */
const REQUEST_COOLDOWN_MS = 60_000
let lastRequestedAt = 0

/**
 * Ask for the backfill from a request path.
 *
 * Safe to call from a hot search: it never throws, does no index work inline, and
 * collapses to a no-op once the index is ready or a job already owns the key.
 */
export function requestPromptSearchIndexBackfill(): void {
  try {
    if (!PromptSearchIndexService.needsBackfill()) {
      return
    }

    const now = Date.now()
    if (now - lastRequestedAt < REQUEST_COOLDOWN_MS) {
      return
    }
    lastRequestedAt = now

    try {
      RuntimeJobRunner.start<PromptSearchIndexJobParams>('media-prompt-index', {} as PromptSearchIndexJobParams, {
        requestedByAccountId: null,
      })
    } catch (error) {
      if (!(error instanceof RuntimeJobConflictError)) {
        throw error
      }
    }
  } catch (error) {
    console.warn(
      '[PromptSearchIndex] Failed to queue the backfill:',
      error instanceof Error ? error.message : error,
    )
  }
}

async function runPromptSearchIndexBackfill(
  ctx: RuntimeJobContext<PromptSearchIndexJobParams>,
): Promise<PromptSearchIndexJobResult> {
  const state = PromptSearchIndexService.readState()

  if (state.status === 'ready') {
    ctx.flush({ phase: 'ready', total: 0, processed: 0, currentLabel: null })
    return { indexed: 0, completed: true }
  }

  if (state.status !== 'pending') {
    ctx.recordWarning(`Prompt search index is ${state.status}; nothing to backfill.`)
    return { indexed: 0, completed: false }
  }

  let cursor = state.lastRowid
  let maxRowid = PromptSearchIndexService.readMaxRowid()
  let batchRows = INITIAL_BATCH_ROWS
  let indexed = 0

  ctx.flush({ phase: 'index', total: maxRowid, processed: Math.min(cursor, maxRowid), currentLabel: null })

  while (cursor < maxRowid) {
    ctx.throwIfCancelled()

    const target = Math.min(cursor + batchRows, maxRowid)
    const startedAt = Date.now()
    try {
      indexed += PromptSearchIndexService.indexRowidRange(cursor, target)
    } catch (error) {
      // A broken index is worse than no index: stop and leave search on LIKE.
      PromptSearchIndexService.markDisabled(error instanceof Error ? error.message : String(error))
      ctx.recordError(`rowid<=${target}`, error)
      return { indexed, completed: false }
    }
    const elapsed = Date.now() - startedAt
    cursor = target

    // Keep one transaction short enough that an HTTP request waiting behind it
    // does not notice. Growth is capped so a fast run cannot drift into a stall.
    if (elapsed > MAX_PAUSE_MS) {
      batchRows = Math.max(MIN_BATCH_ROWS, Math.floor(batchRows / 2))
    } else if (elapsed < BATCH_TIME_BUDGET_MS) {
      batchRows = Math.min(MAX_BATCH_ROWS, Math.ceil(batchRows * 1.5))
    }

    ctx.report({ total: maxRowid, processed: cursor, succeeded: indexed, currentLabel: `rowid ${cursor}` })
    await ctx.yield()

    if (cursor >= maxRowid) {
      // Rows inserted while the backfill was running sit above the watermark and
      // were skipped by the sync triggers, so re-read the ceiling before finishing.
      maxRowid = PromptSearchIndexService.readMaxRowid()
    }
  }

  PromptSearchIndexService.markReady()
  ctx.flush({ phase: 'ready', total: maxRowid, processed: maxRowid, succeeded: indexed, currentLabel: null })
  console.log(`✅ Prompt search index backfill complete (${indexed} rows indexed)`)

  return { indexed, completed: true }
}

export function registerPromptSearchIndexJobHandlers(): void {
  RuntimeJobRunner.register<PromptSearchIndexJobParams, PromptSearchIndexJobResult>({
    kind: 'media-prompt-index',
    // One writer for the whole index: a second run would fight over the watermark.
    singletonKey: () => 'media-prompt-index',
    handler: runPromptSearchIndexBackfill,
  })
}

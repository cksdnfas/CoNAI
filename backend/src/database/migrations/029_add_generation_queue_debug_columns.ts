import type { Database } from 'better-sqlite3';

/**
 * 029: generation_queue_jobs.debug_enabled + debug_meta (PAYLOAD-2)
 *
 * Queue debug bookkeeping used to live inside `request_payload._debug`. Every
 * read of the flag (`isQueueDetailedDebugEnabled`, once per debug snapshot stage)
 * parsed the whole multi-MB payload, and every write of the metadata re-parsed it
 * and then re-serialized the entire payload back into the row. A single ComfyUI
 * job did that 5-8 times, which is pure event-loop blocking on a synchronous
 * better-sqlite3 process.
 *
 * Splitting the two concerns out into their own narrow columns makes the flag a
 * single integer read and the metadata write a small-JSON UPDATE that never
 * rewrites the payload blob.
 *
 * Columns:
 *   debug_enabled INTEGER - 1 when the job asked for detailed request snapshots
 *                           (`_debug.workflow_debug_mode` / `_debug.detailed_snapshots`).
 *                           NULL means "never evaluated" and keeps the legacy
 *                           payload fallback alive for rows written before 029.
 *   debug_meta    TEXT    - JSON object mirroring the old `request_payload._debug`
 *                           bag (history ids, result hashes, cancellation trace).
 *
 * Backward compatibility (plan §1-8): rows left with `debug_enabled IS NULL` are
 * still answered from the inline `request_payload._debug` object, and that
 * fallback is evaluated inside SQLite (`json_extract`) so the payload never has
 * to cross into JS. See `GenerationQueueModel.readDebugState`.
 *
 * Backfill scope: unfinished jobs (they will still be dispatched under the new
 * code) plus the newest terminal rows. Rewriting every historical row would
 * rewrite its multi-MB payload page chain too and blow up the WAL for data that
 * the legacy fallback already answers correctly.
 *
 * NOTE ON WIRING: `generation_queue_jobs` lives in user.db, not images.db, and
 * the `MigrationManager` in this directory only runs against images.db. The real
 * invocation is `createUserSettingsSchema()` calling
 * `applyGenerationQueueDebugColumns()`; the `up`/`down` handlers below stay
 * table-guarded so an images.db pass is a no-op. Keeping the SQL here preserves
 * the reserved 029 slot and keeps one source of truth for the statements.
 *
 * This file stays dependency-free on purpose: portable/SEA builds copy the
 * compiled migrations directory on its own, so it cannot import project modules.
 */

const DEBUG_BACKFILL_RECENT_TERMINAL_LIMIT = 500;

function hasQueueTable(db: Database): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='generation_queue_jobs'").get());
}

function hasQueueColumn(db: Database, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(generation_queue_jobs)`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

/**
 * Add the queue debug columns and seed them where it is cheap to do so.
 * Safe to call on every startup: the ALTERs are guarded and the backfill only
 * runs on the pass that actually introduced the columns.
 */
export function applyGenerationQueueDebugColumns(db: Database): boolean {
  if (!hasQueueTable(db)) {
    return false;
  }

  let addedColumn = false;

  if (!hasQueueColumn(db, 'debug_enabled')) {
    db.exec('ALTER TABLE generation_queue_jobs ADD COLUMN debug_enabled INTEGER');
    addedColumn = true;
  }

  if (!hasQueueColumn(db, 'debug_meta')) {
    db.exec('ALTER TABLE generation_queue_jobs ADD COLUMN debug_meta TEXT');
    addedColumn = true;
  }

  // Covering index so the hot debug-flag read never touches the wide row.
  // `request_payload` sits physically before these columns, so a plain table
  // lookup would have to walk the multi-MB overflow page chain just to reach
  // them; an index that carries both columns answers the read outright.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_generation_queue_jobs_debug_state
      ON generation_queue_jobs(id, debug_enabled, debug_meta)
  `);

  if (!addedColumn) {
    return false;
  }

  // One statement, no per-row loop. `json_extract` on an object path returns the
  // object's JSON text, which is exactly the shape the runtime reader expects.
  const backfilled = db.prepare(`
    UPDATE generation_queue_jobs
    SET debug_meta = CASE
          WHEN json_valid(request_payload) THEN json_extract(request_payload, '$._debug')
          ELSE NULL
        END,
        debug_enabled = CASE
          WHEN json_valid(request_payload)
            AND (
              json_extract(request_payload, '$._debug.workflow_debug_mode') = 1
              OR json_extract(request_payload, '$._debug.detailed_snapshots') = 1
            )
          THEN 1
          ELSE 0
        END
    WHERE debug_enabled IS NULL
      AND (
        status IN ('queued', 'dispatching', 'running')
        OR id IN (
          SELECT id
          FROM generation_queue_jobs
          WHERE status IN ('completed', 'failed', 'cancelled')
          ORDER BY COALESCE(completed_at, started_at, queued_at, created_date) DESC, id DESC
          LIMIT ?
        )
      )
  `).run(DEBUG_BACKFILL_RECENT_TERMINAL_LIMIT);

  console.log(`  Migrating generation_queue_jobs: added debug_enabled/debug_meta (backfilled ${backfilled.changes} rows)`);
  return true;
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 029_add_generation_queue_debug_columns.ts');

  if (!applyGenerationQueueDebugColumns(db)) {
    console.log('ℹ️  generation_queue_jobs is not in this database (it lives in user.db); nothing to do here.');
  }
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 029_add_generation_queue_debug_columns.ts');
  db.exec('DROP INDEX IF EXISTS idx_generation_queue_jobs_debug_state');
  console.log('⚠️  generation_queue_jobs.debug_enabled / debug_meta are kept (harmless; readers fall back to request_payload._debug).');
};

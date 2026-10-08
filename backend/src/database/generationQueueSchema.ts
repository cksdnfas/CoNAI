import type { Database } from 'better-sqlite3';

/**
 * user.db additions for generation_queue_jobs, applied by createUserSettingsSchema() on every startup.
 * They used to sit in images.db migrations 029 / 032 / 035 as table-guarded no-ops; each step is idempotent.
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
 * generation_queue_jobs.debug_enabled + debug_meta (PAYLOAD-2)
 *
 * Queue debug bookkeeping used to live inside `request_payload._debug`. Every
 * read of the flag (`isQueueDetailedDebugEnabled`, once per debug snapshot stage)
 * parsed the whole multi-MB payload, and every write of the metadata re-parsed it
 * and then re-serialized the entire payload back into the row. Splitting the two
 * concerns out into their own narrow columns makes the flag a single integer read
 * and the metadata write a small-JSON UPDATE that never rewrites the payload blob.
 *
 * Columns:
 *   debug_enabled INTEGER - 1 when the job asked for detailed request snapshots
 *                           (`_debug.workflow_debug_mode` / `_debug.detailed_snapshots`).
 *                           NULL means "never evaluated" and keeps the legacy
 *                           payload fallback alive for rows written before the split.
 *   debug_meta    TEXT    - JSON object mirroring the old `request_payload._debug`
 *                           bag (history ids, result hashes, cancellation trace).
 *
 * Rows left with `debug_enabled IS NULL` are still answered from the inline
 * `request_payload._debug` object, evaluated inside SQLite (`json_extract`) so the
 * payload never has to cross into JS. See `GenerationQueueModel.readDebugState`.
 *
 * Backfill scope: unfinished jobs plus the newest terminal rows. Rewriting every
 * historical row would rewrite its multi-MB payload page chain too and blow up the
 * WAL for data that the legacy fallback already answers correctly.
 *
 * The backfill only runs on the pass that actually introduced the columns.
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

/**
 * generation_queue_input_refs (PAYLOAD-3)
 *
 * Base64 image inputs no longer live inside `request_payload`; they are written
 * once to a content-addressed file and the payload keeps only a reference. This
 * table is the refcount that decides when such a file may be deleted.
 *
 * One row per (job, blob). A blob's file is removable only when no row references
 * it any more, and rows are dropped exactly when the owning job's payload is
 * compacted by `pruneTerminalRequestPayloads` — i.e. at the same moment the job
 * stops being retryable. Keying the lifetime to pruning (rather than to a
 * terminal status) is what keeps retry, cancellation and orphan reconcile safe:
 * a cancelled-but-unpruned job can still be retried, and its inputs are still
 * there when it is.
 */
export function applyGenerationQueueInputRefs(db: Database): boolean {
  if (!hasQueueTable(db)) {
    return false;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_queue_input_refs (
      job_id INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, sha256)
    );
  `);

  // Refcount lookups go blob-first ("is anyone still using this file?"), which the
  // composite primary key cannot answer without a scan.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_generation_queue_input_refs_sha256
      ON generation_queue_input_refs(sha256);
  `);

  return true;
}

/** Durable queue idempotency registry. */
export function applyGenerationQueueIdempotency(db: Database): boolean {
  if (!hasQueueTable(db)) {
    return false;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_queue_idempotency (
      scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      job_id INTEGER NOT NULL UNIQUE,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (scope, idempotency_key),
      FOREIGN KEY (job_id) REFERENCES generation_queue_jobs(id) ON DELETE CASCADE
    )
  `);

  return true;
}

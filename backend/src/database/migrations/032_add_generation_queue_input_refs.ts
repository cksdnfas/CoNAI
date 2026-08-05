import type { Database } from 'better-sqlite3';

/**
 * 032: generation_queue_input_refs (PAYLOAD-3)
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
 *
 * NOTE ON WIRING: like 029, `generation_queue_jobs` lives in user.db while the
 * `MigrationManager` in this directory runs against images.db, so `up`/`down`
 * are table-guarded no-ops and `createUserSettingsSchema()` performs the real
 * invocation through `applyGenerationQueueInputRefs()`.
 *
 * This file stays dependency-free on purpose: portable/SEA builds copy the
 * compiled migrations directory on its own, so it cannot import project modules.
 */

function hasQueueTable(db: Database): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='generation_queue_jobs'").get());
}

/** Create the queue input refcount table. Safe to call on every startup. */
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

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 032_add_generation_queue_input_refs.ts');

  if (!applyGenerationQueueInputRefs(db)) {
    console.log('ℹ️  generation_queue_jobs is not in this database (it lives in user.db); nothing to do here.');
  }
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 032_add_generation_queue_input_refs.ts');
  db.exec('DROP INDEX IF EXISTS idx_generation_queue_input_refs_sha256');
  db.exec('DROP TABLE IF EXISTS generation_queue_input_refs');
  console.log('⚠️  Stored queue input files are left on disk; the startup sweep removes unreferenced ones.');
};

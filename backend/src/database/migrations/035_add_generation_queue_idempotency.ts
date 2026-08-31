import type { Database } from 'better-sqlite3'

function hasQueueTable(db: Database): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='generation_queue_jobs'").get())
}

/** Create the durable queue idempotency registry. Safe to call on every startup. */
export function applyGenerationQueueIdempotency(db: Database): boolean {
  if (!hasQueueTable(db)) {
    return false
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
  `)

  return true
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 035_add_generation_queue_idempotency.ts')

  if (!applyGenerationQueueIdempotency(db)) {
    console.log('ℹ️  generation_queue_jobs is not in this database (it lives in user.db); nothing to do here.')
  }
}

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 035_add_generation_queue_idempotency.ts')
  db.exec('DROP TABLE IF EXISTS generation_queue_idempotency')
}

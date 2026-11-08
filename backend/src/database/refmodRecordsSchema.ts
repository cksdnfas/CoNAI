import type Database from 'better-sqlite3';

export function ensureRefModRecordsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS minimax_refmod_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      server_id INTEGER NOT NULL,
      workflow_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pending', 'saved', 'failed')),
      concept_type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      queue_job_id INTEGER,
      history_id INTEGER,
      prompt_id TEXT,
      export_node_id TEXT NOT NULL,
      members_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_refmod_records_server_name
      ON minimax_refmod_records(server_id, name, status, id DESC);
    CREATE INDEX IF NOT EXISTS idx_refmod_records_history
      ON minimax_refmod_records(history_id);
    CREATE INDEX IF NOT EXISTS idx_refmod_records_queue
      ON minimax_refmod_records(queue_job_id);
  `);
}

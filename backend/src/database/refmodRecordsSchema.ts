import type Database from 'better-sqlite3';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}

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

    -- A RefMod entry: the named definition people manage. Records above stay the run log.
    CREATE TABLE IF NOT EXISTS refmod_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      concept_type TEXT NOT NULL DEFAULT 'generic',
      description TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '[]',
      workflow_id INTEGER,
      director_value TEXT,
      extra_values TEXT NOT NULL DEFAULT '{}',
      members TEXT NOT NULL DEFAULT '[]',
      folder_id TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      registered INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_built_at TEXT,
      last_record_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_refmod_entries_updated ON refmod_entries(updated_at DESC, id DESC);
    -- Every file-store copy an entry uses; FileStoreService refuses to delete or overwrite these.
    CREATE TABLE IF NOT EXISTS refmod_entry_files (
      entry_id INTEGER NOT NULL REFERENCES refmod_entries(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      PRIMARY KEY (entry_id, file_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_refmod_entry_files_file ON refmod_entry_files(file_id);
  `);
  if (!hasColumn(db, 'minimax_refmod_records', 'entry_id')) db.exec('ALTER TABLE minimax_refmod_records ADD COLUMN entry_id INTEGER');
  if (!hasColumn(db, 'minimax_refmod_records', 'director_value')) db.exec('ALTER TABLE minimax_refmod_records ADD COLUMN director_value TEXT');
  if (!hasColumn(db, 'refmod_entries', 'registered')) db.exec('ALTER TABLE refmod_entries ADD COLUMN registered INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE INDEX IF NOT EXISTS idx_refmod_records_entry ON minimax_refmod_records(entry_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_refmod_entries_registered ON refmod_entries(registered, updated_at DESC, id DESC)');
}

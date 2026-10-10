import type Database from 'better-sqlite3';

/** Additive and idempotent for both packaged and SQL-migration startup paths. */
export function ensureFileStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stored_file_entries (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      parent_id TEXT REFERENCES stored_file_entries(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('file', 'folder')),
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0 CHECK(size >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stored_files_name
      ON stored_file_entries(owner_key, COALESCE(parent_id, ''), name_key) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_stored_files_parent ON stored_file_entries(owner_key, parent_id, deleted_at);
    CREATE TABLE IF NOT EXISTS chat_file_attachments (
      message_id INTEGER NOT NULL REFERENCES codex_chat_messages(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES stored_file_entries(id) ON DELETE RESTRICT,
      PRIMARY KEY(message_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_file_attachments_file ON chat_file_attachments(file_id);
  `);
  // The tagger's weighted rating score of an image or video file (contentRating.ts); null: not rated (yet).
  if (!(db.prepare('PRAGMA table_info(stored_file_entries)').all() as Array<{ name: string }>).some((column) => column.name === 'rating_score')) {
    db.exec('ALTER TABLE stored_file_entries ADD COLUMN rating_score REAL');
  }
}

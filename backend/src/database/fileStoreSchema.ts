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
    CREATE TABLE IF NOT EXISTS chat_file_attachments (
      message_id INTEGER NOT NULL REFERENCES codex_chat_messages(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES stored_file_entries(id) ON DELETE RESTRICT,
      PRIMARY KEY(message_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_file_attachments_file ON chat_file_attachments(file_id);
  `);
  // owner_key is historical provenance only. Resolve old per-account root collisions once,
  // preserving IDs, descendants, attachments and existing file references.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_stored_files_shared_name'").get()) {
    db.transaction(() => {
      const collisions = db.prepare(`SELECT id,name,parent_id FROM (
        SELECT id,name,parent_id,ROW_NUMBER() OVER (PARTITION BY COALESCE(parent_id,''),name_key ORDER BY owner_key,id) AS n
        FROM stored_file_entries WHERE deleted_at IS NULL) WHERE n>1`).all() as Array<{id:string;name:string;parent_id:string|null}>;
      const exists = db.prepare('SELECT 1 FROM stored_file_entries WHERE parent_id IS ? AND name_key=? AND deleted_at IS NULL');
      const rename = db.prepare('UPDATE stored_file_entries SET name=?,name_key=? WHERE id=?');
      for (const row of collisions) {
        const dot = row.name.lastIndexOf('.');
        const extension = dot > 0 && Buffer.byteLength(row.name.slice(dot)) < 64 ? row.name.slice(dot) : '';
        let stem = extension ? row.name.slice(0,dot) : row.name;
        let suffix = ` (이전 ${row.id.slice(0,8)})`;
        let attempt = 0;
        while (Buffer.byteLength(stem+suffix+extension)>240) stem = Array.from(stem).slice(0,-1).join('');
        let name = stem+suffix+extension;
        while (exists.get(row.parent_id,name.toLowerCase())) {
          suffix = ` (이전 ${row.id.slice(0,8)}-${++attempt})`;
          while (Buffer.byteLength(stem+suffix+extension)>240) stem = Array.from(stem).slice(0,-1).join('');
          name = stem+suffix+extension;
        }
        rename.run(name,name.toLowerCase(),row.id);
      }
      db.exec(`DROP INDEX IF EXISTS idx_stored_files_name;
        DROP INDEX IF EXISTS idx_stored_files_parent;
        CREATE UNIQUE INDEX idx_stored_files_shared_name ON stored_file_entries(COALESCE(parent_id,''),name_key) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_stored_files_shared_parent ON stored_file_entries(parent_id,deleted_at);`);
    }).immediate();
  }
  // The tagger's weighted rating score of an image or video file (contentRating.ts); null: not rated (yet).
  if (!(db.prepare('PRAGMA table_info(stored_file_entries)').all() as Array<{ name: string }>).some((column) => column.name === 'rating_score')) {
    db.exec('ALTER TABLE stored_file_entries ADD COLUMN rating_score REAL');
  }
}

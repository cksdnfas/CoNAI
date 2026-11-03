import type Database from 'better-sqlite3';

/** Additive and idempotent for both packaged and SQL-migration startup paths. */
export function ensureFileStoreSchema(db: Database.Database): void {
  db.transaction(() => {
  const hadPrivateContexts = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_private_attachment_contexts'").get());
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
    CREATE TABLE IF NOT EXISTS chat_private_attachment_contexts (
      thread_id INTEGER PRIMARY KEY REFERENCES codex_chat_threads(id) ON DELETE CASCADE
    );
  `);
  if (!(db.prepare('PRAGMA table_info(stored_file_entries)').all() as Array<{ name: string }>).some(column => column.name === 'chat_owner_key')) {
    db.exec('ALTER TABLE stored_file_entries ADD COLUMN chat_owner_key TEXT');
  }
  const sharedIndex = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_stored_files_shared_name'").get() as { sql: string } | undefined;
  if (sharedIndex && !sharedIndex.sql.includes('chat_owner_key')) db.exec('DROP INDEX idx_stored_files_shared_name');
  // owner_key is historical provenance only. Resolve old per-account root collisions once,
  // preserving IDs, descendants, attachments and existing file references.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_stored_files_shared_name'").get()) {
    db.transaction(() => {
      const collisions = db.prepare(`SELECT id,name,parent_id FROM (
        SELECT id,name,parent_id,ROW_NUMBER() OVER (PARTITION BY COALESCE(parent_id,''),name_key ORDER BY owner_key,id) AS n
        FROM stored_file_entries WHERE deleted_at IS NULL AND chat_owner_key IS NULL) WHERE n>1`).all() as Array<{id:string;name:string;parent_id:string|null}>;
      const exists = db.prepare('SELECT 1 FROM stored_file_entries WHERE parent_id IS ? AND name_key=? AND deleted_at IS NULL AND chat_owner_key IS NULL');
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
        CREATE UNIQUE INDEX idx_stored_files_shared_name ON stored_file_entries(COALESCE(parent_id,''),name_key) WHERE deleted_at IS NULL AND chat_owner_key IS NULL;
        CREATE INDEX IF NOT EXISTS idx_stored_files_shared_parent ON stored_file_entries(parent_id,deleted_at);`);
    }).immediate();
  }
  // The tagger's weighted rating score of an image or video file (contentRating.ts); null: not rated (yet).
  if (!(db.prepare('PRAGMA table_info(stored_file_entries)').all() as Array<{ name: string }>).some((column) => column.name === 'rating_score')) {
    db.exec('ALTER TABLE stored_file_entries ADD COLUMN rating_score REAL');
  }
  if (!hadPrivateContexts) {
    db.exec(`INSERT OR IGNORE INTO chat_private_attachment_contexts (thread_id)
      SELECT m.thread_id FROM chat_file_attachments a
      JOIN stored_file_entries e ON e.id = a.file_id AND e.chat_owner_key IS NOT NULL
      JOIN codex_chat_messages m ON m.id = a.message_id;
      INSERT OR IGNORE INTO chat_private_attachment_contexts (thread_id)
      SELECT m.thread_id FROM codex_chat_messages m
      WHERE EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(m.tool_calls) THEN m.tool_calls ELSE '[]' END) c
        WHERE json_extract(c.value, '$.tool') = 'read_chat_attachment')
        OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(m.alternatives) THEN m.alternatives ELSE '[]' END) v,
          json_each(v.value, '$.tool_calls') c WHERE json_extract(c.value, '$.tool') = 'read_chat_attachment');`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stored_files_chat_owner ON stored_file_entries(chat_owner_key, created_at)
      WHERE chat_owner_key IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS chat_attachment_private_context AFTER INSERT ON chat_file_attachments
      WHEN EXISTS (SELECT 1 FROM stored_file_entries WHERE id = NEW.file_id AND chat_owner_key IS NOT NULL)
      BEGIN
        INSERT OR IGNORE INTO chat_private_attachment_contexts (thread_id)
          SELECT thread_id FROM codex_chat_messages WHERE id = NEW.message_id;
      END;
    CREATE TRIGGER IF NOT EXISTS chat_attachment_owner BEFORE INSERT ON chat_file_attachments
      WHEN EXISTS (SELECT 1 FROM stored_file_entries WHERE id = NEW.file_id AND chat_owner_key IS NOT NULL)
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM stored_file_entries e
          JOIN codex_chat_messages m ON m.id = NEW.message_id
          JOIN codex_chat_threads t ON t.id = m.thread_id
          WHERE e.id = NEW.file_id AND e.deleted_at IS NULL
            AND e.chat_owner_key = 'chat-attachment:' || CASE WHEN t.account_id IS NULL THEN 'bootstrap' ELSE 'account:' || t.account_id END
        ) THEN RAISE(ABORT, 'Private attachment owner mismatch') END;
      END;
    CREATE TRIGGER IF NOT EXISTS chat_attachment_release AFTER DELETE ON chat_file_attachments BEGIN
      UPDATE stored_file_entries SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = OLD.file_id AND chat_owner_key IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM chat_file_attachments WHERE file_id = OLD.file_id);
    END;
  `);
  }).immediate();
}

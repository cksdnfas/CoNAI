import type Database from 'better-sqlite3'

export function ensureCharacterLibrarySchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES character_folders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_folders_name ON character_folders(COALESCE(parent_id, 0), name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_character_folders_parent ON character_folders(parent_id);
    CREATE TABLE IF NOT EXISTS character_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER REFERENCES character_folders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      appearance TEXT NOT NULL DEFAULT '',
      reference_hash TEXT,
      avatar_hash TEXT,
      avatar_crop TEXT,
      asset_group_id INTEGER,
      expression_group_id INTEGER,
      candidate_group_id INTEGER,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_settings_name ON character_settings(COALESCE(folder_id, 0), name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_character_settings_folder ON character_settings(folder_id);
  `)
  // Some isolated migration callers have only the old minimal profile table.
  if ((db.prepare('PRAGMA table_info(llm_chat_profiles)').all() as Array<{ name: string }>).some((column) => column.name === 'character_setting_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_character_setting ON llm_chat_profiles(character_setting_id, character_sync)')
  }
}

import type Database from 'better-sqlite3'
import { characterTagValues, type CharacterOutfit } from '@conai/shared'

/** Replace a setting's tag index (search and filters): its appearance text and every outfit, not only the default. */
export function indexCharacterSettingTags(db: Database.Database, settingId: number, appearance: string, outfits: readonly CharacterOutfit[]) {
  db.prepare('DELETE FROM character_setting_tags WHERE setting_id = ?').run(settingId)
  const insert = db.prepare('INSERT OR IGNORE INTO character_setting_tags(setting_id, tag) VALUES (?, ?)')
  for (const tag of characterTagValues([appearance, ...outfits.map((outfit) => outfit.tags)].join(','))) insert.run(settingId, tag)
}

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
    CREATE TABLE IF NOT EXISTS character_setting_tags (
      setting_id INTEGER NOT NULL REFERENCES character_settings(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (setting_id, tag)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_character_setting_tags_tag ON character_setting_tags(tag, setting_id);
  `)
  const columns = new Set((db.prepare('PRAGMA table_info(character_settings)').all() as Array<{ name: string }>).map((column) => column.name))
  // `sections` NULL: saved before sections existed; it reads as the whole appearance under `other`.
  if (!columns.has('sections')) db.exec('ALTER TABLE character_settings ADD COLUMN sections TEXT')
  if (!columns.has('outfits')) db.exec("ALTER TABLE character_settings ADD COLUMN outfits TEXT NOT NULL DEFAULT '[]'")
  if (!columns.has('favorite')) db.exec('ALTER TABLE character_settings ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0')
  db.exec('CREATE INDEX IF NOT EXISTS idx_character_settings_favorite ON character_settings(favorite) WHERE favorite = 1')
  // Settings from before the index (and ones without any tag, which are cheap to recheck) get indexed here.
  const unindexed = db.prepare('SELECT id, appearance, outfits FROM character_settings s WHERE NOT EXISTS (SELECT 1 FROM character_setting_tags t WHERE t.setting_id = s.id)').all() as Array<{ id: number; appearance: string; outfits: string }>
  if (unindexed.length) db.transaction(() => { for (const row of unindexed) indexCharacterSettingTags(db, row.id, row.appearance, JSON.parse(row.outfits) as CharacterOutfit[]) })()
  // Some isolated migration callers have only the old minimal profile table.
  if ((db.prepare('PRAGMA table_info(llm_chat_profiles)').all() as Array<{ name: string }>).some((column) => column.name === 'character_setting_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_character_setting ON llm_chat_profiles(character_setting_id, character_sync)')
  }
}

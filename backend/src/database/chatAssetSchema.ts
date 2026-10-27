import type Database from 'better-sqlite3'
import { ensureCharacterLibrarySchema } from './characterLibrarySchema'

export const DEFAULT_EXPRESSION_PRESET_NAME = '기본 캐릭터 표정'
export const DEFAULT_EXPRESSION_ITEMS = [
  { description: '중립', value: 'neutral expression, closed mouth' },
  { description: '기쁨', value: 'smile, happy, open mouth' },
  { description: '슬픔', value: 'sad, tears, crying' },
  { description: '분노', value: 'angry, frown' },
  { description: '두려움', value: 'scared, trembling' },
  { description: '놀람', value: 'surprised, wide-eyed, open mouth' },
  { description: '애정', value: 'smile, blush, heart' },
  { description: '부끄러움', value: 'blush, embarrassed' },
]

/** Idempotent schema/seed for new databases and the existing compatibility path. */
export function ensureChatAssetSchema(db: Database.Database) {
  ensureCharacterLibrarySchema(db)
  const columns = db.prepare('PRAGMA table_info(chat_asset_batches)').all() as Array<{ name: string }>
  if (columns.length && !columns.some((column) => column.name === 'setting_id')) {
    // Rebuild both tables together: keeping the child rows avoids DROP's FK cascade, even when
    // this compatibility migration is called inside the settings bootstrap transaction.
    db.transaction(() => {
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'chat_asset_batches'").get() as { seq: number } | undefined
      db.exec(`
        CREATE TEMP TABLE chat_asset_slots_backup AS SELECT * FROM chat_asset_slots;
        DROP TABLE chat_asset_slots;
        CREATE TABLE chat_asset_batches_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER,
          profile_id INTEGER REFERENCES llm_chat_profiles(id) ON DELETE CASCADE,
          setting_id INTEGER REFERENCES character_settings(id) ON DELETE CASCADE,
          preset_id INTEGER NOT NULL, snapshot TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK ((profile_id IS NOT NULL) + (setting_id IS NOT NULL) = 1)
        );
        INSERT INTO chat_asset_batches_next(id, account_id, profile_id, preset_id, snapshot, created_at)
          SELECT id, account_id, profile_id, preset_id, snapshot, created_at FROM chat_asset_batches;
        DROP TABLE chat_asset_batches;
        ALTER TABLE chat_asset_batches_next RENAME TO chat_asset_batches;
        CREATE TABLE chat_asset_slots (
          batch_id INTEGER NOT NULL REFERENCES chat_asset_batches(id) ON DELETE CASCADE,
          slot_key TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('expression', 'background', 'full', 'avatar', 'reference')),
          prompt TEXT NOT NULL, attempts TEXT NOT NULL DEFAULT '[]', chosen_hash TEXT,
          PRIMARY KEY(batch_id, slot_key)
        );
        INSERT INTO chat_asset_slots SELECT * FROM chat_asset_slots_backup;
        DROP TABLE chat_asset_slots_backup;
      `)
      if (sequence) db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'chat_asset_batches'").run(sequence.seq)
    })()
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_asset_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      profile_id INTEGER REFERENCES llm_chat_profiles(id) ON DELETE CASCADE,
      setting_id INTEGER REFERENCES character_settings(id) ON DELETE CASCADE,
      preset_id INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((profile_id IS NOT NULL) + (setting_id IS NOT NULL) = 1)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_asset_batches_request
      ON chat_asset_batches(COALESCE(account_id, 0), COALESCE(profile_id, 0), COALESCE(setting_id, 0), json_extract(snapshot, '$.requestKey'));
    CREATE INDEX IF NOT EXISTS idx_chat_asset_batches_setting ON chat_asset_batches(setting_id);
    CREATE TABLE IF NOT EXISTS chat_asset_slots (
      batch_id INTEGER NOT NULL REFERENCES chat_asset_batches(id) ON DELETE CASCADE,
      slot_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('expression', 'background', 'full', 'avatar', 'reference')),
      prompt TEXT NOT NULL,
      attempts TEXT NOT NULL DEFAULT '[]',
      chosen_hash TEXT,
      PRIMARY KEY(batch_id, slot_key)
    );
  `)
  // A durable seed marker respects later edits, renames and deletion of the starter preset.
  if (!db.prepare("SELECT 1 FROM user_preferences WHERE key = 'chat_expression_preset_seeded'").get()) {
    db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM prompt_presets WHERE name = ?').get(DEFAULT_EXPRESSION_PRESET_NAME)) {
        const id = db.prepare('INSERT INTO prompt_presets(name) VALUES (?)').run(DEFAULT_EXPRESSION_PRESET_NAME).lastInsertRowid
        const insert = db.prepare('INSERT INTO prompt_preset_items(preset_id, description, value, order_index) VALUES (?, ?, ?, ?)')
        DEFAULT_EXPRESSION_ITEMS.forEach((item, index) => insert.run(id, item.description, item.value, index))
      }
      db.prepare("INSERT OR IGNORE INTO user_preferences(key, value) VALUES ('chat_expression_preset_seeded', '1')").run()
    })()
  }
}

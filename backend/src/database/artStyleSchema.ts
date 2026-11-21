import type Database from 'better-sqlite3'

/** Replace a style's badge and keyword index (badge counts and search). Terms keep their case; matching ignores it. */
export function indexArtStyleTerms(db: Database.Database, styleId: number, badges: readonly string[], keywords: readonly string[]) {
  db.prepare('DELETE FROM art_style_terms WHERE style_id = ?').run(styleId)
  const insert = db.prepare('INSERT OR IGNORE INTO art_style_terms(style_id, kind, term) VALUES (?, ?, ?)')
  for (const badge of badges) insert.run(styleId, 'badge', badge)
  for (const keyword of keywords) insert.run(styleId, 'keyword', keyword)
}

/**
 * Art styles (그림 스타일) in user.db; additive and idempotent. A style owns copies of its reference images in the shared
 * file store (`art_style_files`, ordered by `position`, under its folder `folder_id`). The old `images` (library hashes)
 * and `asset_group_id` columns stay for databases made before; the startup conversion empties `images`.
 */
export function ensureArtStyleSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS art_styles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      badges TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      positive TEXT NOT NULL DEFAULT '',
      negative TEXT NOT NULL DEFAULT '',
      images TEXT NOT NULL DEFAULT '[]',
      asset_group_id INTEGER,
      favorite INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_art_styles_title ON art_styles(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_art_styles_favorite ON art_styles(favorite) WHERE favorite = 1;
    CREATE TABLE IF NOT EXISTS art_style_terms (
      style_id INTEGER NOT NULL REFERENCES art_styles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('badge', 'keyword')),
      term TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (style_id, kind, term)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_art_style_terms_kind_term ON art_style_terms(kind, term, style_id);
    -- Every file-store copy a style holds, in its order (the first is the cover); name is the source's file name.
    CREATE TABLE IF NOT EXISTS art_style_files (
      style_id INTEGER NOT NULL REFERENCES art_styles(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      width INTEGER,
      height INTEGER,
      PRIMARY KEY (style_id, file_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_art_style_files_file ON art_style_files(file_id);
  `)
  if (!db.prepare("SELECT 1 FROM pragma_table_info('art_styles') WHERE name = 'folder_id'").get()) db.exec('ALTER TABLE art_styles ADD COLUMN folder_id TEXT')
}

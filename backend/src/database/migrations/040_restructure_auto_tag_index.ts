import type { Database } from 'better-sqlite3';

/**
 * Replace `media_auto_tag_index` (one row per media x tag x search-key variant, each repeating the 48-char hash and
 * three copies of the tag text) with:
 *
 * - `auto_tag_terms`: one row per distinct (tag_type, source_path, tag_key) plus its single canonical search key;
 * - `media_auto_tags`: (term_id, media_id, score) integer rows, WITHOUT ROWID, PK serving "term -> media" lookups
 *   and a media_id index for per-media resync / deletes.
 *
 * One search key per tag is enough. The old index stored `normalized` and `compact` (separators removed) keys and
 * queries matched either against either; two strings match that way exactly when their canonical keys
 * (`compact || normalized`) are equal, so lookups keep the same results with half the rows.
 *
 * `media_id` is media_metadata's rowid here; migration 041 makes it an explicit INTEGER PRIMARY KEY with the same
 * values. There is no FK to media_metadata on purpose: 041 rebuilds that table, and an FK child would have to be
 * copied out and back. A delete trigger removes a media row's tags instead.
 *
 * Migration files cannot import project modules, so the canonical-key rule is copied from autoTagSearchTerms.ts.
 */

const BATCH_SIZE = 5000;

function canonicalSearchKey(tagKey: string): string {
  const normalized = tagKey.trim().toLowerCase();
  return normalized.replace(/[_\s-]+/g, '') || normalized;
}

function hasTable(db: Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export const up = async (db: Database): Promise<void> => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_tag_terms (
      term_id INTEGER PRIMARY KEY,
      tag_type TEXT NOT NULL CHECK (tag_type IN ('general', 'character', 'model')),
      source_path TEXT NOT NULL,
      tag_key TEXT NOT NULL,
      search_key TEXT NOT NULL,
      UNIQUE (tag_type, source_path, tag_key)
    );
    CREATE INDEX IF NOT EXISTS idx_auto_tag_terms_search ON auto_tag_terms(tag_type, search_key);

    CREATE TABLE IF NOT EXISTS media_auto_tags (
      term_id INTEGER NOT NULL REFERENCES auto_tag_terms(term_id),
      media_id INTEGER NOT NULL,
      score REAL,
      PRIMARY KEY (term_id, media_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_media_auto_tags_media ON media_auto_tags(media_id);

    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tags_delete;
    CREATE TRIGGER trg_media_metadata_auto_tags_delete
    AFTER DELETE ON media_metadata
    BEGIN
      DELETE FROM media_auto_tags WHERE media_id = OLD.rowid;
    END;
  `);

  if (!hasTable(db, 'media_auto_tag_index')) {
    return;
  }

  const selectBatch = db.prepare(`
    SELECT ati.rowid AS rid, m.rowid AS media_id, ati.tag_type, ati.source_path, ati.tag_key, ati.score
    FROM media_auto_tag_index ati
    JOIN media_metadata m ON m.composite_hash = ati.composite_hash
    WHERE ati.rowid > ?
    ORDER BY ati.rowid
    LIMIT ${BATCH_SIZE}
  `);
  const insertTerm = db.prepare(`
    INSERT OR IGNORE INTO auto_tag_terms (tag_type, source_path, tag_key, search_key) VALUES (?, ?, ?, ?)
  `);
  const findTerm = db.prepare('SELECT term_id FROM auto_tag_terms WHERE tag_type = ? AND source_path = ? AND tag_key = ?');
  const insertTag = db.prepare('INSERT OR IGNORE INTO media_auto_tags (term_id, media_id, score) VALUES (?, ?, ?)');
  const termIds = new Map<string, number>();

  let cursor = 0;
  let copied = 0;
  for (;;) {
    const rows = selectBatch.all(cursor) as Array<{
      rid: number;
      media_id: number;
      tag_type: string;
      source_path: string;
      tag_key: string;
      score: number | null;
    }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      const searchKey = canonicalSearchKey(row.tag_key);
      if (!searchKey) continue;
      const termKey = `${row.tag_type}\u0000${row.source_path}\u0000${row.tag_key}`;
      let termId = termIds.get(termKey);
      if (termId === undefined) {
        insertTerm.run(row.tag_type, row.source_path, row.tag_key, searchKey);
        termId = (findTerm.get(row.tag_type, row.source_path, row.tag_key) as { term_id: number }).term_id;
        termIds.set(termKey, termId);
      }
      copied += insertTag.run(termId, row.media_id, row.score).changes;
    }
    cursor = rows[rows.length - 1].rid;
  }

  db.exec('DROP TABLE media_auto_tag_index');
  console.log(`  ✅ auto-tag index: ${termIds.size} terms, ${copied} media tag rows`);
};

export const down = async (db: Database): Promise<void> => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_auto_tag_index (
      composite_hash TEXT NOT NULL,
      tag_type TEXT NOT NULL CHECK (tag_type IN ('general', 'character', 'model')),
      source_path TEXT NOT NULL,
      tag_key TEXT NOT NULL,
      normalized_tag_key TEXT NOT NULL,
      search_key TEXT NOT NULL,
      score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (composite_hash, tag_type, source_path, search_key),
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_media_auto_tag_lookup
      ON media_auto_tag_index(tag_type, search_key, score, composite_hash);
    INSERT OR IGNORE INTO media_auto_tag_index
      (composite_hash, tag_type, source_path, tag_key, normalized_tag_key, search_key, score)
    SELECT m.composite_hash, t.tag_type, t.source_path, t.tag_key, lower(trim(t.tag_key)), t.search_key, mat.score
    FROM media_auto_tags mat
    JOIN auto_tag_terms t ON t.term_id = mat.term_id
    JOIN media_metadata m ON m.rowid = mat.media_id;
    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tags_delete;
    DROP TABLE IF EXISTS media_auto_tags;
    DROP TABLE IF EXISTS auto_tag_terms;
  `);
};

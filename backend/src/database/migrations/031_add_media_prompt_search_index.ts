import { Database } from 'better-sqlite3';

/**
 * 031: FTS5 prompt search index for media_metadata (HEAVY-1)
 *
 * Prompt search used to be a pair of `LIKE '%…%'` full scans (one for the count,
 * one for the page) with a `json_each` sub-scan per row for NAI character
 * captions. On a 200k-row/2.1GB database each of those took ~1.5s, so a single
 * search froze the whole single-threaded server for ~3s.
 *
 * This migration adds a **trigram** FTS5 index over the searchable prompt text.
 * The trigram tokenizer is what makes the switch safe: a quoted phrase match is
 * exactly a case-folded substring match, so `%` / `_` stay literal and the index
 * result set is a superset of the existing LIKE result set. The runtime keeps the
 * original LIKE predicate on top of the index hit (see `ImageSearchHelpers`), so
 * results are identical by construction — the index only narrows candidates.
 *
 * Deliberately **no content is indexed here**. Indexing 200k rows takes seconds to
 * minutes and must never block the first boot, so this migration only creates the
 * empty index, the state row and the sync triggers. `media-prompt-index` (runtime
 * job) fills it in the background and flips the state to 'ready'; until then every
 * search stays on the original LIKE path.
 *
 * State machine (`media_prompt_fts_state`):
 *   'pending'  - index incomplete; rows with rowid <= last_rowid are in sync,
 *                everything above is not. Search must use LIKE only.
 *   'ready'    - every row is in sync; search may use the index as a prefilter.
 *   'disabled' - FTS5/trigram unavailable or an operator turned it off. Triggers
 *                become no-ops and search stays on LIKE forever.
 *
 * The watermark in the trigger guard is what makes a concurrent backfill safe:
 * FTS5 external-content indexes corrupt if a 'delete' command names a row that
 * was never inserted, so triggers must ignore rows the backfill has not reached.
 *
 * This file stays dependency-free on purpose: portable/SEA builds copy the
 * compiled migrations directory on its own, so it cannot import project modules.
 * `backend/src/services/promptSearchIndexService.ts` keeps the runtime copy of
 * these expressions in sync.
 */

/** Searchable positive text: prompt + NAI character prompt + v4 char captions. */
function positiveTextSql(prefix: string): string {
  return `(
    COALESCE(${prefix}.prompt, '') || char(10) ||
    COALESCE(${prefix}.character_prompt_text, '') || char(10) ||
    CASE WHEN json_valid(${prefix}.raw_nai_parameters) = 1 THEN COALESCE((
      SELECT group_concat(COALESCE(json_extract(char_item.value, '$.char_caption'), ''), char(10))
      FROM json_each(${prefix}.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
    ), '') ELSE '' END
  )`;
}

function negativeTextSql(prefix: string): string {
  return `COALESCE(${prefix}.negative_prompt, '')`;
}

/**
 * Only touch the index for rows the backfill already owns.
 * 'ready' means the whole table is owned.
 */
function syncGateSql(rowidExpression: string): string {
  return `EXISTS (
    SELECT 1 FROM media_prompt_fts_state s
    WHERE s.id = 1
      AND s.status IN ('pending', 'ready')
      AND (s.status = 'ready' OR ${rowidExpression} <= s.last_rowid)
  )`;
}

function dropTriggers(db: Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_insert;
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_delete;
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_update;
  `);
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 031_add_media_prompt_search_index.ts');

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_prompt_fts_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'pending',
      last_rowid INTEGER NOT NULL DEFAULT 0,
      indexed_rows INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`
    INSERT OR IGNORE INTO media_prompt_fts_state (id, status, last_rowid, indexed_rows)
    VALUES (1, 'pending', 0, 0)
  `).run();

  // FTS5 with the trigram tokenizer is required for LIKE-equivalent substring
  // matching. Old SQLite builds (and builds without FTS5) must keep working on
  // the LIKE path instead of failing the whole startup migration.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS media_prompt_fts USING fts5(
        positive_text,
        negative_text,
        content='media_metadata',
        content_rowid='rowid',
        tokenize='trigram'
      );
    `);
  } catch (error) {
    dropTriggers(db);
    db.prepare(`
      UPDATE media_prompt_fts_state
      SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();
    console.warn(
      '⚠️  FTS5 trigram index unavailable; prompt search keeps using the LIKE path:',
      error instanceof Error ? error.message : error
    );
    return;
  }

  dropTriggers(db);
  db.exec(`
    CREATE TRIGGER trg_media_prompt_fts_insert
    AFTER INSERT ON media_metadata
    BEGIN
      INSERT INTO media_prompt_fts(rowid, positive_text, negative_text)
      SELECT NEW.rowid, ${positiveTextSql('NEW')}, ${negativeTextSql('NEW')}
      WHERE ${syncGateSql('NEW.rowid')};
    END;

    CREATE TRIGGER trg_media_prompt_fts_delete
    AFTER DELETE ON media_metadata
    BEGIN
      INSERT INTO media_prompt_fts(media_prompt_fts, rowid, positive_text, negative_text)
      SELECT 'delete', OLD.rowid, ${positiveTextSql('OLD')}, ${negativeTextSql('OLD')}
      WHERE ${syncGateSql('OLD.rowid')};
    END;

    CREATE TRIGGER trg_media_prompt_fts_update
    AFTER UPDATE OF prompt, negative_prompt, character_prompt_text, raw_nai_parameters ON media_metadata
    BEGIN
      INSERT INTO media_prompt_fts(media_prompt_fts, rowid, positive_text, negative_text)
      SELECT 'delete', OLD.rowid, ${positiveTextSql('OLD')}, ${negativeTextSql('OLD')}
      WHERE ${syncGateSql('OLD.rowid')};

      INSERT INTO media_prompt_fts(rowid, positive_text, negative_text)
      SELECT NEW.rowid, ${positiveTextSql('NEW')}, ${negativeTextSql('NEW')}
      WHERE ${syncGateSql('NEW.rowid')};
    END;
  `);

  console.log('✅ Prompt search FTS5 index, state row and sync triggers ready (backfill runs in the background)');
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 031_add_media_prompt_search_index.ts');
  dropTriggers(db);
  db.exec(`
    DROP TABLE IF EXISTS media_prompt_fts;
    DROP TABLE IF EXISTS media_prompt_fts_state;
  `);
  console.log('✅ Prompt search FTS5 index removed (search falls back to the LIKE path)');
};

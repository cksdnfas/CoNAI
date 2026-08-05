import { Database } from 'better-sqlite3';

/**
 * 028: media_metadata.auto_tag_state + partial pending index (ATAG-1)
 *
 * The auto-tag scheduler used to look for work with a `json_extract` OR chain,
 * which SQLite cannot index: every 30s poll (and every generation completion)
 * walked all media_metadata rows and their overflow pages. This migration adds a
 * cheap state column plus a partial index so an idle poll becomes an index
 * SEARCH over an (almost always empty) pending set.
 *
 * State values:
 *   'pending' - auto-tag work is still required under the recorded capabilities
 *   'done'    - every enabled tagger already produced output for the row
 *   'skip'    - the row has no active media file, so it can never be tagged
 *   NULL      - never evaluated; treated exactly like 'done' (not pending)
 *
 * Only 'pending' rows are written by the backfill, so upgrading a multi-GB
 * database does not rewrite every wide row.
 *
 * `auto_tag_state_meta` records which taggers the state was computed for. It is
 * seeded with NULL capabilities on purpose: `AutoTagStateService.syncCapabilityState()`
 * sees the unsynced marker on the first scheduler use and completes the
 * capability-aware pass (the `$.tagger` / `$.kaloscope` terms of the original
 * condition) in a single UPDATE, writing only rows whose state actually changes.
 *
 * This file stays dependency-free on purpose: portable/SEA builds copy the
 * compiled migrations directory on its own, so it cannot import project modules.
 * `backend/src/services/autoTagStateService.ts` keeps the runtime copy of these
 * expressions in sync (guarded by verify:auto-tag-index-contracts).
 */

const CAPABILITY_TAGGER_SQL = `COALESCE((SELECT tagger_enabled FROM auto_tag_state_meta WHERE id = 1), 1) = 1`;
const CAPABILITY_KALOSCOPE_SQL = `COALESCE((SELECT kaloscope_enabled FROM auto_tag_state_meta WHERE id = 1), 1) = 1`;

/** Same meaning as the scheduler's json_extract OR chain, guarded against malformed JSON. */
function needsAutoTagWorkSql(autoTagsExpr: string): string {
  return `(
    ${autoTagsExpr} IS NULL
    OR json_valid(${autoTagsExpr}) = 0
    OR (${CAPABILITY_TAGGER_SQL} AND json_extract(${autoTagsExpr}, '$.tagger') IS NULL)
    OR (${CAPABILITY_KALOSCOPE_SQL} AND json_extract(${autoTagsExpr}, '$.kaloscope') IS NULL)
  )`;
}

/** Same meaning as the scheduler's `image_files` join filter. */
function hasTaggableFileSql(hashExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM image_files f
    WHERE f.composite_hash = ${hashExpr}
      AND f.original_file_path IS NOT NULL
      AND f.file_status = 'active'
  )`;
}

function hasMediaMetadataColumn(db: Database, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(media_metadata)`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 028_add_media_auto_tag_state.ts');

  if (!hasMediaMetadataColumn(db, 'auto_tag_state')) {
    db.prepare(`
      ALTER TABLE media_metadata
      ADD COLUMN auto_tag_state TEXT DEFAULT NULL
    `).run();
    console.log('✅ Added column: media_metadata.auto_tag_state');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_tag_state_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tagger_enabled INTEGER DEFAULT NULL,
      kaloscope_enabled INTEGER DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`
    INSERT OR IGNORE INTO auto_tag_state_meta (id, tagger_enabled, kaloscope_enabled)
    VALUES (1, NULL, NULL)
  `).run();

  // Backfill in one statement (no per-row loop): rows that need auto-tagging under
  // every capability combination the scheduler can run with. Rows that only miss a
  // single tagger's output are marked by the capability sync at first scheduler use.
  const backfilled = db.prepare(`
    UPDATE media_metadata
    SET auto_tag_state = 'pending'
    WHERE auto_tag_state IS NOT 'pending'
      AND auto_tags IS NULL
      AND ${hasTaggableFileSql('media_metadata.composite_hash')}
  `).run();
  console.log(`✅ Backfilled auto_tag_state='pending' rows: ${backfilled.changes}`);

  // Partial index: only pending rows are stored, and leading with auto_tag_state
  // lets the planner resolve `auto_tag_state = 'pending'` as an index SEARCH key
  // instead of walking the index.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_metadata_auto_tag_pending
      ON media_metadata(auto_tag_state, composite_hash)
      WHERE auto_tag_state = 'pending';
  `);

  // Triggers keep the state exact for every writer (scheduler, metadata model,
  // reset-auto-tags route, rematch, ad-hoc SQL) without a full-table rescan.
  db.exec(`
    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_insert;
    CREATE TRIGGER trg_media_metadata_auto_tag_state_insert
    AFTER INSERT ON media_metadata
    WHEN NEW.auto_tag_state IS NOT 'pending' AND ${needsAutoTagWorkSql('NEW.auto_tags')}
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash;
    END;

    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_promote;
    CREATE TRIGGER trg_media_metadata_auto_tag_state_promote
    AFTER UPDATE OF auto_tags ON media_metadata
    WHEN NEW.auto_tag_state IS NOT 'pending' AND ${needsAutoTagWorkSql('NEW.auto_tags')}
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash;
    END;

    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_settle;
    CREATE TRIGGER trg_media_metadata_auto_tag_state_settle
    AFTER UPDATE OF auto_tags ON media_metadata
    WHEN NEW.auto_tag_state = 'pending' AND NOT ${needsAutoTagWorkSql('NEW.auto_tags')}
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'done'
      WHERE composite_hash = NEW.composite_hash;
    END;

    DROP TRIGGER IF EXISTS trg_image_files_auto_tag_state_insert;
    CREATE TRIGGER trg_image_files_auto_tag_state_insert
    AFTER INSERT ON image_files
    WHEN NEW.composite_hash IS NOT NULL
      AND NEW.file_status = 'active'
      AND NEW.original_file_path IS NOT NULL
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash
        AND auto_tag_state IS NOT 'pending'
        AND ${needsAutoTagWorkSql('auto_tags')};
    END;

    DROP TRIGGER IF EXISTS trg_image_files_auto_tag_state_link;
    CREATE TRIGGER trg_image_files_auto_tag_state_link
    AFTER UPDATE OF composite_hash, file_status, original_file_path ON image_files
    WHEN NEW.composite_hash IS NOT NULL
      AND NEW.file_status = 'active'
      AND NEW.original_file_path IS NOT NULL
      AND (
        OLD.composite_hash IS NOT NEW.composite_hash
        OR OLD.file_status IS NOT NEW.file_status
        OR OLD.original_file_path IS NOT NEW.original_file_path
      )
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash
        AND auto_tag_state IS NOT 'pending'
        AND ${needsAutoTagWorkSql('auto_tags')};
    END;
  `);

  console.log('✅ Auto-tag pending state column, partial index and sync triggers ready');
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 028_add_media_auto_tag_state.ts');
  db.exec(`
    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_insert;
    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_promote;
    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_settle;
    DROP TRIGGER IF EXISTS trg_image_files_auto_tag_state_insert;
    DROP TRIGGER IF EXISTS trg_image_files_auto_tag_state_link;
    DROP INDEX IF EXISTS idx_media_metadata_auto_tag_pending;
    DROP TABLE IF EXISTS auto_tag_state_meta;
  `);
  console.log('⚠️  media_metadata.auto_tag_state column is kept (harmless without the index/triggers).');
};

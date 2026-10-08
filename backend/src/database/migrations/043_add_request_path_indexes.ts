import type { Database } from 'better-sqlite3';

/**
 * Indexes (and one data guarantee) for request-path queries that otherwise grow with the library.
 *
 * - `idx_media_metadata_hash_visibility`: group/folder membership joins look media up by composite_hash only to
 *   read the visibility columns (and, for folder pages, the sort date). Covering them turns every lookup from a
 *   wide-row fetch into an index probe (a 60k-member group count: ~430ms -> ~50ms; the group tree counts:
 *   ~800ms -> ~150ms at 300k media).
 * - `idx_image_groups_group_order`: a group page orders by (order_index, added_date DESC, composite_hash) inside one
 *   group; with this index the page is an index walk that stops at LIMIT instead of a sort of every member.
 * - `idx_files_background_queue`: the background hashing batch is `WHERE composite_hash IS NULL AND
 *   file_status = 'active' ... ORDER BY scan_date LIMIT 50`; idx_files_background_retry leads with the retry time,
 *   so every batch sorted the whole backlog.
 * - `idx_metadata_without_thumbnail`: thumbnail statistics count rows without a thumbnail from a small partial index
 *   instead of scanning media_metadata.
 * - `idx_files_missing`: `file_status = 'missing'` counts (verification stats) read a partial index instead of
 *   scanning a file index (only a skip-scan with full statistics avoided that before).
 * - Rating expression indexes: auto-tag rating filters read
 *   `COALESCE(json_extract(auto_tags, '$.rating.x'), json_extract(auto_tags, '$.tagger.rating.x'))` (see
 *   services/autoTagSqlShared.ts buildAutoTagRatingExpr). Tagger output nests the rating under `$.tagger`, so the
 *   older root-path indexes never matched real rows. The text must stay identical to buildAutoTagRatingExpr for
 *   SQLite to use them.
 * - first_seen_date is never NULL: complex search orders and pages by the bare column (an index can serve it) where it
 *   used COALESCE(first_seen_date, ''). Every insert path already fills it; existing NULLs (none expected) are
 *   backfilled and a trigger keeps any future NULL insert or update filled, so the two orders are the same.
 * - `aggregate_versions`: a one-row-per-scope counter bumped by triggers whenever group membership or a group row
 *   changes. Cached group aggregates (services/aggregateCache.ts) compare against it, so every writer — including
 *   ones in chat and emoticon services — invalidates them without calling anything.
 */

const RATING_TYPES = ['general', 'sensitive', 'questionable', 'explicit'] as const;

const GROUP_VERSION_TRIGGERS: ReadonlyArray<[name: string, event: string]> = [
  ['trg_image_groups_aggregate_version_insert', 'INSERT ON image_groups'],
  ['trg_image_groups_aggregate_version_delete', 'DELETE ON image_groups'],
  ['trg_image_groups_aggregate_version_update', 'UPDATE OF group_id, composite_hash ON image_groups'],
  ['trg_groups_aggregate_version_insert', 'INSERT ON groups'],
  ['trg_groups_aggregate_version_delete', 'DELETE ON groups'],
  // Any column: cached group lists carry the group rows themselves (names, colours, flags).
  ['trg_groups_aggregate_version_update', 'UPDATE ON groups'],
];

function ratingExpr(ratingType: string): string {
  return `COALESCE(json_extract(auto_tags, '$.rating.${ratingType}'), json_extract(auto_tags, '$.tagger.rating.${ratingType}'))`;
}

export const up = async (db: Database): Promise<void> => {
  db.exec(`
    UPDATE media_metadata
    SET first_seen_date = COALESCE(metadata_updated_date, CURRENT_TIMESTAMP)
    WHERE first_seen_date IS NULL;

    DROP TRIGGER IF EXISTS trg_media_metadata_first_seen_fill_insert;
    CREATE TRIGGER trg_media_metadata_first_seen_fill_insert
    AFTER INSERT ON media_metadata
    WHEN NEW.first_seen_date IS NULL
    BEGIN
      UPDATE media_metadata
      SET first_seen_date = COALESCE(NEW.metadata_updated_date, CURRENT_TIMESTAMP)
      WHERE rowid = NEW.rowid;
    END;

    DROP TRIGGER IF EXISTS trg_media_metadata_first_seen_fill_update;
    CREATE TRIGGER trg_media_metadata_first_seen_fill_update
    AFTER UPDATE OF first_seen_date ON media_metadata
    WHEN NEW.first_seen_date IS NULL
    BEGIN
      UPDATE media_metadata
      SET first_seen_date = COALESCE(OLD.first_seen_date, NEW.metadata_updated_date, CURRENT_TIMESTAMP)
      WHERE rowid = NEW.rowid;
    END;

    CREATE INDEX IF NOT EXISTS idx_media_metadata_hash_visibility
      ON media_metadata(composite_hash, rating_score, postprocess_status, first_seen_date);
    CREATE INDEX IF NOT EXISTS idx_image_groups_group_order
      ON image_groups(group_id, order_index, added_date DESC, composite_hash);
    CREATE INDEX IF NOT EXISTS idx_files_background_queue
      ON image_files(scan_date)
      WHERE composite_hash IS NULL AND file_status = 'active';
    CREATE INDEX IF NOT EXISTS idx_metadata_without_thumbnail
      ON media_metadata(media_id)
      WHERE thumbnail_path IS NULL;
    CREATE INDEX IF NOT EXISTS idx_files_missing
      ON image_files(id)
      WHERE file_status = 'missing';
  `);

  for (const ratingType of RATING_TYPES) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_metadata_auto_tag_rating_${ratingType} ON media_metadata(${ratingExpr(ratingType)})`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS aggregate_versions (
      scope TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    INSERT OR IGNORE INTO aggregate_versions (scope, version) VALUES ('groups', 0);
  `);
  for (const [name, event] of GROUP_VERSION_TRIGGERS) {
    db.exec(`
      DROP TRIGGER IF EXISTS ${name};
      CREATE TRIGGER ${name}
      AFTER ${event}
      BEGIN
        UPDATE aggregate_versions SET version = version + 1 WHERE scope = 'groups';
      END;
    `);
  }

  // Bounded statistics for the new indexes so the planner picks them before the first scheduled PRAGMA optimize.
  db.pragma('analysis_limit = 1000');
  db.exec('ANALYZE media_metadata; ANALYZE image_groups; ANALYZE image_files;');
};

export const down = async (db: Database): Promise<void> => {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_media_metadata_first_seen_fill_insert;
    DROP TRIGGER IF EXISTS trg_media_metadata_first_seen_fill_update;
    DROP INDEX IF EXISTS idx_media_metadata_hash_visibility;
    DROP INDEX IF EXISTS idx_image_groups_group_order;
    DROP INDEX IF EXISTS idx_files_background_queue;
    DROP INDEX IF EXISTS idx_metadata_without_thumbnail;
    DROP INDEX IF EXISTS idx_files_missing;
  `);
  for (const ratingType of RATING_TYPES) {
    db.exec(`DROP INDEX IF EXISTS idx_metadata_auto_tag_rating_${ratingType}`);
  }
  for (const [name] of GROUP_VERSION_TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
  db.exec('DROP TABLE IF EXISTS aggregate_versions');
};

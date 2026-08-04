import type { Database } from 'better-sqlite3';

/**
 * Home feed visibility index.
 *
 * The home first page total used to be counted from `image_files` with a
 * LEFT JOIN into `media_metadata`, which forced SQLite to walk the overflow
 * chain of every ~11KB `media_metadata` row just to read `rating_score` and
 * `postprocess_status` (~2s at 200k rows).
 *
 * The count is now driven from `media_metadata` with an `EXISTS(image_files)`
 * guard, so a narrow index over exactly the columns that query touches
 * (`rating_score`, `postprocess_status`, `composite_hash`) lets SQLite answer
 * it from a covering index scan instead of the wide table.
 *
 * `composite_hash` is part of the index on purpose: `media_metadata` is a
 * rowid table whose PRIMARY KEY lives in a separate unique index, so without
 * it the EXISTS correlation would drop back to the wide table and the plan
 * would stop being covering.
 */
const VISIBILITY_INDEX_NAME = 'idx_media_metadata_visibility';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 027_add_media_visibility_index.ts');

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS ${VISIBILITY_INDEX_NAME}
      ON media_metadata(rating_score, postprocess_status, composite_hash)
    `);
    console.log(`✅ Created index: ${VISIBILITY_INDEX_NAME}`);
  } catch (error: any) {
    console.error(`❌ Failed to create ${VISIBILITY_INDEX_NAME}:`, error.message);
    throw error;
  }
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 027_add_media_visibility_index.ts');

  try {
    db.exec(`DROP INDEX IF EXISTS ${VISIBILITY_INDEX_NAME}`);
    console.log(`✅ Dropped index: ${VISIBILITY_INDEX_NAME}`);
  } catch (error: any) {
    console.warn(`⚠️  Failed to drop index ${VISIBILITY_INDEX_NAME}:`, error.message);
  }
};

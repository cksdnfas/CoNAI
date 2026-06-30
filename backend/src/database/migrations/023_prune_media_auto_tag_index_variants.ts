import { Database } from 'better-sqlite3';

const TABLE_NAME = 'media_auto_tag_index';
const COMPACT_SEARCH_KEY_SQL = "replace(replace(replace(normalized_tag_key, '_', ''), ' ', ''), '-', '')";

function hasAutoTagIndexTable(db: Database): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(TABLE_NAME);

  return Boolean(row);
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 023_prune_media_auto_tag_index_variants.ts');

  if (!hasAutoTagIndexTable(db)) {
    console.log('  ✓ media_auto_tag_index table missing; skipping');
    return;
  }

  const result = db.prepare(`
    DELETE FROM media_auto_tag_index
    WHERE search_key != normalized_tag_key
      AND search_key != ${COMPACT_SEARCH_KEY_SQL}
  `).run();

  console.log(`✅ Pruned media_auto_tag_index variant rows: ${result.changes}`);
};

export const down = async (_db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 023_prune_media_auto_tag_index_variants.ts');
  console.log('  ✓ No-op: pruned auto-tag variants are rebuilt from media_metadata if needed');
};

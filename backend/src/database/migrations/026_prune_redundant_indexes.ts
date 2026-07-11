import type { Database } from 'better-sqlite3';

const REDUNDANT_INDEXES = [
  'idx_media_auto_tag_hash_type',
  'idx_files_path',
  'idx_image_files_original_file_path',
] as const;

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 026_prune_redundant_indexes.ts');

  for (const indexName of REDUNDANT_INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${indexName}`);
  }

  console.log('✅ Removed indexes already covered by table UNIQUE/PRIMARY KEY constraints');
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 026_prune_redundant_indexes.ts');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_auto_tag_hash_type
    ON media_auto_tag_index(composite_hash, tag_type);

    CREATE INDEX IF NOT EXISTS idx_files_path
    ON image_files(original_file_path);

    CREATE INDEX IF NOT EXISTS idx_image_files_original_file_path
    ON image_files(original_file_path);
  `);

  console.log('✅ Restored redundant compatibility indexes');
};

import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 017_add_image_detail_lookup_index.ts');

  try {
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_image_files_hash_status_verified
      ON image_files(composite_hash, file_status, last_verified_date DESC, id DESC)
    `).run();
    console.log('✅ Created index: idx_image_files_hash_status_verified');
  } catch (error: any) {
    console.warn('⚠️  Index creation warning:', error.message);
  }
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 017_add_image_detail_lookup_index.ts');

  try {
    db.prepare('DROP INDEX IF EXISTS idx_image_files_hash_status_verified').run();
    console.log('✅ Dropped index: idx_image_files_hash_status_verified');
  } catch (error: any) {
    console.warn('⚠️  Failed to drop index idx_image_files_hash_status_verified:', error.message);
  }
};

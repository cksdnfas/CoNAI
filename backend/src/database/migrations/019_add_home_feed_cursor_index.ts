import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 019_add_home_feed_cursor_index.ts');

  try {
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_metadata_first_seen_hash_desc
      ON media_metadata(first_seen_date DESC, composite_hash DESC)
    `).run();
    console.log('✅ Created index: idx_metadata_first_seen_hash_desc');
  } catch (error: any) {
    console.warn('⚠️  Index creation warning:', error.message);
  }
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 019_add_home_feed_cursor_index.ts');

  try {
    db.prepare('DROP INDEX IF EXISTS idx_metadata_first_seen_hash_desc').run();
    console.log('✅ Dropped index: idx_metadata_first_seen_hash_desc');
  } catch (error: any) {
    console.warn('⚠️  Failed to drop index idx_metadata_first_seen_hash_desc:', error.message);
  }
};

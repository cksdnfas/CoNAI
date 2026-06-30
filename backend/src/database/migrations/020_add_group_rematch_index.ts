import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 020_add_group_rematch_index.ts');

  try {
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_image_groups_group_collection_hash
      ON image_groups(group_id, collection_type, composite_hash)
    `).run();
    console.log('✅ Created index: idx_image_groups_group_collection_hash');
  } catch (error: any) {
    console.error('❌ Failed to create idx_image_groups_group_collection_hash:', error.message);
    throw error;
  }
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 020_add_group_rematch_index.ts');

  try {
    db.prepare('DROP INDEX IF EXISTS idx_image_groups_group_collection_hash').run();
    console.log('✅ Dropped index: idx_image_groups_group_collection_hash');
  } catch (error: any) {
    console.warn('⚠️  Failed to drop index idx_image_groups_group_collection_hash:', error.message);
  }
};

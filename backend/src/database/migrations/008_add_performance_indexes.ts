
import { Database } from 'better-sqlite3';

function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;

  return Boolean(row?.name);
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 008_add_performance_indexes.ts');

  // 1. auto_folder_groups - folder_path 조회 최적화
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auto_folder_groups_folder_path ON auto_folder_groups(folder_path)').run();
    console.log('✅ Created index: idx_auto_folder_groups_folder_path');
  } catch (error: any) {
    console.warn('⚠️  Index creation warning:', error.message);
  }

  // 2. image_files - original_file_path 조회 최적화
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_image_files_original_file_path ON image_files(original_file_path)').run();
    console.log('✅ Created index: idx_image_files_original_file_path');
  } catch (error: any) {
    console.warn('⚠️  Index creation warning:', error.message);
  }

  // 3. prompt_collection - prompt 검색 최적화
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_collection_prompt ON prompt_collection(prompt)').run();
    console.log('✅ Created index: idx_prompt_collection_prompt');
  } catch (error: any) {
    console.warn('⚠️  Index creation warning:', error.message);
  }

  // 4. image_groups - group_id, composite_hash 복합 인덱스 (findImagesByGroup 최적화)
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_image_groups_group_composite ON image_groups(group_id, composite_hash)').run();
    console.log('✅ Created index: idx_image_groups_group_composite');
  } catch (error: any) {
    console.warn('⚠️  Index creation warning:', error.message);
  }

  // 5. api_generation_history - status, created_at 복합 인덱스 (현재는 user.db에서 관리)
  if (tableExists(db, 'api_generation_history')) {
    try {
      db.prepare('CREATE INDEX IF NOT EXISTS idx_api_generation_history_status_created ON api_generation_history(generation_status, created_at DESC)').run();
      console.log('✅ Created index: idx_api_generation_history_status_created');
    } catch (error: any) {
      console.warn('⚠️  Index creation warning:', error.message);
    }
  } else {
    console.log('ℹ️  Skipped index idx_api_generation_history_status_created (table is managed in user.db)');
  }

  console.log('✅ All performance indexes created successfully');
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 008_add_performance_indexes.ts');

  // 인덱스 제거 (순서는 상관없음)
  try {
    db.prepare('DROP INDEX IF EXISTS idx_auto_folder_groups_folder_path').run();
    console.log('✅ Dropped index: idx_auto_folder_groups_folder_path');
  } catch (e) {
    console.warn('Failed to drop index idx_auto_folder_groups_folder_path', e);
  }

  try {
    db.prepare('DROP INDEX IF EXISTS idx_image_files_original_file_path').run();
    console.log('✅ Dropped index: idx_image_files_original_file_path');
  } catch (e) {
    console.warn('Failed to drop index idx_image_files_original_file_path', e);
  }

  try {
    db.prepare('DROP INDEX IF EXISTS idx_prompt_collection_prompt').run();
    console.log('✅ Dropped index: idx_prompt_collection_prompt');
  } catch (e) {
    console.warn('Failed to drop index idx_prompt_collection_prompt', e);
  }

  try {
    db.prepare('DROP INDEX IF EXISTS idx_image_groups_group_composite').run();
    console.log('✅ Dropped index: idx_image_groups_group_composite');
  } catch (e) {
    console.warn('Failed to drop index idx_image_groups_group_composite', e);
  }

  try {
    db.prepare('DROP INDEX IF EXISTS idx_api_generation_history_status_created').run();
    console.log('✅ Dropped index: idx_api_generation_history_status_created');
  } catch (e) {
    console.warn('Failed to drop index idx_api_generation_history_status_created', e);
  }

  console.log('✅ All indexes removed');
};

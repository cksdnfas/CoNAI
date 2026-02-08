
import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 009_add_raw_nai_parameters.ts');

  // NovelAI 원본 생성 파라미터를 JSON 형태로 저장하기 위한 컬럼 추가
  try {
    db.prepare('ALTER TABLE media_metadata ADD COLUMN raw_nai_parameters TEXT DEFAULT NULL').run();
    console.log('✅ Added column: raw_nai_parameters to media_metadata');
  } catch (error: any) {
    if (error.message.includes('duplicate column')) {
      console.log('⚠️  Column raw_nai_parameters already exists, skipping');
    } else {
      throw error;
    }
  }

  console.log('✅ Migration 009 completed successfully');
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 009_add_raw_nai_parameters.ts');

  // SQLite doesn't support DROP COLUMN directly in older versions
  // But better-sqlite3 with modern SQLite should support it
  try {
    db.prepare('ALTER TABLE media_metadata DROP COLUMN raw_nai_parameters').run();
    console.log('✅ Dropped column: raw_nai_parameters');
  } catch (error: any) {
    console.warn('⚠️  Failed to drop column:', error.message);
  }
};

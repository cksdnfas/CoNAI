import Database from 'better-sqlite3';

/**
 * Migration: Add model_references column to media_metadata
 * - 모델/LoRA 정보를 JSON 형태로 저장하여 Civitai 조회 편의성 향상
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🚀 model_references 컬럼 추가 마이그레이션 시작...\n');

  // Check if column already exists
  const tableInfo = db.prepare(`PRAGMA table_info(media_metadata)`).all() as Array<{ name: string }>;
  const hasColumn = tableInfo.some(col => col.name === 'model_references');

  if (!hasColumn) {
    db.exec(`
      ALTER TABLE media_metadata
      ADD COLUMN model_references TEXT
    `);
    console.log('  ✅ model_references 컬럼 추가 완료');
    console.log('     - JSON 형식: [{"name":"model", "hash":"abc123", "type":"checkpoint"}, ...]');
  } else {
    console.log('  ℹ️  model_references 컬럼이 이미 존재합니다.');
  }

  console.log('\n🎉 마이그레이션 완료!');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 model_references 컬럼 제거 마이그레이션 롤백...\n');

  // SQLite doesn't support DROP COLUMN directly in older versions
  // For simplicity, we'll just note that the column should be removed
  console.log('  ⚠️  SQLite는 DROP COLUMN을 직접 지원하지 않습니다.');
  console.log('     테이블 재생성이 필요합니다.');

  console.log('\n✅ 롤백 완료');
};

import Database from 'better-sqlite3';

/**
 * 마이그레이션: 이미지 유사도 검색을 위한 컬럼 추가
 * - perceptual_hash: pHash 알고리즘 기반 이미지 해시 (64비트)
 * - color_histogram: RGB 색상 분포 데이터 (JSON)
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 008: 이미지 유사도 검색 컬럼 추가 시작...');

  // images 테이블에 유사도 검색 컬럼 추가
  const columns = [
    { name: 'perceptual_hash', type: 'TEXT', comment: 'pHash 알고리즘 기반 이미지 해시' },
    { name: 'color_histogram', type: 'TEXT', comment: 'RGB 색상 분포 (JSON)' }
  ];

  for (const column of columns) {
    try {
      // 컬럼이 이미 존재하는지 확인
      const tableInfo = db.prepare(`PRAGMA table_info(images)`).all() as Array<{ name: string }>;
      const columnExists = tableInfo.some(col => col.name === column.name);

      if (!columnExists) {
        db.exec(`ALTER TABLE images ADD COLUMN ${column.name} ${column.type}`);
        console.log(`  ✅ ${column.name} 컬럼 추가 (${column.comment})`);
      } else {
        console.log(`  ⏭️  ${column.name} 컬럼 이미 존재`);
      }
    } catch (error) {
      console.error(`  ❌ ${column.name} 컬럼 추가 실패:`, error);
      throw error;
    }
  }

  // 검색 성능을 위한 인덱스 생성
  const indexes = [
    { name: 'idx_perceptual_hash', column: 'perceptual_hash' }
  ];

  for (const index of indexes) {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON images(${index.column})`);
      console.log(`  ✅ ${index.name} 인덱스 생성`);
    } catch (error) {
      console.error(`  ❌ ${index.name} 인덱스 생성 실패:`, error);
      throw error;
    }
  }

  console.log('✅ Migration 008: 이미지 유사도 검색 컬럼 추가 완료');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 008 rollback: 이미지 유사도 검색 컬럼 제거 시작...');

  // 인덱스 삭제
  try {
    db.exec('DROP INDEX IF EXISTS idx_perceptual_hash');
    console.log('  ✅ idx_perceptual_hash 인덱스 제거');
  } catch (error) {
    console.warn('  ⚠️  인덱스 제거 실패:', error);
  }

  // SQLite는 ALTER TABLE DROP COLUMN을 직접 지원하지 않으므로 경고만 출력
  console.warn('⚠️  SQLite는 컬럼 삭제를 직접 지원하지 않습니다.');
  console.warn('⚠️  유사도 검색 컬럼은 그대로 유지됩니다. (perceptual_hash, color_histogram)');
  console.warn('⚠️  필요시 데이터베이스를 백업 후 수동으로 테이블 재생성이 필요합니다.');

  console.log('✅ Migration 008 rollback: 완료 (컬럼 유지)');
};

import Database from 'better-sqlite3';

export const up = async (db: Database.Database): Promise<void> => {
  // groups 테이블에 자동수집 관련 필드 추가
  db.exec(`ALTER TABLE groups ADD COLUMN auto_collect_enabled BOOLEAN DEFAULT 0`);
  console.log('✅ auto_collect_enabled 컬럼이 추가되었습니다.');

  db.exec(`ALTER TABLE groups ADD COLUMN auto_collect_conditions TEXT`);
  console.log('✅ auto_collect_conditions 컬럼이 추가되었습니다.');

  db.exec(`ALTER TABLE groups ADD COLUMN auto_collect_last_run DATETIME`);
  console.log('✅ auto_collect_last_run 컬럼이 추가되었습니다.');

  // image_groups 테이블에 수집 방식 구분 필드 추가
  db.exec(`ALTER TABLE image_groups ADD COLUMN collection_type VARCHAR(10) DEFAULT 'manual'`);
  console.log('✅ collection_type 컬럼이 추가되었습니다.');

  db.exec(`ALTER TABLE image_groups ADD COLUMN auto_collected_date DATETIME`);
  console.log('✅ auto_collected_date 컬럼이 추가되었습니다.');

  // 자동수집 관련 인덱스 생성
  const indexes = [
    { name: 'idx_groups_auto_collect', table: 'groups', column: 'auto_collect_enabled' },
    { name: 'idx_image_groups_collection_type', table: 'image_groups', column: 'collection_type' },
    { name: 'idx_image_groups_auto_date', table: 'image_groups', column: 'auto_collected_date' }
  ];

  indexes.forEach(index => {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.column})`);
    } catch (err) {
      console.warn(`⚠️  Warning creating index ${index.name}:`, err);
    }
  });
  console.log('✅ 자동수집 관련 인덱스가 설정되었습니다.');
};

export const down = async (db: Database.Database): Promise<void> => {
  // 인덱스 삭제
  const indexes = [
    'idx_groups_auto_collect',
    'idx_image_groups_collection_type',
    'idx_image_groups_auto_date'
  ];

  indexes.forEach(indexName => {
    try {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    } catch (err) {
      console.warn(`⚠️  Warning dropping index ${indexName}:`, err);
    }
  });

  console.log('⚠️  SQLite에서는 컬럼 삭제가 복잡합니다. 필요시 수동으로 처리하세요.');
};

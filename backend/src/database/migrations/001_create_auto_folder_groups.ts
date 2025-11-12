import Database from 'better-sqlite3';

/**
 * 자동 폴더 그룹 마이그레이션
 * - auto_folder_groups: 파일 시스템 폴더 구조를 반영한 읽기 전용 그룹
 * - auto_folder_group_images: 폴더 그룹과 이미지 연결 (composite_hash 기준)
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🚀 자동 폴더 그룹 마이그레이션 시작...\n');

  // ============================================
  // 1. 자동 폴더 그룹 테이블
  // ============================================
  console.log('📁 auto_folder_groups 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_folder_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      parent_id INTEGER,
      depth INTEGER NOT NULL DEFAULT 0,
      has_images BOOLEAN DEFAULT 0,
      image_count INTEGER DEFAULT 0,
      color VARCHAR(7),
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES auto_folder_groups(id) ON DELETE SET NULL,
      UNIQUE(folder_path)
    )
  `);

  // 인덱스 생성
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_folder_groups_parent_id
    ON auto_folder_groups(parent_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_folder_groups_folder_path
    ON auto_folder_groups(folder_path)
  `);

  console.log('  ✅ auto_folder_groups 테이블 + 인덱스 생성 완료\n');

  // ============================================
  // 2. 자동 폴더 그룹 이미지 연결 테이블
  // ============================================
  console.log('🔗 auto_folder_group_images 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_folder_group_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      composite_hash TEXT NOT NULL,
      added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES auto_folder_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
      UNIQUE(group_id, composite_hash)
    )
  `);

  // 인덱스 생성
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_folder_images_group
    ON auto_folder_group_images(group_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_folder_images_hash
    ON auto_folder_group_images(composite_hash)
  `);

  console.log('  ✅ auto_folder_group_images 테이블 + 인덱스 생성 완료\n');

  console.log('🎉 자동 폴더 그룹 마이그레이션 완료!');
  console.log('📊 생성된 테이블 요약:');
  console.log('   - auto_folder_groups: 폴더 계층 구조');
  console.log('   - auto_folder_group_images: 이미지 연결 (composite_hash 기준)');
  console.log('   총 2개 테이블 + 4개 인덱스 생성\n');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 자동 폴더 그룹 마이그레이션 롤백 시작...\n');

  // 역순으로 테이블 제거
  const tables = [
    'auto_folder_group_images',
    'auto_folder_groups'
  ];

  tables.forEach(table => {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    console.log(`  ✅ ${table} 테이블 제거`);
  });

  console.log('\n✅ 자동 폴더 그룹 마이그레이션 롤백 완료');
};

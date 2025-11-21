import Database from 'better-sqlite3';

/**
 * Civitai Integration Migration
 * - model_info: Civitai API에서 가져온 모델 정보 캐시
 * - image_models: 이미지와 모델 해시 연결
 * - civitai_settings: Civitai 기능 설정
 * - civitai_temp_urls: Post Intent용 임시 URL
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🚀 Civitai Integration 마이그레이션 시작...\n');

  // ============================================
  // 1. model_info 테이블 - 모델 정보 캐시
  // ============================================
  console.log('📦 model_info 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- 기본 정보
      model_hash TEXT UNIQUE NOT NULL,
      model_name TEXT,
      model_version_id TEXT,
      civitai_model_id INTEGER,
      model_type TEXT,

      -- Civitai 데이터
      civitai_data TEXT,
      thumbnail_path TEXT,

      -- 메타 정보
      last_checked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_hash ON model_info(model_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_version ON model_info(model_version_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_civitai_model ON model_info(civitai_model_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_type ON model_info(model_type)`);

  console.log('  ✅ model_info 테이블 + 인덱스 생성 완료\n');

  // ============================================
  // 2. image_models 테이블 - 이미지-모델 연결
  // ============================================
  console.log('🔗 image_models 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- 관계
      composite_hash TEXT NOT NULL,
      model_hash TEXT NOT NULL,

      -- 모델 역할
      model_role TEXT NOT NULL,
      weight REAL,

      -- Civitai 조회 상태
      civitai_checked INTEGER DEFAULT 0,
      civitai_failed INTEGER DEFAULT 0,
      checked_at DATETIME,

      -- 메타
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
      UNIQUE(composite_hash, model_hash, model_role)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_models_composite ON image_models(composite_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_models_hash ON image_models(model_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_models_unchecked ON image_models(civitai_checked, civitai_failed)`);

  console.log('  ✅ image_models 테이블 + 인덱스 생성 완료\n');

  // ============================================
  // 3. civitai_settings 테이블 - 설정
  // ============================================
  console.log('⚙️ civitai_settings 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS civitai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),

      -- 기능 활성화 (기본: 비활성화 - API 키 설정 전까지)
      enabled INTEGER DEFAULT 0,

      -- Rate Limiting
      api_call_interval INTEGER DEFAULT 2,

      -- 통계
      total_lookups INTEGER DEFAULT 0,
      successful_lookups INTEGER DEFAULT 0,
      failed_lookups INTEGER DEFAULT 0,
      last_api_call DATETIME,

      -- 메타
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 기본값 삽입
  db.exec(`INSERT OR IGNORE INTO civitai_settings (id) VALUES (1)`);

  console.log('  ✅ civitai_settings 테이블 생성 완료\n');

  // ============================================
  // 4. civitai_temp_urls 테이블 - Post Intent용
  // ============================================
  console.log('🔗 civitai_temp_urls 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS civitai_temp_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      token TEXT UNIQUE NOT NULL,
      composite_hash TEXT NOT NULL,
      include_metadata INTEGER DEFAULT 1,

      expires_at DATETIME NOT NULL,
      access_count INTEGER DEFAULT 0,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_temp_urls_token ON civitai_temp_urls(token)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_temp_urls_expires ON civitai_temp_urls(expires_at)`);

  console.log('  ✅ civitai_temp_urls 테이블 + 인덱스 생성 완료\n');

  console.log('🎉 Civitai Integration 마이그레이션 완료!');
  console.log('📊 생성된 테이블 요약:');
  console.log('   - model_info: 모델 정보 캐시');
  console.log('   - image_models: 이미지-모델 연결');
  console.log('   - civitai_settings: 설정');
  console.log('   - civitai_temp_urls: Post Intent용 임시 URL');
  console.log('   총 4개 테이블 + 9개 인덱스 생성\n');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Civitai Integration 마이그레이션 롤백 시작...\n');

  const tables = [
    'civitai_temp_urls',
    'civitai_settings',
    'image_models',
    'model_info'
  ];

  tables.forEach(table => {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    console.log(`  ✅ ${table} 테이블 제거`);
  });

  console.log('\n✅ Civitai Integration 마이그레이션 롤백 완료');
};

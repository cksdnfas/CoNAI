import Database from 'better-sqlite3';

/**
 * 마이그레이션: 폴더 스캔 시스템 테이블 생성
 * - image_metadata: 이미지의 영구 메타데이터 (복합 해시 기반)
 * - watched_folders: 감시 폴더 목록 및 설정
 * - image_files: 파일 위치 추적 (휘발성)
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 016: 폴더 스캔 시스템 테이블 생성 시작...');

  // 1. image_metadata 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_metadata (
      -- 고유 식별자 (복합 해시: pHash + dHash + aHash = 48자)
      composite_hash TEXT PRIMARY KEY,

      -- 지각적 해시들 (개별 접근 및 유사도 검색용)
      perceptual_hash TEXT NOT NULL,
      dhash TEXT NOT NULL,
      ahash TEXT NOT NULL,
      color_histogram TEXT,

      -- 이미지 기본 정보
      width INTEGER,
      height INTEGER,

      -- 썸네일 및 최적화 이미지 (캐시 폴더 경로)
      thumbnail_path TEXT,
      optimized_path TEXT,

      -- AI 생성 메타데이터
      ai_tool TEXT,
      model_name TEXT,
      lora_models TEXT,
      steps INTEGER,
      cfg_scale REAL,
      sampler TEXT,
      seed INTEGER,
      scheduler TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      denoise_strength REAL,
      generation_time REAL,
      batch_size INTEGER,
      batch_index INTEGER,

      -- 자동 태그
      auto_tags TEXT,

      -- 비디오 메타데이터 (선택적)
      duration REAL,
      fps REAL,
      video_codec TEXT,
      audio_codec TEXT,
      bitrate INTEGER,

      -- 평가 시스템
      rating_score INTEGER DEFAULT 0,

      -- 타임스탬프
      first_seen_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata_updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✅ image_metadata 테이블 생성');

  // 2. watched_folders 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- 폴더 정보
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      folder_type TEXT DEFAULT 'scan',

      -- 스캔 설정
      auto_scan INTEGER DEFAULT 0,
      scan_interval INTEGER DEFAULT 60,
      recursive INTEGER DEFAULT 1,

      -- 필터 설정 (JSON)
      file_extensions TEXT,
      exclude_patterns TEXT,

      -- 상태
      is_active INTEGER DEFAULT 1,
      last_scan_date DATETIME,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,

      -- 타임스탬프
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✅ watched_folders 테이블 생성');

  // 3. image_files 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- 메타데이터 참조
      composite_hash TEXT NOT NULL,

      -- 파일 위치 정보
      original_file_path TEXT NOT NULL UNIQUE,
      folder_id INTEGER NOT NULL,

      -- 파일 상태
      file_status TEXT NOT NULL DEFAULT 'active',
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_modified_date DATETIME,

      -- 스캔 정보
      scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_verified_date DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (composite_hash) REFERENCES image_metadata(composite_hash) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE
    )
  `);
  console.log('  ✅ image_files 테이블 생성');

  // 4. 인덱스 생성
  const indexes = [
    // image_metadata 인덱스
    { name: 'idx_metadata_phash', table: 'image_metadata', column: 'perceptual_hash' },
    { name: 'idx_metadata_dhash', table: 'image_metadata', column: 'dhash' },
    { name: 'idx_metadata_ahash', table: 'image_metadata', column: 'ahash' },
    { name: 'idx_metadata_ai_tool', table: 'image_metadata', column: 'ai_tool' },
    { name: 'idx_metadata_model', table: 'image_metadata', column: 'model_name' },
    { name: 'idx_metadata_first_seen', table: 'image_metadata', column: 'first_seen_date' },

    // watched_folders 인덱스
    { name: 'idx_folders_type', table: 'watched_folders', column: 'folder_type' },
    { name: 'idx_folders_active', table: 'watched_folders', column: 'is_active' },
    { name: 'idx_folders_auto_scan', table: 'watched_folders', column: 'auto_scan' },

    // image_files 인덱스
    { name: 'idx_files_composite_hash', table: 'image_files', column: 'composite_hash' },
    { name: 'idx_files_folder_id', table: 'image_files', column: 'folder_id' },
    { name: 'idx_files_status', table: 'image_files', column: 'file_status' },
    { name: 'idx_files_scan_date', table: 'image_files', column: 'scan_date' },
    { name: 'idx_files_path', table: 'image_files', column: 'original_file_path' }
  ];

  for (const index of indexes) {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.column})`);
      console.log(`  ✅ ${index.name} 인덱스 생성`);
    } catch (error) {
      console.error(`  ❌ ${index.name} 인덱스 생성 실패:`, error);
    }
  }

  // 5. 기본 폴더 등록 (uploads/images)
  const defaultUploadPath = 'uploads/images';
  try {
    db.prepare(`
      INSERT OR IGNORE INTO watched_folders (folder_path, folder_name, folder_type, is_active)
      VALUES (?, ?, ?, ?)
    `).run(defaultUploadPath, '직접 업로드', 'upload', 1);
    console.log('  ✅ 기본 업로드 폴더 등록');
  } catch (error) {
    console.warn('  ⚠️  기본 폴더 등록 실패:', error);
  }

  console.log('✅ Migration 016: 폴더 스캔 시스템 테이블 생성 완료');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 016 rollback: 폴더 스캔 시스템 테이블 제거 시작...');

  // 인덱스 제거
  const indexes = [
    'idx_metadata_phash',
    'idx_metadata_dhash',
    'idx_metadata_ahash',
    'idx_metadata_ai_tool',
    'idx_metadata_model',
    'idx_metadata_first_seen',
    'idx_folders_type',
    'idx_folders_active',
    'idx_folders_auto_scan',
    'idx_files_composite_hash',
    'idx_files_folder_id',
    'idx_files_status',
    'idx_files_scan_date',
    'idx_files_path'
  ];

  for (const indexName of indexes) {
    try {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    } catch (err) {
      console.warn(`  ⚠️  인덱스 ${indexName} 제거 실패:`, err);
    }
  }

  // 테이블 제거 (역순)
  db.exec('DROP TABLE IF EXISTS image_files');
  console.log('  ✅ image_files 테이블 제거');

  db.exec('DROP TABLE IF EXISTS watched_folders');
  console.log('  ✅ watched_folders 테이블 제거');

  db.exec('DROP TABLE IF EXISTS image_metadata');
  console.log('  ✅ image_metadata 테이블 제거');

  console.log('✅ Migration 016 rollback: 완료');
};

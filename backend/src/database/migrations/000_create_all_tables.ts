import Database from 'better-sqlite3';
import path from 'path';

/**
 * 통합 마이그레이션: 모든 필수 테이블 생성
 * - 프롬프트 관리 (prompt_collection, negative_prompt_collection, prompt_groups, negative_prompt_groups)
 * - 그룹 관리 (groups, image_groups)
 * - 평가 시스템 (rating_weights, rating_tiers)
 * - 이미지 메타데이터 (image_metadata, image_files)
 * - 폴더 관리 (watched_folders, scan_logs)
 * - 워크플로우 (workflows, comfyui_servers, workflow_servers)
 * - API 생성 히스토리 (generation_history)
 * - 사용자 설정 (user_preferences, wildcards)
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🚀 통합 마이그레이션: 모든 테이블 생성 시작...\n');

  // ============================================
  // 1. 프롬프트 수집 시스템
  // ============================================
  console.log('📝 프롬프트 수집 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_collection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      usage_count INTEGER DEFAULT 1,
      group_id INTEGER,
      synonyms TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS negative_prompt_collection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      usage_count INTEGER DEFAULT 1,
      group_id INTEGER,
      synonyms TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_visible BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_name)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS negative_prompt_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_visible BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_name)
    )
  `);

  // 프롬프트 인덱스
  const promptIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_prompt_usage ON prompt_collection(usage_count)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_group ON prompt_collection(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_negative_prompt_usage ON negative_prompt_collection(usage_count)',
    'CREATE INDEX IF NOT EXISTS idx_negative_prompt_group ON negative_prompt_collection(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_groups_order ON prompt_groups(display_order)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_groups_visible ON prompt_groups(is_visible)',
    'CREATE INDEX IF NOT EXISTS idx_negative_groups_order ON negative_prompt_groups(display_order)',
    'CREATE INDEX IF NOT EXISTS idx_negative_groups_visible ON negative_prompt_groups(is_visible)'
  ];

  promptIndexes.forEach(sql => db.exec(sql));
  console.log('  ✅ 프롬프트 테이블 4개 + 인덱스 생성 완료\n');

  // ============================================
  // 2. 그룹 관리 시스템
  // ============================================
  console.log('📁 그룹 관리 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      color VARCHAR(7),
      parent_id INTEGER,
      auto_collect_enabled BOOLEAN DEFAULT 0,
      auto_collect_conditions TEXT,
      auto_collect_last_run DATETIME,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES groups(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      composite_hash TEXT NOT NULL,
      added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      order_index INTEGER DEFAULT 0,
      collection_type VARCHAR(10) DEFAULT 'manual',
      auto_collected_date DATETIME,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (composite_hash) REFERENCES image_metadata(composite_hash) ON DELETE CASCADE,
      UNIQUE(group_id, composite_hash)
    )
  `);

  // 그룹 인덱스
  const groupIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_groups_parent_id ON groups(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_groups_created_date ON groups(created_date)',
    'CREATE INDEX IF NOT EXISTS idx_groups_auto_collect ON groups(auto_collect_enabled)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_group_id ON image_groups(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_composite_hash ON image_groups(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_added_date ON image_groups(added_date)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_order ON image_groups(order_index)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_collection_type ON image_groups(collection_type)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_auto_date ON image_groups(auto_collected_date)'
  ];

  groupIndexes.forEach(sql => db.exec(sql));

  // 기본 그룹 생성
  db.prepare(`INSERT OR IGNORE INTO groups (name, description, color) VALUES (?, ?, ?)`)
    .run('즐겨찾기', '즐겨찾는 이미지들', '#f59e0b');

  console.log('  ✅ 그룹 테이블 2개 + 인덱스 + 기본 그룹 생성 완료\n');

  // ============================================
  // 3. 평가 시스템
  // ============================================
  console.log('⭐ 평가 시스템 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS rating_weights (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      general_weight REAL NOT NULL DEFAULT 1,
      sensitive_weight REAL NOT NULL DEFAULT 5,
      questionable_weight REAL NOT NULL DEFAULT 15,
      explicit_weight REAL NOT NULL DEFAULT 50,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rating_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier_name VARCHAR(50) NOT NULL,
      min_score REAL NOT NULL,
      max_score REAL,
      tier_order INTEGER NOT NULL,
      color VARCHAR(20),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tier_order)
    )
  `);

  // 기본 가중치 삽입
  db.prepare(`
    INSERT OR IGNORE INTO rating_weights (id, general_weight, sensitive_weight, questionable_weight, explicit_weight)
    VALUES (1, 1, 5, 15, 50)
  `).run();

  // 기본 등급 삽입
  const defaultTiers = [
    { tier_name: 'G', min_score: 0, max_score: 2, tier_order: 1, color: '#22c55e' },
    { tier_name: 'Teen', min_score: 2, max_score: 6, tier_order: 2, color: '#3b82f6' },
    { tier_name: 'SFW', min_score: 6, max_score: 15, tier_order: 3, color: '#f59e0b' },
    { tier_name: 'NSFW', min_score: 15, max_score: null, tier_order: 4, color: '#ef4444' }
  ];

  const insertTier = db.prepare(`
    INSERT OR IGNORE INTO rating_tiers (tier_name, min_score, max_score, tier_order, color)
    VALUES (?, ?, ?, ?, ?)
  `);

  defaultTiers.forEach(tier => {
    insertTier.run(tier.tier_name, tier.min_score, tier.max_score, tier.tier_order, tier.color);
  });

  console.log('  ✅ 평가 테이블 2개 + 기본 데이터 생성 완료\n');

  // ============================================
  // 4. 이미지 메타데이터 시스템
  // ============================================
  console.log('🖼️  이미지 메타데이터 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_metadata (
      composite_hash TEXT PRIMARY KEY,
      perceptual_hash TEXT NOT NULL,
      dhash TEXT NOT NULL,
      ahash TEXT NOT NULL,
      color_histogram TEXT,
      width INTEGER,
      height INTEGER,
      thumbnail_path TEXT,
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
      auto_tags TEXT,
      duration REAL,
      fps REAL,
      video_codec TEXT,
      audio_codec TEXT,
      bitrate INTEGER,
      rating_score INTEGER DEFAULT 0,
      first_seen_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata_updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 이미지 메타데이터 인덱스
  const metadataIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_metadata_phash ON image_metadata(perceptual_hash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_dhash ON image_metadata(dhash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_ahash ON image_metadata(ahash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_ai_tool ON image_metadata(ai_tool)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_model ON image_metadata(model_name)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_first_seen ON image_metadata(first_seen_date)'
  ];

  metadataIndexes.forEach(sql => db.exec(sql));
  console.log('  ✅ 이미지 메타데이터 테이블 + 인덱스 생성 완료\n');

  // ============================================
  // 4-2. 비디오 메타데이터 시스템
  // ============================================
  console.log('🎬 비디오 메타데이터 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS video_metadata (
      composite_hash TEXT PRIMARY KEY,
      duration REAL,
      fps REAL,
      width INTEGER,
      height INTEGER,
      video_codec TEXT,
      audio_codec TEXT,
      bitrate INTEGER,
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
      auto_tags TEXT,
      rating_score INTEGER DEFAULT 0,
      first_seen_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata_updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 비디오 메타데이터 인덱스
  const videoMetadataIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_video_ai_tool ON video_metadata(ai_tool)',
    'CREATE INDEX IF NOT EXISTS idx_video_model ON video_metadata(model_name)',
    'CREATE INDEX IF NOT EXISTS idx_video_first_seen ON video_metadata(first_seen_date)',
    'CREATE INDEX IF NOT EXISTS idx_video_duration ON video_metadata(duration)',
    'CREATE INDEX IF NOT EXISTS idx_video_codec ON video_metadata(video_codec)'
  ];

  videoMetadataIndexes.forEach(sql => db.exec(sql));
  console.log('  ✅ 비디오 메타데이터 테이블 + 인덱스 생성 완료\n');

  // ============================================
  // 5. 폴더 스캔 시스템
  // ============================================
  console.log('📂 폴더 스캔 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      folder_type TEXT DEFAULT 'scan',
      auto_scan INTEGER DEFAULT 0,
      scan_interval INTEGER DEFAULT 60,
      recursive INTEGER DEFAULT 1,
      file_extensions TEXT,
      exclude_patterns TEXT,
      exclude_extensions TEXT,
      watcher_enabled INTEGER DEFAULT 0,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event DATETIME,
      is_active INTEGER DEFAULT 1,
      last_scan_date DATETIME,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite_hash TEXT,
      file_type TEXT NOT NULL DEFAULT 'image',
      original_file_path TEXT NOT NULL UNIQUE,
      folder_id INTEGER NOT NULL,
      file_status TEXT NOT NULL DEFAULT 'active',
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_modified_date DATETIME,
      scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_verified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (composite_hash) REFERENCES image_metadata(composite_hash) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      scan_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      scan_status TEXT NOT NULL,
      total_scanned INTEGER DEFAULT 0,
      new_images INTEGER DEFAULT 0,
      existing_images INTEGER DEFAULT 0,
      updated_paths INTEGER DEFAULT 0,
      missing_images INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      duration_ms INTEGER,
      error_details TEXT,
      FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE
    )
  `);

  // 폴더 시스템 인덱스
  const folderIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_folders_type ON watched_folders(folder_type)',
    'CREATE INDEX IF NOT EXISTS idx_folders_active ON watched_folders(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_folders_auto_scan ON watched_folders(auto_scan)',
    'CREATE INDEX IF NOT EXISTS idx_files_composite_hash ON image_files(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_files_file_type ON image_files(file_type)',
    'CREATE INDEX IF NOT EXISTS idx_files_folder_id ON image_files(folder_id)',
    'CREATE INDEX IF NOT EXISTS idx_files_status ON image_files(file_status)',
    'CREATE INDEX IF NOT EXISTS idx_files_scan_date ON image_files(scan_date)',
    'CREATE INDEX IF NOT EXISTS idx_files_path ON image_files(original_file_path)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_folder_id ON scan_logs(folder_id)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_scan_date ON scan_logs(scan_date)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_status ON scan_logs(scan_status)'
  ];

  folderIndexes.forEach(sql => db.exec(sql));

  // 기본 업로드 폴더 등록 (상대 경로)
  // 모든 폴더를 동일하게 취급 - auto_scan 및 watcher_enabled 활성화
  const defaultUploadPath = path.join('uploads', 'images');
  db.prepare(`
    INSERT OR IGNORE INTO watched_folders
    (folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive, is_active, watcher_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(defaultUploadPath, '직접 업로드', 'upload', 1, 60, 1, 1, 1);

  // API 생성 이미지 폴더 등록
  const apiUploadPath = path.join('uploads', 'API', 'images');
  db.prepare(`
    INSERT OR IGNORE INTO watched_folders
    (folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive, is_active, watcher_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(apiUploadPath, 'API 생성 이미지', 'api', 1, 60, 1, 1, 1);

  // 비디오 업로드 폴더 등록
  const videoUploadPath = path.join('uploads', 'videos');
  db.prepare(`
    INSERT OR IGNORE INTO watched_folders
    (folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive, is_active, watcher_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(videoUploadPath, '비디오 업로드', 'upload', 1, 60, 1, 1, 1);

  console.log('  ✅ 폴더 테이블 3개 + 인덱스 + 기본 폴더 3개 생성 완료\n');

  // ============================================
  // 6. API 생성 히스토리 (apiGenerationDb.ts에서 관리)
  // ============================================
  // Note: generation_history 테이블은 별도 DB에서 관리됨

  console.log('🎉 통합 마이그레이션 완료!');
  console.log('📊 생성된 테이블 요약:');
  console.log('   - 프롬프트: 4개 테이블');
  console.log('   - 그룹: 2개 테이블');
  console.log('   - 평가: 2개 테이블');
  console.log('   - 이미지 메타데이터: 1개 테이블');
  console.log('   - 비디오 메타데이터: 1개 테이블');
  console.log('   - 폴더 관리: 3개 테이블');
  console.log('   총 13개 테이블 + 인덱스 생성');
  console.log('   (워크플로우, 사용자 설정, API 생성 히스토리는 별도 DB)\n');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 통합 마이그레이션 롤백 시작...\n');

  // 역순으로 테이블 제거 (images.db 테이블만)
  const tables = [
    'scan_logs',
    'image_files',
    'watched_folders',
    'image_groups',
    'groups',
    'rating_tiers',
    'rating_weights',
    'negative_prompt_groups',
    'prompt_groups',
    'negative_prompt_collection',
    'prompt_collection',
    'video_metadata',
    'image_metadata'
  ];

  tables.forEach(table => {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    console.log(`  ✅ ${table} 테이블 제거`);
  });

  console.log('\n✅ 통합 마이그레이션 롤백 완료');
};

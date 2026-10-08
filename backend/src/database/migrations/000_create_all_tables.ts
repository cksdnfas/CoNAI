import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function resolveMigrationEnvPath(currentDir: string) {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env')
  }

  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(currentDir, '../../.env'),
    path.resolve(currentDir, '../../../.env'),
    path.resolve(currentDir, '../../../../.env'),
    path.resolve(currentDir, '../../../../../.env'),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function resolveMigrationEnvBaseDir(currentDir: string) {
  return path.dirname(resolveMigrationEnvPath(currentDir))
}

function resolveMigrationEnvConfiguredPath(value: string, currentDir: string) {
  const trimmed = value.trim()

  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed)
  }

  return path.resolve(resolveMigrationEnvBaseDir(currentDir), trimmed)
}

// ============================================================================
// Baseline = 예전 마이그레이션 000~035 를 끝까지 적용한 스키마
//
// 001~035 는 이 파일 하나로 합쳐졌다 (목록: migrationManager.ts 의 SQUASHED_MIGRATION_VERSIONS).
// 이 파일은 빈 DB 에서만 실행된다. 기존 DB 는 000 기록이 있어서 건너뛰고, migrationManager 가
// 합쳐진 버전 기록이 전부 있는지 확인한다. 036 이후는 이 baseline 위에 그대로 이어진다.
// 그래서 여기서 테이블 정의를 바꾸면 안 된다. 스키마 변경은 새 마이그레이션 파일로 한다.
//
// 아래 자동 태그 / 프롬프트 검색 SQL 은 런타임 서비스와 문자 단위로 같아야 한다
// (autoTagStateService.ts, promptSearchIndexService.ts 의 POSITIVE_TEXT_SQL / NEGATIVE_TEXT_SQL).
// FTS5 external-content 인덱스는 삽입 때와 삭제 때의 텍스트가 1바이트라도 다르면 조용히 손상된다.
// 마이그레이션 파일은 프로젝트 모듈을 import 할 수 없다(포터블/SEA 빌드가 컴파일된
// migrations 디렉터리만 통째로 복사한다). 그래서 공유가 아니라 복사본이다.
// ============================================================================

const CAPABILITY_TAGGER_SQL = `COALESCE((SELECT tagger_enabled FROM auto_tag_state_meta WHERE id = 1), 1) = 1`;
const CAPABILITY_KALOSCOPE_SQL = `COALESCE((SELECT kaloscope_enabled FROM auto_tag_state_meta WHERE id = 1), 1) = 1`;

/** Same meaning as the scheduler's json_extract OR chain, guarded against malformed JSON. */
function needsAutoTagWorkSql(autoTagsExpr: string): string {
  return `(
    ${autoTagsExpr} IS NULL
    OR json_valid(${autoTagsExpr}) = 0
    OR (${CAPABILITY_TAGGER_SQL} AND json_extract(${autoTagsExpr}, '$.tagger') IS NULL)
    OR (${CAPABILITY_KALOSCOPE_SQL} AND json_extract(${autoTagsExpr}, '$.kaloscope') IS NULL)
  )`;
}

/** Searchable positive text: prompt + NAI character prompt + v4 char captions. */
function positiveTextSql(prefix: string): string {
  return `(
    COALESCE(${prefix}.prompt, '') || char(10) ||
    COALESCE(${prefix}.character_prompt_text, '') || char(10) ||
    CASE WHEN json_valid(${prefix}.raw_nai_parameters) = 1 THEN COALESCE((
      SELECT group_concat(COALESCE(json_extract(char_item.value, '$.char_caption'), ''), char(10))
      FROM json_each(${prefix}.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
    ), '') ELSE '' END
  )`;
}

function negativeTextSql(prefix: string): string {
  return `COALESCE(${prefix}.negative_prompt, '')`;
}

/**
 * Only touch the index for rows the backfill already owns.
 * 'ready' means the whole table is owned.
 */
function syncGateSql(rowidExpression: string): string {
  return `EXISTS (
    SELECT 1 FROM media_prompt_fts_state s
    WHERE s.id = 1
      AND s.status IN ('pending', 'ready')
      AND (s.status = 'ready' OR ${rowidExpression} <= s.last_rowid)
  )`;
}

function execAll(db: Database.Database, statements: string[]): void {
  statements.forEach((sql) => db.exec(sql));
}

/**
 * Baseline: images.db 의 모든 테이블을 만든다.
 * - 프롬프트 수집 (prompt_collection, negative_prompt_collection, prompt_groups, negative_prompt_groups, auto_prompt_*)
 * - 그룹 (groups, image_groups, auto_folder_groups, auto_folder_group_images)
 * - 평가 (rating_weights, rating_tiers)
 * - 미디어 (media_metadata, media_auto_tag_index, image_files, image_metadata_edit_revisions)
 * - 폴더/백업 소스 (watched_folders, scan_logs, backup_sources)
 * - 자동 태그 상태 / 프롬프트 검색 인덱스 (auto_tag_state_meta, media_prompt_fts*)
 * - Civitai 모델 정보 (model_info, image_models, civitai_settings)
 * - 시스템 (system_settings, file_verification_logs)
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🚀 Baseline 마이그레이션: images.db 테이블 생성 시작...');

  // ============================================
  // 1. 프롬프트 수집
  // ============================================
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
      parent_id INTEGER DEFAULT NULL,
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
      parent_id INTEGER DEFAULT NULL,
      UNIQUE(group_name)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_prompt_collection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      usage_count INTEGER DEFAULT 0,
      group_id INTEGER,
      synonyms TEXT, -- JSON array string
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_prompt_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      parent_id INTEGER, -- 계층 구조를 위한 부모 그룹 ID
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  execAll(db, [
    'CREATE INDEX IF NOT EXISTS idx_prompt_usage ON prompt_collection(usage_count)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_group ON prompt_collection(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_collection_prompt ON prompt_collection(prompt)',
    'CREATE INDEX IF NOT EXISTS idx_negative_prompt_usage ON negative_prompt_collection(usage_count)',
    'CREATE INDEX IF NOT EXISTS idx_negative_prompt_group ON negative_prompt_collection(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_groups_order ON prompt_groups(display_order)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_groups_visible ON prompt_groups(is_visible)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_groups_parent ON prompt_groups(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_negative_groups_order ON negative_prompt_groups(display_order)',
    'CREATE INDEX IF NOT EXISTS idx_negative_groups_visible ON negative_prompt_groups(is_visible)',
    'CREATE INDEX IF NOT EXISTS idx_negative_prompt_groups_parent ON negative_prompt_groups(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_auto_prompt_collection_prompt ON auto_prompt_collection(prompt)',
    'CREATE INDEX IF NOT EXISTS idx_auto_prompt_collection_usage ON auto_prompt_collection(usage_count DESC)',
    'CREATE INDEX IF NOT EXISTS idx_auto_prompt_collection_group ON auto_prompt_collection(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_auto_prompt_groups_order ON auto_prompt_groups(display_order)',
    'CREATE INDEX IF NOT EXISTS idx_auto_prompt_groups_parent ON auto_prompt_groups(parent_id)',
  ]);

  // Pre-create LoRA groups to avoid race conditions during prompt collection
  db.prepare(`INSERT OR IGNORE INTO prompt_groups (group_name, display_order, is_visible)
    VALUES (?, ?, ?)`).run('LoRA', 999, 1);
  db.prepare(`INSERT OR IGNORE INTO negative_prompt_groups (group_name, display_order, is_visible)
    VALUES (?, ?, ?)`).run('LoRA', 999, 1);

  // ============================================
  // 2. 그룹
  // ============================================
  // groups.name 의 전역 UNIQUE 는 036 이 "같은 부모 안에서만 고유" 로 바꾼다 (테이블 재생성).
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
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
      UNIQUE(group_id, composite_hash)
    )
  `);

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

  execAll(db, [
    'CREATE INDEX IF NOT EXISTS idx_groups_parent_id ON groups(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_groups_created_date ON groups(created_date)',
    'CREATE INDEX IF NOT EXISTS idx_groups_auto_collect ON groups(auto_collect_enabled)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_group_id ON image_groups(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_composite_hash ON image_groups(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_added_date ON image_groups(added_date)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_order ON image_groups(order_index)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_collection_type ON image_groups(collection_type)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_auto_date ON image_groups(auto_collected_date)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_group_composite ON image_groups(group_id, composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_image_groups_group_collection_hash ON image_groups(group_id, collection_type, composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_auto_folder_groups_parent_id ON auto_folder_groups(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_auto_folder_groups_folder_path ON auto_folder_groups(folder_path)',
    'CREATE INDEX IF NOT EXISTS idx_auto_folder_images_group ON auto_folder_group_images(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_auto_folder_images_hash ON auto_folder_group_images(composite_hash)',
  ]);

  db.prepare(`INSERT OR IGNORE INTO groups (name, description, color) VALUES (?, ?, ?)`)
    .run('즐겨찾기', '즐겨찾는 이미지들', '#f59e0b');

  // ============================================
  // 3. 평가
  // ============================================
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
      feed_visibility VARCHAR(10) NOT NULL DEFAULT 'show',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tier_order)
    )
  `);

  db.prepare(`
    INSERT OR IGNORE INTO rating_weights (id, general_weight, sensitive_weight, questionable_weight, explicit_weight)
    VALUES (1, 1, 5, 15, 50)
  `).run();

  const insertTier = db.prepare(`
    INSERT OR IGNORE INTO rating_tiers (tier_name, min_score, max_score, tier_order, color, feed_visibility)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  [
    { tier_name: 'G', min_score: 0, max_score: 2, tier_order: 1, color: '#22c55e' },
    { tier_name: 'Teen', min_score: 2, max_score: 6, tier_order: 2, color: '#3b82f6' },
    { tier_name: 'SFW', min_score: 6, max_score: 15, tier_order: 3, color: '#f59e0b' },
    { tier_name: 'NSFW', min_score: 15, max_score: null, tier_order: 4, color: '#ef4444' },
  ].forEach((tier) => {
    insertTier.run(tier.tier_name, tier.min_score, tier.max_score, tier.tier_order, tier.color, 'show');
  });

  // ============================================
  // 4. 미디어 메타데이터
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_metadata (
      composite_hash TEXT PRIMARY KEY,
      perceptual_hash TEXT,
      dhash TEXT,
      ahash TEXT,
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
      rating_score INTEGER,
      first_seen_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata_updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      postprocess_status TEXT NOT NULL DEFAULT 'ready',
      postprocess_completed_at DATETIME DEFAULT NULL,
      -- NovelAI 원본 생성 파라미터. 아래 프롬프트 검색 트리거가 읽는다.
      raw_nai_parameters TEXT DEFAULT NULL,
      -- NAI v4 캐릭터 캡션 평문. 아래 프롬프트 검색 트리거가 읽는다.
      character_prompt_text TEXT DEFAULT NULL,
      -- 자동 태그 스케줄러 작업 상태: 'pending' | 'done' | 'skip' | NULL
      auto_tag_state TEXT DEFAULT NULL,
      model_references TEXT,
      prompt_similarity_algorithm TEXT DEFAULT NULL,
      prompt_similarity_version INTEGER DEFAULT NULL,
      pos_prompt_normalized TEXT DEFAULT NULL,
      neg_prompt_normalized TEXT DEFAULT NULL,
      auto_prompt_normalized TEXT DEFAULT NULL,
      pos_prompt_fingerprint TEXT DEFAULT NULL,
      neg_prompt_fingerprint TEXT DEFAULT NULL,
      auto_prompt_fingerprint TEXT DEFAULT NULL,
      prompt_similarity_updated_date DATETIME DEFAULT NULL
    )
  `);

  const promptSimilarityCandidateIndex = (name: string, fingerprintColumn: string) => `
    CREATE INDEX IF NOT EXISTS ${name}
      ON media_metadata (
        prompt_similarity_algorithm,
        prompt_similarity_version,
        ${fingerprintColumn},
        rating_score,
        postprocess_status,
        composite_hash
      )
      WHERE ${fingerprintColumn} IS NOT NULL`;

  execAll(db, [
    'CREATE INDEX IF NOT EXISTS idx_metadata_phash ON media_metadata(perceptual_hash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_dhash ON media_metadata(dhash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_ahash ON media_metadata(ahash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_ai_tool ON media_metadata(ai_tool)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_model ON media_metadata(model_name)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_first_seen ON media_metadata(first_seen_date)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_composite_lookup ON media_metadata(composite_hash, perceptual_hash, dhash, ahash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_first_seen_desc ON media_metadata(first_seen_date DESC)',
    // Hide media that is still in immediate post-processing
    'CREATE INDEX IF NOT EXISTS idx_metadata_postprocess_status ON media_metadata(postprocess_status)',
    // Auto-tag stats hot path
    'CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_tagged ON media_metadata(composite_hash) WHERE auto_tags IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_untagged ON media_metadata(composite_hash) WHERE auto_tags IS NULL',
    `CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_root_rating
      ON media_metadata(
        json_extract(auto_tags, '$.rating.general'),
        json_extract(auto_tags, '$.rating.sensitive'),
        json_extract(auto_tags, '$.rating.questionable'),
        json_extract(auto_tags, '$.rating.explicit')
      )
      WHERE json_type(auto_tags, '$.rating') = 'object'`,
    `CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_root_character
      ON media_metadata(composite_hash)
      WHERE json_type(auto_tags, '$.character') = 'object'`,
    `CREATE INDEX IF NOT EXISTS idx_auto_tag_stats_root_model
      ON media_metadata(json_extract(auto_tags, '$.model'))
      WHERE json_extract(auto_tags, '$.model') IS NOT NULL`,
    // Home feed visibility count covering index.
    // composite_hash is part of the index on purpose: media_metadata is a rowid table,
    // so without it the EXISTS(image_files) correlation drops back to the wide row.
    `CREATE INDEX IF NOT EXISTS idx_media_metadata_visibility
      ON media_metadata(rating_score, postprocess_status, composite_hash)`,
    // Auto-tag pending work set. Partial + leading with the state column so an idle
    // poll is an index SEARCH over an almost always empty set.
    `CREATE INDEX IF NOT EXISTS idx_media_metadata_auto_tag_pending
      ON media_metadata(auto_tag_state, composite_hash)
      WHERE auto_tag_state = 'pending'`,
    'CREATE INDEX IF NOT EXISTS idx_metadata_character_prompt_text ON media_metadata(character_prompt_text)',
    // Home feed keyset cursor
    'CREATE INDEX IF NOT EXISTS idx_metadata_first_seen_hash_desc ON media_metadata(first_seen_date DESC, composite_hash DESC)',
    promptSimilarityCandidateIndex('idx_prompt_similarity_pos_candidates', 'pos_prompt_fingerprint'),
    promptSimilarityCandidateIndex('idx_prompt_similarity_neg_candidates', 'neg_prompt_fingerprint'),
    promptSimilarityCandidateIndex('idx_prompt_similarity_auto_candidates', 'auto_prompt_fingerprint'),
  ]);

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_auto_tag_index (
      composite_hash TEXT NOT NULL,
      tag_type TEXT NOT NULL CHECK (tag_type IN ('general', 'character', 'model')),
      source_path TEXT NOT NULL,
      tag_key TEXT NOT NULL,
      normalized_tag_key TEXT NOT NULL,
      search_key TEXT NOT NULL,
      score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (composite_hash, tag_type, source_path, search_key),
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_auto_tag_lookup
    ON media_auto_tag_index(tag_type, search_key, score, composite_hash)
  `);

  // ============================================
  // 5. 폴더 스캔 / 파일 / 백업 소스
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      auto_scan INTEGER DEFAULT 0,
      scan_interval INTEGER DEFAULT 60,
      recursive INTEGER DEFAULT 1,
      exclude_patterns TEXT,
      exclude_extensions TEXT,
      watcher_enabled INTEGER DEFAULT 0,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event DATETIME,
      is_active INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      last_scan_date DATETIME,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- NULL = 네이티브 이벤트 감시. 값이 있으면 chokidar 폴링(파일마다 stat 타이머)이라 비싸다.
      watcher_polling_interval INTEGER DEFAULT NULL
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
      background_attempt_count INTEGER NOT NULL DEFAULT 0,
      background_next_retry_at DATETIME DEFAULT NULL,
      background_last_error TEXT DEFAULT NULL,
      FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE,
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE SET NULL
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_metadata_edit_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite_hash TEXT NOT NULL,
      image_file_id INTEGER,
      previous_file_path TEXT NOT NULL,
      replacement_file_path TEXT NOT NULL,
      recycle_bin_path TEXT NOT NULL,
      previous_metadata_json TEXT,
      next_metadata_json TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      restored_date DATETIME,
      FOREIGN KEY (image_file_id) REFERENCES image_files(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL UNIQUE,
      display_name TEXT,
      target_folder_name TEXT NOT NULL,
      recursive INTEGER DEFAULT 1,
      watcher_enabled INTEGER DEFAULT 1,
      watcher_polling_interval INTEGER DEFAULT NULL,
      import_mode TEXT DEFAULT 'copy_original',
      webp_quality INTEGER DEFAULT 90,
      is_active INTEGER DEFAULT 1,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event DATETIME,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  execAll(db, [
    'CREATE INDEX IF NOT EXISTS idx_folders_active ON watched_folders(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_folders_auto_scan ON watched_folders(auto_scan)',
    'CREATE INDEX IF NOT EXISTS idx_files_composite_hash ON image_files(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_files_file_type ON image_files(file_type)',
    'CREATE INDEX IF NOT EXISTS idx_files_folder_id ON image_files(folder_id)',
    // Partial index for active files (optimized for common queries)
    "CREATE INDEX IF NOT EXISTS idx_files_status ON image_files(file_status) WHERE file_status = 'active'",
    'CREATE INDEX IF NOT EXISTS idx_files_scan_date ON image_files(scan_date)',
    'CREATE INDEX IF NOT EXISTS idx_files_folder_status ON image_files(folder_id, file_status)',
    'CREATE INDEX IF NOT EXISTS idx_files_hash_folder ON image_files(composite_hash, folder_id)',
    "CREATE INDEX IF NOT EXISTS idx_files_composite_status ON image_files(composite_hash, file_status) WHERE file_status = 'active'",
    'CREATE INDEX IF NOT EXISTS idx_files_scan_date_desc ON image_files(scan_date DESC)',
    `CREATE INDEX IF NOT EXISTS idx_files_background_retry
      ON image_files(background_next_retry_at, scan_date)
      WHERE composite_hash IS NULL AND file_status = 'active'`,
    // Image detail: newest verified active file per hash
    'CREATE INDEX IF NOT EXISTS idx_image_files_hash_status_verified ON image_files(composite_hash, file_status, last_verified_date DESC, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_folder_id ON scan_logs(folder_id)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_scan_date ON scan_logs(scan_date)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_status ON scan_logs(scan_status)',
    'CREATE INDEX IF NOT EXISTS idx_image_metadata_edit_revisions_hash ON image_metadata_edit_revisions(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_image_metadata_edit_revisions_created ON image_metadata_edit_revisions(created_date DESC)',
    'CREATE INDEX IF NOT EXISTS idx_image_metadata_edit_revisions_restored ON image_metadata_edit_revisions(restored_date)',
    'CREATE INDEX IF NOT EXISTS idx_backup_sources_active ON backup_sources(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_backup_sources_watcher_enabled ON backup_sources(watcher_enabled)',
  ]);

  // 기본 업로드 폴더 등록
  // runtimePaths 기본 해석과 동일한 우선순위로 계산 (runtimePaths 직접 의존은 피함)
  // 1) RUNTIME_UPLOADS_DIR
  // 2) RUNTIME_BASE_PATH/uploads
  // 3) PORTABLE_EXECUTABLE_DIR/user/uploads
  // 4) CWD 기준 user/uploads (backend/dist 실행 시 한 단계 상위 루트 사용)
  const cleanEnvPath = (value: string | undefined): string | null => {
    if (!value) {
      return null;
    }

    const cleaned = value.trim().split('#')[0].trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  const explicitUploadsDir = cleanEnvPath(process.env.RUNTIME_UPLOADS_DIR);
  const explicitBasePath = cleanEnvPath(process.env.RUNTIME_BASE_PATH);
  const portableExecutableDir = cleanEnvPath(process.env.PORTABLE_EXECUTABLE_DIR);

  const resolvedBasePath = (() => {
    if (explicitBasePath) {
      return resolveMigrationEnvConfiguredPath(explicitBasePath, __dirname);
    }

    if (portableExecutableDir) {
      return path.resolve(portableExecutableDir, 'user');
    }

    const currentCwd = process.cwd();
    const cwdBasename = path.basename(currentCwd);
    if (cwdBasename === 'backend' || cwdBasename === 'dist') {
      return path.resolve(currentCwd, '..', 'user');
    }

    return path.resolve(resolveMigrationEnvBaseDir(__dirname), 'user');
  })();

  const defaultUploadPath = explicitUploadsDir
    ? resolveMigrationEnvConfiguredPath(explicitUploadsDir, __dirname)
    : path.join(resolvedBasePath, 'uploads');

  db.prepare(`
    INSERT OR IGNORE INTO watched_folders
    (folder_path, folder_name, auto_scan, scan_interval, recursive, is_active, watcher_enabled, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(defaultUploadPath, 'Upload', 1, 60, 1, 1, 1, 1);

  // ============================================
  // 6. 자동 태그 대기 상태
  // ============================================
  // image_files 트리거가 있으므로 image_files 생성 이후여야 한다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_tag_state_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tagger_enabled INTEGER DEFAULT NULL,
      kaloscope_enabled INTEGER DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // NULL capabilities on purpose: AutoTagStateService.syncCapabilityState() sees the
  // unsynced marker on the first scheduler use and completes the capability-aware pass.
  db.prepare(`
    INSERT OR IGNORE INTO auto_tag_state_meta (id, tagger_enabled, kaloscope_enabled)
    VALUES (1, NULL, NULL)
  `).run();

  db.exec(`
    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_insert;
    CREATE TRIGGER trg_media_metadata_auto_tag_state_insert
    AFTER INSERT ON media_metadata
    WHEN NEW.auto_tag_state IS NOT 'pending' AND ${needsAutoTagWorkSql('NEW.auto_tags')}
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash;
    END;

    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_promote;
    CREATE TRIGGER trg_media_metadata_auto_tag_state_promote
    AFTER UPDATE OF auto_tags ON media_metadata
    WHEN NEW.auto_tag_state IS NOT 'pending' AND ${needsAutoTagWorkSql('NEW.auto_tags')}
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash;
    END;

    DROP TRIGGER IF EXISTS trg_media_metadata_auto_tag_state_settle;
    CREATE TRIGGER trg_media_metadata_auto_tag_state_settle
    AFTER UPDATE OF auto_tags ON media_metadata
    WHEN NEW.auto_tag_state = 'pending' AND NOT ${needsAutoTagWorkSql('NEW.auto_tags')}
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'done'
      WHERE composite_hash = NEW.composite_hash;
    END;

    DROP TRIGGER IF EXISTS trg_image_files_auto_tag_state_insert;
    CREATE TRIGGER trg_image_files_auto_tag_state_insert
    AFTER INSERT ON image_files
    WHEN NEW.composite_hash IS NOT NULL
      AND NEW.file_status = 'active'
      AND NEW.original_file_path IS NOT NULL
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash
        AND auto_tag_state IS NOT 'pending'
        AND ${needsAutoTagWorkSql('auto_tags')};
    END;

    DROP TRIGGER IF EXISTS trg_image_files_auto_tag_state_link;
    CREATE TRIGGER trg_image_files_auto_tag_state_link
    AFTER UPDATE OF composite_hash, file_status, original_file_path ON image_files
    WHEN NEW.composite_hash IS NOT NULL
      AND NEW.file_status = 'active'
      AND NEW.original_file_path IS NOT NULL
      AND (
        OLD.composite_hash IS NOT NEW.composite_hash
        OR OLD.file_status IS NOT NEW.file_status
        OR OLD.original_file_path IS NOT NEW.original_file_path
      )
    BEGIN
      UPDATE media_metadata
      SET auto_tag_state = 'pending'
      WHERE composite_hash = NEW.composite_hash
        AND auto_tag_state IS NOT 'pending'
        AND ${needsAutoTagWorkSql('auto_tags')};
    END;
  `);

  // ============================================
  // 7. 프롬프트 검색 FTS5 인덱스
  // ============================================
  // 상태는 'pending' / last_rowid = 0 으로 시작한다. 'ready' 로 시드하면 트리거가 처음부터
  // 살아나고, 시드 행을 빼면 게이트의 EXISTS 가 영원히 false 라 백필 잡이 인덱스를 못 채운다.
  // 첫 프롬프트 검색이 `media-prompt-index` 잡을 요청하고, 빈 테이블은 한 배치에서 끝나며
  // markReady() 가 인덱스를 살린다. 그 전까지 검색은 LIKE 경로로 정확히 동작한다.
  // 백필은 여기 없다. 인덱싱은 전적으로 런타임 잡의 몫이다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_prompt_fts_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'pending',
      last_rowid INTEGER NOT NULL DEFAULT 0,
      indexed_rows INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`
    INSERT OR IGNORE INTO media_prompt_fts_state (id, status, last_rowid, indexed_rows)
    VALUES (1, 'pending', 0, 0)
  `).run();

  // FTS5 + trigram 이 없는 SQLite 빌드에서도 신규 DB 생성 자체는 성공해야 한다.
  // 그 경우 상태를 'disabled' 로 내리고 검색은 LIKE 경로에 머문다.
  let promptFtsAvailable = true;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS media_prompt_fts USING fts5(
        positive_text,
        negative_text,
        content='media_metadata',
        content_rowid='rowid',
        tokenize='trigram'
      );
    `);
  } catch (error) {
    promptFtsAvailable = false;
    db.prepare(`
      UPDATE media_prompt_fts_state
      SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();
    console.warn(
      '  ⚠️  FTS5 trigram 인덱스를 사용할 수 없어 프롬프트 검색은 LIKE 경로를 유지합니다:',
      error instanceof Error ? error.message : error
    );
  }

  if (promptFtsAvailable) {
    db.exec(`
      DROP TRIGGER IF EXISTS trg_media_prompt_fts_insert;
      DROP TRIGGER IF EXISTS trg_media_prompt_fts_delete;
      DROP TRIGGER IF EXISTS trg_media_prompt_fts_update;

      CREATE TRIGGER trg_media_prompt_fts_insert
      AFTER INSERT ON media_metadata
      BEGIN
        INSERT INTO media_prompt_fts(rowid, positive_text, negative_text)
        SELECT NEW.rowid, ${positiveTextSql('NEW')}, ${negativeTextSql('NEW')}
        WHERE ${syncGateSql('NEW.rowid')};
      END;

      CREATE TRIGGER trg_media_prompt_fts_delete
      AFTER DELETE ON media_metadata
      BEGIN
        INSERT INTO media_prompt_fts(media_prompt_fts, rowid, positive_text, negative_text)
        SELECT 'delete', OLD.rowid, ${positiveTextSql('OLD')}, ${negativeTextSql('OLD')}
        WHERE ${syncGateSql('OLD.rowid')};
      END;

      CREATE TRIGGER trg_media_prompt_fts_update
      AFTER UPDATE OF prompt, negative_prompt, character_prompt_text, raw_nai_parameters ON media_metadata
      BEGIN
        INSERT INTO media_prompt_fts(media_prompt_fts, rowid, positive_text, negative_text)
        SELECT 'delete', OLD.rowid, ${positiveTextSql('OLD')}, ${negativeTextSql('OLD')}
        WHERE ${syncGateSql('OLD.rowid')};

        INSERT INTO media_prompt_fts(rowid, positive_text, negative_text)
        SELECT NEW.rowid, ${positiveTextSql('NEW')}, ${negativeTextSql('NEW')}
        WHERE ${syncGateSql('NEW.rowid')};
      END;
    `);
  }

  // ============================================
  // 8. Civitai 모델 정보
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_hash TEXT UNIQUE NOT NULL,
      model_name TEXT,
      model_version_id TEXT,
      civitai_model_id INTEGER,
      model_type TEXT,
      civitai_data TEXT,
      thumbnail_path TEXT,
      last_checked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite_hash TEXT NOT NULL,
      model_hash TEXT NOT NULL,
      model_role TEXT NOT NULL,
      weight REAL,
      civitai_checked INTEGER DEFAULT 0,
      civitai_failed INTEGER DEFAULT 0,
      checked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
      UNIQUE(composite_hash, model_hash, model_role)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS civitai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      -- 기본: 비활성화 (API 키 설정 전까지)
      enabled INTEGER DEFAULT 0,
      api_call_interval INTEGER DEFAULT 2,
      total_lookups INTEGER DEFAULT 0,
      successful_lookups INTEGER DEFAULT 0,
      failed_lookups INTEGER DEFAULT 0,
      last_api_call DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  execAll(db, [
    'CREATE INDEX IF NOT EXISTS idx_model_hash ON model_info(model_hash)',
    'CREATE INDEX IF NOT EXISTS idx_model_version ON model_info(model_version_id)',
    'CREATE INDEX IF NOT EXISTS idx_civitai_model ON model_info(civitai_model_id)',
    'CREATE INDEX IF NOT EXISTS idx_model_type ON model_info(model_type)',
    'CREATE INDEX IF NOT EXISTS idx_image_models_composite ON image_models(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_image_models_hash ON image_models(model_hash)',
    'CREATE INDEX IF NOT EXISTS idx_image_models_unchecked ON image_models(civitai_checked, civitai_failed)',
  ]);

  db.exec(`INSERT OR IGNORE INTO civitai_settings (id) VALUES (1)`);

  // ============================================
  // 9. 시스템 설정 / 파일 검증 로그
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value, description)
    VALUES (?, ?, ?)
  `).run('phase2_interval', '5', 'Phase 2 백그라운드 해시 생성 간격 (분)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_verification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verification_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total_checked INTEGER DEFAULT 0,
      missing_found INTEGER DEFAULT 0,
      deleted_records INTEGER DEFAULT 0,
      duration_ms INTEGER,
      verification_type TEXT DEFAULT 'manual',
      error_count INTEGER DEFAULT 0,
      error_details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_verification_logs_date
    ON file_verification_logs(verification_date DESC)
  `);

  // ============================================
  // 10. graph_execution_node_io (예전 021 이 images.db 에 만든 테이블)
  // ============================================
  // 런타임은 user.db 의 같은 이름 테이블만 쓴다(GraphExecutionNodeIoModel). 여기 사본은 쓰이지 않고
  // FK 대상 graph_executions 도 images.db 에 없다. 기존 DB 와 스키마를 똑같이 맞추려고 남겨 둔다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_execution_node_io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('input', 'output')),
      port_key TEXT NOT NULL,
      source_node_id TEXT,
      source_port_key TEXT,
      output_index INTEGER NOT NULL DEFAULT 1,
      artifact_type TEXT,
      ref_kind TEXT,
      ref_value TEXT,
      summary TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (execution_id) REFERENCES graph_executions(id) ON DELETE CASCADE
    )
  `);

  execAll(db, [
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_node_io_execution_node ON graph_execution_node_io(execution_id, node_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_execution_node_io_execution_direction ON graph_execution_node_io(execution_id, direction)',
  ]);

  console.log('🎉 Baseline 마이그레이션 완료');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Baseline 마이그레이션 롤백 시작...');

  // 프롬프트 검색 FTS5 인덱스는 media_metadata 를 external content 로 참조하므로 먼저 제거한다.
  // (media_metadata 를 DROP 하면 그 위의 트리거는 SQLite 가 함께 제거한다.)
  db.exec(`
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_insert;
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_delete;
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_update;
  `);

  // 자식 테이블부터 제거한다.
  const tables = [
    'graph_execution_node_io',
    'file_verification_logs',
    'system_settings',
    'civitai_settings',
    'image_models',
    'model_info',
    'media_prompt_fts',
    'media_prompt_fts_state',
    'auto_tag_state_meta',
    'backup_sources',
    'image_metadata_edit_revisions',
    'scan_logs',
    'image_files',
    'watched_folders',
    'media_auto_tag_index',
    'auto_folder_group_images',
    'auto_folder_groups',
    'image_groups',
    'groups',
    'rating_tiers',
    'rating_weights',
    'auto_prompt_groups',
    'auto_prompt_collection',
    'negative_prompt_groups',
    'prompt_groups',
    'negative_prompt_collection',
    'prompt_collection',
    'media_metadata'
  ];

  tables.forEach(table => {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  });

  console.log('✅ Baseline 마이그레이션 롤백 완료');
};

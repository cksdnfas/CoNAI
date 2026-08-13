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
// Mirrored SQL fragments (migrations 028 / 031)
//
// 이 파일은 "신규 DB 생성" 경로, 028/031 은 "기존 DB 업그레이드" 경로다. 두 경로가
// 같은 스키마를 만들어야 하므로 상태 테이블/부분 인덱스/트리거를 여기에도 미러링한다.
// 아래 표현식은 028/031 과 문자 단위로 동일해야 한다 (FTS5 external-content 인덱스는
// 삽입 때와 삭제 때의 텍스트가 1바이트라도 다르면 조용히 손상된다).
// `verify:db-migration-contracts` 가 이 파일과 028/031 의 사본을 비교한다.
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

/**
 * 통합 마이그레이션: 모든 필수 테이블 생성
 * - 프롬프트 관리 (prompt_collection, negative_prompt_collection, prompt_groups, negative_prompt_groups)
 * - 그룹 관리 (groups, image_groups)
 * - 평가 시스템 (rating_weights, rating_tiers)
 * - 미디어 메타데이터 (media_metadata, image_files)
 * - 폴더 관리 (watched_folders, scan_logs)
 * - 자동 태그 상태 / 프롬프트 검색 인덱스 (auto_tag_state_meta, media_prompt_fts*)
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

  promptIndexes.forEach(sql => {
    db.exec(sql);
  });

  // Pre-create LoRA groups to avoid race conditions during prompt collection
  db.prepare(`INSERT OR IGNORE INTO prompt_groups (group_name, display_order, is_visible)
    VALUES (?, ?, ?)`).run('LoRA', 999, 1);
  db.prepare(`INSERT OR IGNORE INTO negative_prompt_groups (group_name, display_order, is_visible)
    VALUES (?, ?, ?)`).run('LoRA', 999, 1);

  console.log('  ✅ 프롬프트 테이블 4개 + 인덱스 + LoRA 그룹 생성 완료\n');

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
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
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

  groupIndexes.forEach(sql => {
    db.exec(sql);
  });

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
      feed_visibility VARCHAR(10) NOT NULL DEFAULT 'show',
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
    { tier_name: 'G', min_score: 0, max_score: 2, tier_order: 1, color: '#22c55e', feed_visibility: 'show' },
    { tier_name: 'Teen', min_score: 2, max_score: 6, tier_order: 2, color: '#3b82f6', feed_visibility: 'show' },
    { tier_name: 'SFW', min_score: 6, max_score: 15, tier_order: 3, color: '#f59e0b', feed_visibility: 'show' },
    { tier_name: 'NSFW', min_score: 15, max_score: null, tier_order: 4, color: '#ef4444', feed_visibility: 'show' }
  ];

  const insertTier = db.prepare(`
    INSERT OR IGNORE INTO rating_tiers (tier_name, min_score, max_score, tier_order, color, feed_visibility)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  defaultTiers.forEach(tier => {
    insertTier.run(tier.tier_name, tier.min_score, tier.max_score, tier.tier_order, tier.color, tier.feed_visibility);
  });

  console.log('  ✅ 평가 테이블 2개 + 기본 데이터 생성 완료\n');

  // ============================================
  // 4. 미디어 메타데이터 시스템
  // ============================================
  console.log('🖼️  미디어 메타데이터 테이블 생성 중...');

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
      -- NovelAI 원본 생성 파라미터 (마이그레이션 009). 아래 031 미러 트리거가 읽는다.
      raw_nai_parameters TEXT DEFAULT NULL,
      -- NAI v4 캐릭터 캡션 평문 (마이그레이션 010). 아래 031 미러 트리거가 읽는다.
      character_prompt_text TEXT DEFAULT NULL,
      -- 자동 태그 스케줄러 작업 상태 (마이그레이션 028): 'pending' | 'done' | 'skip' | NULL
      auto_tag_state TEXT DEFAULT NULL
    )
  `);

  // 미디어 메타데이터 인덱스
  const metadataIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_metadata_phash ON media_metadata(perceptual_hash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_dhash ON media_metadata(dhash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_ahash ON media_metadata(ahash)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_ai_tool ON media_metadata(ai_tool)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_model ON media_metadata(model_name)',
    'CREATE INDEX IF NOT EXISTS idx_metadata_first_seen ON media_metadata(first_seen_date)',
    // Performance index for composite hash lookup (from migration 002)
    'CREATE INDEX IF NOT EXISTS idx_metadata_composite_lookup ON media_metadata(composite_hash, perceptual_hash, dhash, ahash)',
    // Thumbnail loading index for chronological queries (from migration 005)
    'CREATE INDEX IF NOT EXISTS idx_metadata_first_seen_desc ON media_metadata(first_seen_date DESC)',
    // Hide media that is still in immediate post-processing
    'CREATE INDEX IF NOT EXISTS idx_metadata_postprocess_status ON media_metadata(postprocess_status)',
    // Auto-tag stats hot path (from migration 025)
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
    // Home feed visibility count covering index (from migration 027).
    // composite_hash is part of the index on purpose: media_metadata is a rowid table,
    // so without it the EXISTS(image_files) correlation drops back to the wide row.
    `CREATE INDEX IF NOT EXISTS idx_media_metadata_visibility
      ON media_metadata(rating_score, postprocess_status, composite_hash)`,
    // Auto-tag pending work set (from migration 028). Partial + leading with the state
    // column so an idle poll is an index SEARCH over an almost always empty set.
    `CREATE INDEX IF NOT EXISTS idx_media_metadata_auto_tag_pending
      ON media_metadata(auto_tag_state, composite_hash)
      WHERE auto_tag_state = 'pending'`
  ];

  metadataIndexes.forEach(sql => {
    db.exec(sql);
  });
  console.log('  ✅ 미디어 메타데이터 테이블 + 인덱스 생성 완료\n');

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
  // 5. 폴더 스캔 시스템
  // ============================================
  console.log('📂 폴더 스캔 테이블 생성 중...');

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

  // 폴더 시스템 인덱스
  const folderIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_folders_active ON watched_folders(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_folders_auto_scan ON watched_folders(auto_scan)',
    'CREATE INDEX IF NOT EXISTS idx_files_composite_hash ON image_files(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_files_file_type ON image_files(file_type)',
    'CREATE INDEX IF NOT EXISTS idx_files_folder_id ON image_files(folder_id)',
    // Partial index for active files (optimized for common queries)
    "CREATE INDEX IF NOT EXISTS idx_files_status ON image_files(file_status) WHERE file_status = 'active'",
    'CREATE INDEX IF NOT EXISTS idx_files_scan_date ON image_files(scan_date)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_folder_id ON scan_logs(folder_id)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_scan_date ON scan_logs(scan_date)',
    'CREATE INDEX IF NOT EXISTS idx_scan_logs_status ON scan_logs(scan_status)',
    // Performance indexes (from migration 002)
    'CREATE INDEX IF NOT EXISTS idx_files_folder_status ON image_files(folder_id, file_status)',
    'CREATE INDEX IF NOT EXISTS idx_files_hash_folder ON image_files(composite_hash, folder_id)',
    // Thumbnail loading indexes (from migration 005)
    "CREATE INDEX IF NOT EXISTS idx_files_composite_status ON image_files(composite_hash, file_status) WHERE file_status = 'active'",
    'CREATE INDEX IF NOT EXISTS idx_files_scan_date_desc ON image_files(scan_date DESC)',
    `CREATE INDEX IF NOT EXISTS idx_files_background_retry
      ON image_files(background_next_retry_at, scan_date)
      WHERE composite_hash IS NULL AND file_status = 'active'`
  ];

  folderIndexes.forEach(sql => {
    db.exec(sql);
  });

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

  console.log('  ✅ 폴더 테이블 3개 + 인덱스 + 기본 폴더 1개 생성 완료\n');

  // ============================================
  // 5-1. 자동 태그 대기 상태 (마이그레이션 028 미러)
  // ============================================
  // image_files 트리거가 있으므로 image_files 생성 이후여야 한다.
  // 028의 백필(UPDATE ... SET auto_tag_state = 'pending')은 옮기지 않는다: 신규 DB에는
  // 대상 행이 없고, 000이 (migrations 레코드가 사라진) 기존 DB에 대해 실행되는 경우에도
  // 028이 바로 뒤에 실행되며 백필을 직접 수행한다.
  console.log('🏷️  자동 태그 대기 상태 테이블/트리거 생성 중...');

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

  console.log('  ✅ auto_tag_state_meta + 상태 유지 트리거 5개 생성 완료\n');

  // ============================================
  // 5-2. 프롬프트 검색 FTS5 인덱스 (마이그레이션 031 미러)
  // ============================================
  // 상태는 반드시 'pending' / last_rowid = 0 으로 시작한다 (031과 동일).
  //  - 'ready' 로 시드하면 트리거가 처음부터 살아난다. 정말로 빈 DB라면 무해하지만,
  //    000은 전부 `IF NOT EXISTS` 라서 (migrations 레코드가 유실된 DB 등) 이미 행이 있는
  //    media_metadata 위에서도 실행될 수 있다. 그 경우 인덱스에 넣은 적 없는 rowid 에
  //    대해 FTS5 'delete' 명령이 나가고 external-content 인덱스가 조용히 손상된다.
  //  - 시드 행 자체를 빼면 반대로 게이트의 EXISTS 가 영원히 false 이고, 백필 잡은
  //    status='absent' 를 보고 경고만 남긴 채 종료한다 → 인덱스가 영영 안 채워진다.
  //  - 'pending' 은 두 경우 모두에서 안전하고, 신규 설치에서 손해도 없다. 첫 프롬프트
  //    검색이 `media-prompt-index` 잡을 요청하고, 빈 테이블은 한 배치에서 끝나며
  //    markReady() 가 인덱스를 살린다. 그 전까지 검색은 원래의 LIKE 경로로 정확히 동작한다.
  // 백필은 여기에도 031에도 없다. 인덱싱은 전적으로 런타임 잡의 몫이다.
  console.log('🔎 프롬프트 검색 FTS5 인덱스 생성 중...');

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
    console.log('  ✅ media_prompt_fts + 상태 테이블 + 동기화 트리거 3개 생성 완료 (백필은 런타임 잡)\n');
  }

  // ============================================
  // 6. 시스템 설정
  // ============================================
  console.log('⚙️  시스템 설정 테이블 생성 중...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 기본 설정값 삽입
  db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value, description)
    VALUES (?, ?, ?)
  `).run('phase2_interval', '5', 'Phase 2 백그라운드 해시 생성 간격 (분)');

  console.log('  ✅ 시스템 설정 테이블 + 기본값 생성 완료\n');

  // ============================================
  // 7. 파일 검증 로그 시스템
  // ============================================
  console.log('🔍 파일 검증 로그 테이블 생성 중...');

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

  // 검증 날짜 인덱스 (로그 조회 성능 향상)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_verification_logs_date
    ON file_verification_logs(verification_date DESC)
  `);

  console.log('  ✅ 파일 검증 로그 테이블 + 인덱스 생성 완료\n');

  // ============================================
  // 8. API 생성 히스토리 (apiGenerationDb.ts에서 관리)
  // ============================================
  // Note: generation_history 테이블은 별도 DB에서 관리됨

  console.log('🎉 통합 마이그레이션 완료!');
  console.log('📊 생성된 테이블 요약:');
  console.log('   - 프롬프트: 4개 테이블');
  console.log('   - 그룹: 2개 테이블');
  console.log('   - 평가: 2개 테이블');
  console.log('   - 미디어 메타데이터: 1개 테이블');
  console.log('   - 폴더 관리: 3개 테이블');
  console.log('   - 시스템 설정: 1개 테이블');
  console.log('   - 파일 검증 로그: 1개 테이블');
  console.log('   - 자동 태그/프롬프트 검색 색인: 4개 테이블');
  console.log('   총 18개 테이블 + 인덱스 + 트리거 생성');
  console.log('   (워크플로우, 사용자 설정, API 생성 히스토리는 별도 DB)\n');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 통합 마이그레이션 롤백 시작...\n');

  // 프롬프트 검색 FTS5 인덱스는 media_metadata 를 external content 로 참조하므로 먼저 제거한다.
  // (media_metadata 를 DROP 하면 그 위의 트리거는 SQLite 가 함께 제거한다.)
  db.exec(`
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_insert;
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_delete;
    DROP TRIGGER IF EXISTS trg_media_prompt_fts_update;
  `);

  // 역순으로 테이블 제거 (images.db 테이블만)
  const tables = [
    'media_prompt_fts',
    'media_prompt_fts_state',
    'auto_tag_state_meta',
    'file_verification_logs',
    'system_settings',
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
    'media_metadata'
  ];

  tables.forEach(table => {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    console.log(`  ✅ ${table} 테이블 제거`);
  });

  console.log('\n✅ 통합 마이그레이션 롤백 완료');
};

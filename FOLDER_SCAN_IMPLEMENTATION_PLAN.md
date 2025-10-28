# 폴더 스캔 시스템 구현 계획서

## 📋 프로젝트 개요

**목표**: 사용자 PC의 폴더를 스캔하여 이미지를 관리하고, 폴더 위치 변경/파일 이동 시에도 추적 가능한 시스템 구축

**핵심 요구사항**:
1. 이미지의 지각적 고유 키 (Perceptual Hash 복합) 기반 관리
2. 폴더 위치 변경 시에도 메타데이터/썸네일 유지
3. 직접 업로드와 폴더 스캔의 통합 처리
4. 여러 폴더 등록 및 관리
5. 중복 이미지 관리 기능

---

## 🎯 시스템 아키텍처

### 핵심 개념: 2-Tier 테이블 구조

```
┌─────────────────────────────────────────────────┐
│         image_metadata (영구 보존)               │
│  - composite_hash (고유 키)                      │
│  - prompt, negative_prompt                      │
│  - model_name, lora_models                      │
│  - 썸네일 경로 (캐시)                            │
│  - AI 메타데이터                                 │
│  - 생성 일시, 수정 일시                          │
└─────────────────────────────────────────────────┘
            ▲
            │ composite_hash (FOREIGN KEY)
            │
┌─────────────────────────────────────────────────┐
│         image_files (휘발성, 재스캔 가능)         │
│  - id (PRIMARY KEY)                             │
│  - composite_hash (FK → image_metadata)         │
│  - original_file_path (실제 파일 위치)           │
│  - folder_id (FK → watched_folders)             │
│  - file_status (존재/삭제/이동)                  │
│  - file_size, mime_type                         │
│  - scan_date, last_verified                     │
└─────────────────────────────────────────────────┘
            ▲
            │ folder_id (FOREIGN KEY)
            │
┌─────────────────────────────────────────────────┐
│         watched_folders (감시 폴더 목록)         │
│  - id (PRIMARY KEY)                             │
│  - folder_path (절대 경로)                       │
│  - folder_type (upload/scan/archive)            │
│  - auto_scan (자동 스캔 여부)                    │
│  - scan_interval (스캔 주기, 분)                 │
│  - last_scan_date                               │
│  - is_active                                    │
└─────────────────────────────────────────────────┘
```

### 핵심 플로우

```
사용자 시나리오:
1. D:\Images\ 폴더 등록 → watched_folders 추가
2. 전체 스캔 실행 → 이미지 발견
3. 각 이미지:
   a. 복합 해시 생성 (pHash + dHash + aHash)
   b. image_metadata에 composite_hash 존재 확인
   c. 존재하면 → image_files에만 경로 추가
   d. 없으면 → image_metadata 생성 후 image_files 추가
4. 사용자가 폴더를 E:\MyImages\로 이동
5. 재스캔 실행:
   a. 기존 D:\Images\ 경로의 파일들 → file_status = 'missing' 업데이트
   b. E:\MyImages\ 스캔 → 같은 해시 발견
   c. image_files의 경로 업데이트
   d. image_metadata는 그대로 유지 (메타데이터 보존)
```

---

## 📊 데이터베이스 스키마 설계

### 1. image_metadata 테이블 (영구 메타데이터)

```sql
CREATE TABLE image_metadata (
  -- 고유 식별자 (복합 해시)
  composite_hash TEXT PRIMARY KEY,  -- 48자 (pHash 16 + dHash 16 + aHash 16)

  -- 지각적 해시들 (개별 접근 및 유사도 검색용)
  perceptual_hash TEXT NOT NULL,    -- pHash (16자)
  dhash TEXT NOT NULL,               -- dHash (16자)
  ahash TEXT NOT NULL,               -- aHash (16자)
  color_histogram TEXT,              -- 색상 히스토그램 (JSON)

  -- 이미지 기본 정보
  width INTEGER,
  height INTEGER,

  -- 썸네일 및 최적화 이미지 (캐시 폴더 경로)
  thumbnail_path TEXT,               -- uploads/temp/YYYY-MM-DD/{hash}-thumb.jpg
  optimized_path TEXT,               -- uploads/temp/YYYY-MM-DD/{hash}-optimized.webp

  -- AI 생성 메타데이터
  ai_tool TEXT,                      -- ComfyUI, NovelAI, SD 등
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
  auto_tags TEXT,                    -- JSON array

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
);

-- 인덱스
CREATE INDEX idx_metadata_phash ON image_metadata(perceptual_hash);
CREATE INDEX idx_metadata_dhash ON image_metadata(dhash);
CREATE INDEX idx_metadata_ahash ON image_metadata(ahash);
CREATE INDEX idx_metadata_ai_tool ON image_metadata(ai_tool);
CREATE INDEX idx_metadata_model ON image_metadata(model_name);
CREATE INDEX idx_metadata_first_seen ON image_metadata(first_seen_date);
```

### 2. image_files 테이블 (파일 위치 추적)

```sql
CREATE TABLE image_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 메타데이터 참조
  composite_hash TEXT NOT NULL,

  -- 파일 위치 정보
  original_file_path TEXT NOT NULL,  -- 절대 경로
  folder_id INTEGER NOT NULL,        -- 소속 폴더

  -- 파일 상태
  file_status TEXT NOT NULL DEFAULT 'active',  -- active/missing/deleted
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  file_modified_date DATETIME,       -- 파일 시스템의 수정 일시

  -- 스캔 정보
  scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_verified_date DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (composite_hash) REFERENCES image_metadata(composite_hash) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE,
  UNIQUE(original_file_path)
);

-- 인덱스
CREATE INDEX idx_files_composite_hash ON image_files(composite_hash);
CREATE INDEX idx_files_folder_id ON image_files(folder_id);
CREATE INDEX idx_files_status ON image_files(file_status);
CREATE INDEX idx_files_scan_date ON image_files(scan_date);
CREATE INDEX idx_files_path ON image_files(original_file_path);
```

### 3. watched_folders 테이블 (감시 폴더 목록)

```sql
CREATE TABLE watched_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 폴더 정보
  folder_path TEXT NOT NULL UNIQUE,  -- 절대 경로
  folder_name TEXT,                  -- 사용자 지정 이름
  folder_type TEXT DEFAULT 'scan',   -- upload/scan/archive

  -- 스캔 설정
  auto_scan BOOLEAN DEFAULT 0,       -- 자동 스캔 여부
  scan_interval INTEGER DEFAULT 60,  -- 스캔 주기 (분)
  recursive BOOLEAN DEFAULT 1,       -- 하위 폴더 포함 여부

  -- 필터 설정 (JSON)
  file_extensions TEXT,              -- ["jpg", "png", "webp"] 등
  exclude_patterns TEXT,             -- [".thumbnails", "_cache"] 등

  -- 상태
  is_active BOOLEAN DEFAULT 1,
  last_scan_date DATETIME,
  last_scan_status TEXT,             -- success/error/in_progress
  last_scan_found INTEGER DEFAULT 0, -- 마지막 스캔에서 발견한 파일 수
  last_scan_error TEXT,

  -- 타임스탬프
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_folders_type ON watched_folders(folder_type);
CREATE INDEX idx_folders_active ON watched_folders(is_active);
CREATE INDEX idx_folders_auto_scan ON watched_folders(auto_scan);
```

### 4. 기존 테이블과의 관계

```sql
-- groups, image_groups 테이블은 image_files.id를 참조하도록 수정
ALTER TABLE image_groups ADD COLUMN file_id INTEGER;
ALTER TABLE image_groups ADD FOREIGN KEY (file_id) REFERENCES image_files(id) ON DELETE CASCADE;

-- 기존 image_id는 마이그레이션 후 제거 예정
-- 단계적 마이그레이션:
-- 1단계: file_id 추가 및 데이터 매핑
-- 2단계: image_id 제거
```

---

## 🔧 핵심 기능 구현

### Phase 1: 해시 시스템 확장 (dHash, aHash 추가)

#### 1.1 dHash (Difference Hash) 구현

**파일**: `backend/src/services/imageSimilarity.ts`

```typescript
/**
 * Difference Hash (dHash) 생성
 * 9x8 그리드에서 수평 그래디언트 계산
 */
static async generateDHash(imagePath: string): Promise<string> {
  try {
    // 9x8 크기로 리사이즈 (수평 차이를 위해 가로 1픽셀 더 필요)
    const { data } = await sharp(imagePath)
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (data.length !== 72) {
      throw new Error(`Unexpected pixel data length: ${data.length}`);
    }

    // 각 행에서 좌->우 비교하여 비트 생성
    let hash = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const leftPixel = data[row * 9 + col];
        const rightPixel = data[row * 9 + col + 1];
        hash += leftPixel < rightPixel ? '1' : '0';
      }
    }

    return this.binaryToHex(hash);
  } catch (error) {
    console.error('Failed to generate dHash:', error);
    throw new Error(`dHash generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
```

#### 1.2 aHash (Average Hash) 구현

```typescript
/**
 * Average Hash (aHash) 생성
 * 8x8 그레이스케일의 평균값 기반
 */
static async generateAHash(imagePath: string): Promise<string> {
  try {
    const { data } = await sharp(imagePath)
      .resize(8, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (data.length !== 64) {
      throw new Error(`Unexpected pixel data length: ${data.length}`);
    }

    // 평균값 계산
    const average = data.reduce((sum, val) => sum + val, 0) / data.length;

    // 비트 생성
    let hash = '';
    for (let i = 0; i < data.length; i++) {
      hash += data[i] > average ? '1' : '0';
    }

    return this.binaryToHex(hash);
  } catch (error) {
    console.error('Failed to generate aHash:', error);
    throw new Error(`aHash generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
```

#### 1.3 복합 해시 생성

```typescript
/**
 * 복합 해시 생성 (pHash + dHash + aHash)
 * 이미지의 고유 식별자로 사용
 */
static async generateCompositeHash(imagePath: string): Promise<{
  compositeHash: string;
  perceptualHash: string;
  dHash: string;
  aHash: string;
}> {
  const [perceptualHash, dHash, aHash] = await Promise.all([
    this.generatePerceptualHash(imagePath),
    this.generateDHash(imagePath),
    this.generateAHash(imagePath)
  ]);

  // 복합 해시: 단순 연결 (48자)
  const compositeHash = `${perceptualHash}${dHash}${aHash}`;

  return {
    compositeHash,
    perceptualHash,
    dHash,
    aHash
  };
}
```

#### 1.4 복합 해시 유사도 판별

```typescript
/**
 * 복합 해시 기반 유사도 판별
 */
static isSameImage(
  hashA: { perceptualHash: string; dHash: string; aHash: string },
  hashB: { perceptualHash: string; dHash: string; aHash: string },
  threshold: number = 5
): {
  isSame: boolean;
  confidence: number;
  details: {
    pHashDistance: number;
    dHashDistance: number;
    aHashDistance: number;
    avgDistance: number;
    consensus: number;
  };
} {
  const pDist = this.calculateHammingDistance(hashA.perceptualHash, hashB.perceptualHash);
  const dDist = this.calculateHammingDistance(hashA.dHash, hashB.dHash);
  const aDist = this.calculateHammingDistance(hashA.aHash, hashB.aHash);

  // 가중 평균 (pHash 50%, dHash 30%, aHash 20%)
  const avgDistance = pDist * 0.5 + dDist * 0.3 + aDist * 0.2;

  // 합의 기반 판정 (2개 이상 threshold 이하면 "같은 이미지")
  const consensus = [
    pDist <= threshold,
    dDist <= threshold,
    aDist <= threshold
  ].filter(v => v).length;

  const isSame = consensus >= 2 && avgDistance <= threshold;
  const confidence = isSame ? Math.max(0, 100 - (avgDistance / 64) * 100) : 0;

  return {
    isSame,
    confidence: Math.round(confidence * 100) / 100,
    details: {
      pHashDistance: pDist,
      dHashDistance: dDist,
      aHashDistance: aDist,
      avgDistance: Math.round(avgDistance * 100) / 100,
      consensus
    }
  };
}
```

---

### Phase 2: 데이터베이스 마이그레이션

#### 2.1 마이그레이션: 새 테이블 생성

**파일**: `backend/src/database/migrations/016_create_folder_scan_system.ts`

```typescript
import Database from 'better-sqlite3';

export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 016: 폴더 스캔 시스템 테이블 생성 시작...');

  // 1. image_metadata 테이블 생성
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
      optimized_path TEXT,

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
  console.log('  ✅ image_metadata 테이블 생성');

  // 2. watched_folders 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      folder_type TEXT DEFAULT 'scan',

      auto_scan BOOLEAN DEFAULT 0,
      scan_interval INTEGER DEFAULT 60,
      recursive BOOLEAN DEFAULT 1,

      file_extensions TEXT,
      exclude_patterns TEXT,

      is_active BOOLEAN DEFAULT 1,
      last_scan_date DATETIME,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,

      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✅ watched_folders 테이블 생성');

  // 3. image_files 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite_hash TEXT NOT NULL,

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

  // 테이블 제거 (역순)
  db.exec('DROP TABLE IF EXISTS image_files');
  db.exec('DROP TABLE IF EXISTS watched_folders');
  db.exec('DROP TABLE IF EXISTS image_metadata');

  console.log('✅ Migration 016 rollback: 완료');
};
```

#### 2.2 마이그레이션: 기존 데이터 이전

**파일**: `backend/src/database/migrations/017_migrate_existing_images.ts`

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import { runtimePaths } from '../../config/runtimePaths';

export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Migration 017: 기존 이미지 데이터 마이그레이션 시작...');

  // 1. 기존 images 테이블에서 데이터 조회
  const existingImages = db.prepare('SELECT * FROM images').all() as any[];
  console.log(`  📊 마이그레이션 대상: ${existingImages.length}개 이미지`);

  let migrated = 0;
  let failed = 0;
  const errors: Array<{ id: number; error: string }> = [];

  // 2. 기본 폴더 ID 조회
  const uploadFolder = db.prepare(
    'SELECT id FROM watched_folders WHERE folder_type = ?'
  ).get('upload') as { id: number } | undefined;

  if (!uploadFolder) {
    throw new Error('기본 업로드 폴더를 찾을 수 없습니다');
  }

  // 3. 각 이미지 마이그레이션
  for (const image of existingImages) {
    try {
      // 해시가 없으면 생성
      let compositeHash: string;
      let perceptualHash: string;
      let dHash: string;
      let aHash: string;

      if (image.perceptual_hash) {
        perceptualHash = image.perceptual_hash;

        // dHash, aHash 생성 필요
        const fullPath = path.join(runtimePaths.uploadsDir, image.file_path);
        const hashes = await ImageSimilarityService.generateCompositeHash(fullPath);
        compositeHash = hashes.compositeHash;
        dHash = hashes.dHash;
        aHash = hashes.aHash;
      } else {
        // 모든 해시 생성
        const fullPath = path.join(runtimePaths.uploadsDir, image.file_path);
        const hashes = await ImageSimilarityService.generateCompositeHash(fullPath);
        compositeHash = hashes.compositeHash;
        perceptualHash = hashes.perceptualHash;
        dHash = hashes.dHash;
        aHash = hashes.aHash;
      }

      // image_metadata에 삽입 (중복 체크)
      const existingMetadata = db.prepare(
        'SELECT composite_hash FROM image_metadata WHERE composite_hash = ?'
      ).get(compositeHash);

      if (!existingMetadata) {
        db.prepare(`
          INSERT INTO image_metadata (
            composite_hash, perceptual_hash, dhash, ahash, color_histogram,
            width, height, thumbnail_path, optimized_path,
            ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
            prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
            auto_tags, duration, fps, video_codec, audio_codec, bitrate, rating_score,
            first_seen_date, metadata_updated_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          compositeHash, perceptualHash, dHash, aHash, image.color_histogram,
          image.width, image.height, image.thumbnail_path, image.optimized_path,
          image.ai_tool, image.model_name, image.lora_models, image.steps, image.cfg_scale,
          image.sampler, image.seed, image.scheduler, image.prompt, image.negative_prompt,
          image.denoise_strength, image.generation_time, image.batch_size, image.batch_index,
          image.auto_tags, image.duration, image.fps, image.video_codec, image.audio_codec,
          image.bitrate, image.rating_score || 0, image.upload_date, image.upload_date
        );
      }

      // image_files에 삽입
      const fullPath = path.join(runtimePaths.uploadsDir, image.file_path);
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date,
          scan_date, last_verified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        compositeHash, fullPath, uploadFolder.id,
        'active', image.file_size, image.mime_type, image.upload_date,
        image.upload_date, new Date().toISOString()
      );

      migrated++;
      if (migrated % 100 === 0) {
        console.log(`  📊 진행 상황: ${migrated}/${existingImages.length}`);
      }
    } catch (error) {
      failed++;
      errors.push({
        id: image.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      console.error(`  ❌ 이미지 ${image.id} 마이그레이션 실패:`, error);
    }
  }

  console.log(`✅ Migration 017: 마이그레이션 완료`);
  console.log(`  ✅ 성공: ${migrated}개`);
  console.log(`  ❌ 실패: ${failed}개`);

  if (errors.length > 0) {
    console.log(`  ⚠️  실패 상세:`, errors.slice(0, 10));
  }
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Migration 017 rollback: 마이그레이션 데이터 제거...');

  // image_files, image_metadata 데이터 제거
  db.exec('DELETE FROM image_files');
  db.exec('DELETE FROM image_metadata WHERE composite_hash NOT IN (SELECT composite_hash FROM image_files)');

  console.log('✅ Migration 017 rollback: 완료');
};
```

---

### Phase 3: 폴더 스캔 서비스 구현

#### 3.1 WatchedFolderService (폴더 관리)

**파일**: `backend/src/services/watchedFolderService.ts`

```typescript
import { db } from '../database/init';
import path from 'path';
import fs from 'fs';

export interface WatchedFolder {
  id: number;
  folder_path: string;
  folder_name: string | null;
  folder_type: 'upload' | 'scan' | 'archive';
  auto_scan: boolean;
  scan_interval: number;
  recursive: boolean;
  file_extensions: string | null;
  exclude_patterns: string | null;
  is_active: boolean;
  last_scan_date: string | null;
  last_scan_status: string | null;
  last_scan_found: number;
  last_scan_error: string | null;
  created_date: string;
  updated_date: string;
}

export class WatchedFolderService {
  /**
   * 폴더 등록
   */
  static async addFolder(folderData: {
    folder_path: string;
    folder_name?: string;
    folder_type?: 'upload' | 'scan' | 'archive';
    auto_scan?: boolean;
    scan_interval?: number;
    recursive?: boolean;
    file_extensions?: string[];
    exclude_patterns?: string[];
  }): Promise<number> {
    // 경로 정규화 (절대 경로로 변환)
    const absolutePath = path.resolve(folderData.folder_path);

    // 폴더 존재 확인
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`폴더가 존재하지 않습니다: ${absolutePath}`);
    }

    // 중복 확인
    const existing = db.prepare(
      'SELECT id FROM watched_folders WHERE folder_path = ?'
    ).get(absolutePath);

    if (existing) {
      throw new Error('이미 등록된 폴더입니다');
    }

    // 삽입
    const info = db.prepare(`
      INSERT INTO watched_folders (
        folder_path, folder_name, folder_type, auto_scan, scan_interval,
        recursive, file_extensions, exclude_patterns
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      absolutePath,
      folderData.folder_name || path.basename(absolutePath),
      folderData.folder_type || 'scan',
      folderData.auto_scan ? 1 : 0,
      folderData.scan_interval || 60,
      folderData.recursive !== false ? 1 : 0,
      folderData.file_extensions ? JSON.stringify(folderData.file_extensions) : null,
      folderData.exclude_patterns ? JSON.stringify(folderData.exclude_patterns) : null
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 폴더 목록 조회
   */
  static async listFolders(options?: {
    type?: 'upload' | 'scan' | 'archive';
    active_only?: boolean;
  }): Promise<WatchedFolder[]> {
    let query = 'SELECT * FROM watched_folders WHERE 1=1';
    const params: any[] = [];

    if (options?.type) {
      query += ' AND folder_type = ?';
      params.push(options.type);
    }

    if (options?.active_only) {
      query += ' AND is_active = 1';
    }

    query += ' ORDER BY created_date DESC';

    return db.prepare(query).all(...params) as WatchedFolder[];
  }

  /**
   * 폴더 정보 조회
   */
  static async getFolder(id: number): Promise<WatchedFolder | null> {
    const row = db.prepare('SELECT * FROM watched_folders WHERE id = ?').get(id);
    return row as WatchedFolder | null;
  }

  /**
   * 폴더 업데이트
   */
  static async updateFolder(id: number, updates: Partial<WatchedFolder>): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.folder_name !== undefined) {
      fields.push('folder_name = ?');
      values.push(updates.folder_name);
    }

    if (updates.auto_scan !== undefined) {
      fields.push('auto_scan = ?');
      values.push(updates.auto_scan ? 1 : 0);
    }

    if (updates.scan_interval !== undefined) {
      fields.push('scan_interval = ?');
      values.push(updates.scan_interval);
    }

    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const info = db.prepare(`
      UPDATE watched_folders SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return info.changes > 0;
  }

  /**
   * 폴더 삭제
   */
  static async deleteFolder(id: number, deleteFiles: boolean = false): Promise<boolean> {
    if (deleteFiles) {
      // image_files에서도 삭제 (CASCADE로 자동 처리됨)
      // 하지만 image_metadata는 유지 (다른 폴더에서 참조 가능)
    }

    const info = db.prepare('DELETE FROM watched_folders WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 스캔 상태 업데이트
   */
  static async updateScanStatus(
    id: number,
    status: 'success' | 'error' | 'in_progress',
    found?: number,
    error?: string
  ): Promise<void> {
    const updates: any = {
      last_scan_status: status,
      last_scan_date: new Date().toISOString()
    };

    if (found !== undefined) {
      updates.last_scan_found = found;
    }

    if (error) {
      updates.last_scan_error = error;
    }

    const fields = Object.keys(updates).map(key => `${key} = ?`);
    const values = Object.values(updates);
    values.push(id);

    db.prepare(`
      UPDATE watched_folders SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);
  }
}
```

#### 3.2 FolderScanService (스캔 엔진)

**파일**: `backend/src/services/folderScanService.ts`

```typescript
import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import { ImageSimilarityService } from './imageSimilarity';
import { ImageProcessor } from './imageProcessor';
import { WatchedFolderService } from './watchedFolderService';

export interface ScanResult {
  folderId: number;
  totalScanned: number;
  newImages: number;
  existingImages: number;
  updatedPaths: number;
  missingImages: number;
  errors: Array<{ file: string; error: string }>;
  duration: number;
}

export class FolderScanService {
  /**
   * 폴더 스캔 실행
   */
  static async scanFolder(folderId: number, fullRescan: boolean = false): Promise<ScanResult> {
    const startTime = Date.now();
    const result: ScanResult = {
      folderId,
      totalScanned: 0,
      newImages: 0,
      existingImages: 0,
      updatedPaths: 0,
      missingImages: 0,
      errors: [],
      duration: 0
    };

    try {
      // 1. 폴더 정보 조회
      const folder = await WatchedFolderService.getFolder(folderId);
      if (!folder) {
        throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);
      }

      if (!folder.is_active) {
        throw new Error('비활성화된 폴더입니다');
      }

      // 2. 스캔 상태 업데이트
      await WatchedFolderService.updateScanStatus(folderId, 'in_progress');

      // 3. 파일 목록 수집
      const files = this.collectFiles(folder.folder_path, {
        recursive: folder.recursive,
        extensions: folder.file_extensions ? JSON.parse(folder.file_extensions) : null,
        excludePatterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : null
      });

      console.log(`📂 스캔 시작: ${folder.folder_path} (${files.length}개 파일)`);

      // 4. 전체 재스캔인 경우 기존 파일들을 'missing'으로 표시
      if (fullRescan) {
        db.prepare(`
          UPDATE image_files SET file_status = 'missing'
          WHERE folder_id = ? AND file_status = 'active'
        `).run(folderId);
      }

      // 5. 각 파일 처리
      for (const filePath of files) {
        result.totalScanned++;

        try {
          await this.processFile(filePath, folderId, result);
        } catch (error) {
          result.errors.push({
            file: filePath,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }

        // 진행 상황 로그 (100개마다)
        if (result.totalScanned % 100 === 0) {
          console.log(`  📊 진행: ${result.totalScanned}/${files.length}`);
        }
      }

      // 6. 스캔 완료 상태 업데이트
      await WatchedFolderService.updateScanStatus(
        folderId,
        result.errors.length > 0 ? 'error' : 'success',
        result.newImages + result.existingImages,
        result.errors.length > 0 ? `${result.errors.length}개 파일 처리 실패` : null
      );

      result.duration = Date.now() - startTime;
      console.log(`✅ 스캔 완료: ${result.duration}ms`);
      console.log(`  📊 신규: ${result.newImages}, 기존: ${result.existingImages}, 업데이트: ${result.updatedPaths}`);

      return result;
    } catch (error) {
      await WatchedFolderService.updateScanStatus(
        folderId,
        'error',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * 파일 처리
   */
  private static async processFile(
    filePath: string,
    folderId: number,
    result: ScanResult
  ): Promise<void> {
    // 1. 파일 정보 수집
    const stats = fs.statSync(filePath);
    const mimeType = this.getMimeType(filePath);

    // 2. 기존 파일 확인 (경로로)
    const existingFile = db.prepare(
      'SELECT * FROM image_files WHERE original_file_path = ?'
    ).get(filePath) as any;

    if (existingFile) {
      // 기존 파일 발견 → 상태 업데이트
      db.prepare(`
        UPDATE image_files
        SET file_status = 'active',
            last_verified_date = ?,
            file_modified_date = ?,
            file_size = ?
        WHERE id = ?
      `).run(
        new Date().toISOString(),
        stats.mtime.toISOString(),
        stats.size,
        existingFile.id
      );

      result.existingImages++;
      return;
    }

    // 3. 신규 파일 → 해시 생성
    const hashes = await ImageSimilarityService.generateCompositeHash(filePath);

    // 4. 메타데이터 확인 (같은 이미지가 다른 경로에 있을 수 있음)
    const existingMetadata = db.prepare(
      'SELECT * FROM image_metadata WHERE composite_hash = ?'
    ).get(hashes.compositeHash) as any;

    if (existingMetadata) {
      // 같은 이미지가 이미 존재 → image_files에만 추가
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        filePath,
        folderId,
        'active',
        stats.size,
        mimeType,
        stats.mtime.toISOString()
      );

      result.existingImages++;
      console.log(`  ♻️  동일 이미지 발견 (다른 경로): ${path.basename(filePath)}`);
      return;
    }

    // 5. 완전히 새로운 이미지 → 메타데이터 추출 및 썸네일 생성
    try {
      const metadata = await ImageProcessor.processImage(filePath);

      // 6. image_metadata 삽입
      const histogram = await ImageSimilarityService.generateColorHistogram(filePath);
      const colorHistogramJson = ImageSimilarityService.serializeHistogram(histogram);

      // 썸네일 경로 생성
      const dateStr = new Date().toISOString().split('T')[0];
      const thumbnailPath = `uploads/temp/${dateStr}/${hashes.compositeHash}-thumb.jpg`;
      const optimizedPath = `uploads/temp/${dateStr}/${hashes.compositeHash}-optimized.webp`;

      db.prepare(`
        INSERT INTO image_metadata (
          composite_hash, perceptual_hash, dhash, ahash, color_histogram,
          width, height, thumbnail_path, optimized_path,
          ai_tool, model_name, prompt, negative_prompt, seed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        hashes.perceptualHash,
        hashes.dHash,
        hashes.aHash,
        colorHistogramJson,
        metadata.width,
        metadata.height,
        thumbnailPath,
        optimizedPath,
        metadata.ai_tool,
        metadata.model_name,
        metadata.prompt,
        metadata.negative_prompt,
        metadata.seed
      );

      // 7. image_files 삽입
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        filePath,
        folderId,
        'active',
        stats.size,
        mimeType,
        stats.mtime.toISOString()
      );

      result.newImages++;
      console.log(`  ✨ 신규 이미지: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`  ❌ 메타데이터 추출 실패: ${path.basename(filePath)}`, error);
      throw error;
    }
  }

  /**
   * 파일 수집 (재귀적)
   */
  private static collectFiles(
    dirPath: string,
    options: {
      recursive: boolean;
      extensions: string[] | null;
      excludePatterns: string[] | null;
    }
  ): string[] {
    const files: string[] = [];
    const imageExtensions = options.extensions || [
      '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'
    ];

    const traverse = (currentPath: string) => {
      const items = fs.readdirSync(currentPath);

      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stats = fs.statSync(fullPath);

        // 제외 패턴 확인
        if (options.excludePatterns) {
          const shouldExclude = options.excludePatterns.some(pattern =>
            fullPath.includes(pattern)
          );
          if (shouldExclude) continue;
        }

        if (stats.isDirectory()) {
          if (options.recursive) {
            traverse(fullPath);
          }
        } else if (stats.isFile()) {
          const ext = path.extname(fullPath).toLowerCase();
          if (imageExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    traverse(dirPath);
    return files;
  }

  /**
   * MIME 타입 추정
   */
  private static getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * 모든 활성 폴더 스캔
   */
  static async scanAllFolders(): Promise<ScanResult[]> {
    const folders = await WatchedFolderService.listFolders({ active_only: true });
    const results: ScanResult[] = [];

    for (const folder of folders) {
      try {
        const result = await this.scanFolder(folder.id);
        results.push(result);
      } catch (error) {
        console.error(`폴더 스캔 실패: ${folder.folder_path}`, error);
        results.push({
          folderId: folder.id,
          totalScanned: 0,
          newImages: 0,
          existingImages: 0,
          updatedPaths: 0,
          missingImages: 0,
          errors: [{ file: folder.folder_path, error: error instanceof Error ? error.message : 'Unknown' }],
          duration: 0
        });
      }
    }

    return results;
  }
}
```

---

### Phase 4: API 엔드포인트

#### 4.1 폴더 관리 API

**파일**: `backend/src/routes/watchedFolders.ts`

```typescript
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WatchedFolderService } from '../services/watchedFolderService';
import { FolderScanService } from '../services/folderScanService';
import { successResponse, errorResponse } from '@comfyui-image-manager/shared';

const router = Router();

/**
 * GET /api/folders
 * 감시 폴더 목록 조회
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const type = req.query.type as 'upload' | 'scan' | 'archive' | undefined;
  const activeOnly = req.query.active_only === 'true';

  const folders = await WatchedFolderService.listFolders({ type, active_only: activeOnly });
  return res.json(successResponse(folders));
}));

/**
 * GET /api/folders/:id
 * 특정 폴더 정보 조회
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const folder = await WatchedFolderService.getFolder(id);

  if (!folder) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  return res.json(successResponse(folder));
}));

/**
 * POST /api/folders
 * 새 폴더 등록
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive } = req.body;

  if (!folder_path) {
    return res.status(400).json(errorResponse('folder_path가 필요합니다'));
  }

  try {
    const id = await WatchedFolderService.addFolder({
      folder_path,
      folder_name,
      folder_type,
      auto_scan,
      scan_interval,
      recursive
    });

    return res.json(successResponse({ id, message: '폴더가 등록되었습니다' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '폴더 등록 실패';
    return res.status(400).json(errorResponse(message));
  }
}));

/**
 * PATCH /api/folders/:id
 * 폴더 설정 업데이트
 */
router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const updates = req.body;

  const success = await WatchedFolderService.updateFolder(id, updates);

  if (!success) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  return res.json(successResponse({ message: '폴더 설정이 업데이트되었습니다' }));
}));

/**
 * DELETE /api/folders/:id
 * 폴더 삭제
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const deleteFiles = req.query.delete_files === 'true';

  const success = await WatchedFolderService.deleteFolder(id, deleteFiles);

  if (!success) {
    return res.status(404).json(errorResponse('폴더를 찾을 수 없습니다'));
  }

  return res.json(successResponse({ message: '폴더가 삭제되었습니다' }));
}));

/**
 * POST /api/folders/:id/scan
 * 폴더 스캔 실행
 */
router.post('/:id/scan', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const fullRescan = req.query.full === 'true';

  try {
    const result = await FolderScanService.scanFolder(id, fullRescan);
    return res.json(successResponse(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : '스캔 실패';
    return res.status(500).json(errorResponse(message));
  }
}));

/**
 * POST /api/folders/scan-all
 * 모든 활성 폴더 스캔
 */
router.post('/scan-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const results = await FolderScanService.scanAllFolders();
    return res.json(successResponse(results));
  } catch (error) {
    const message = error instanceof Error ? error.message : '전체 스캔 실패';
    return res.status(500).json(errorResponse(message));
  }
}));

export { router as watchedFoldersRoutes };
```

---

## 📝 작업 체크리스트

이 계획서를 기반으로 단계별 구현을 진행합니다.

### ✅ Phase 1: 해시 시스템 확장
- [ ] 1.1 dHash 알고리즘 구현
- [ ] 1.2 aHash 알고리즘 구현
- [ ] 1.3 복합 해시 생성 함수
- [ ] 1.4 복합 해시 유사도 판별
- [ ] 1.5 단위 테스트 작성

### ✅ Phase 2: 데이터베이스 마이그레이션
- [ ] 2.1 Migration 016: 새 테이블 생성
- [ ] 2.2 Migration 017: 기존 데이터 이전
- [ ] 2.3 마이그레이션 테스트
- [ ] 2.4 롤백 시나리오 테스트

### ✅ Phase 3: 폴더 스캔 서비스
- [ ] 3.1 WatchedFolderService 구현
- [ ] 3.2 FolderScanService 구현
- [ ] 3.3 파일 수집 로직
- [ ] 3.4 메타데이터 추출 통합
- [ ] 3.5 에러 핸들링

### ✅ Phase 4: API 엔드포인트
- [ ] 4.1 폴더 관리 API (CRUD)
- [ ] 4.2 스캔 실행 API
- [ ] 4.3 API 문서 작성
- [ ] 4.4 API 테스트

### ✅ Phase 5: 프론트엔드 구현
- [ ] 5.1 폴더 관리 UI
- [ ] 5.2 스캔 진행 상황 표시
- [ ] 5.3 이미지 브라우저 (파일 상태별)
- [ ] 5.4 중복 이미지 관리 UI
- [ ] 5.5 누락 이미지 복구 UI

### ✅ Phase 6: 통합 및 테스트
- [ ] 6.1 직접 업로드 시스템 통합
- [ ] 6.2 기존 그룹 시스템 연동
- [ ] 6.3 엔드-투-엔드 테스트
- [ ] 6.4 성능 테스트 (대용량)
- [ ] 6.5 사용자 시나리오 테스트

### ✅ Phase 7: 자동화 및 최적화
- [ ] 7.1 자동 스캔 스케줄러
- [ ] 7.2 증분 스캔 최적화
- [ ] 7.3 백그라운드 작업 관리
- [ ] 7.4 캐시 정리 자동화

---

## 🎯 다음 단계

이 계획서를 참고하여 Phase 1부터 순차적으로 구현을 시작합니다.
각 Phase 완료 후 테스트를 진행하고, 문제가 있으면 수정합니다.

**예상 작업 기간**: 약 5-7일 (Phase별 1일)

**우선순위**:
1. Phase 1-2: 해시 시스템 및 DB (가장 중요, 기반)
2. Phase 3-4: 스캔 엔진 및 API (핵심 기능)
3. Phase 5: 프론트엔드 (사용자 경험)
4. Phase 6-7: 통합 및 최적화 (안정화)

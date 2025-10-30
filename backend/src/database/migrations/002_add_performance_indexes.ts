/**
 * Migration: Add composite indexes for query performance optimization
 *
 * Purpose: 폴더 스캔 및 이미지 조회 성능 최적화를 위한 복합 인덱스 추가
 * - image_files 테이블: folder_id + file_status 복합 인덱스
 * - image_files 테이블: original_file_path + composite_hash 복합 인덱스
 * - image_metadata 테이블: composite_hash 기반 조회 최적화
 */

import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  console.log('🔄 마이그레이션: 성능 최적화 인덱스 추가...');

  // 1. image_files: folder_id + file_status 복합 인덱스
  // 사용 케이스: 특정 폴더의 활성 파일 조회
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_folder_status
      ON image_files(folder_id, file_status);
  `);
  console.log('  ✅ 인덱스 추가: idx_files_folder_status (folder_id, file_status)');

  // 2. image_files: original_file_path 인덱스 (기존 파일 경로 조회 최적화)
  // 사용 케이스: 파일 경로로 기존 이미지 검색
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_path
      ON image_files(original_file_path);
  `);
  console.log('  ✅ 인덱스 추가: idx_files_path (original_file_path)');

  // 3. image_metadata: composite_hash + 개별 해시 복합 인덱스
  // 사용 케이스: 유사 이미지 검색 및 중복 이미지 확인
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metadata_composite_lookup
      ON image_metadata(composite_hash, perceptual_hash, dhash, ahash);
  `);
  console.log('  ✅ 인덱스 추가: idx_metadata_composite_lookup (해시 조회 최적화)');

  // 4. image_files: composite_hash + folder_id 복합 인덱스
  // 사용 케이스: 폴더별 중복 이미지 검색
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_hash_folder
      ON image_files(composite_hash, folder_id);
  `);
  console.log('  ✅ 인덱스 추가: idx_files_hash_folder (composite_hash, folder_id)');

  console.log('✅ 성능 최적화 인덱스 추가 완료');
}

export function down(db: Database.Database): void {
  console.log('🔄 롤백: 성능 최적화 인덱스 제거...');

  db.exec(`
    DROP INDEX IF EXISTS idx_files_folder_status;
    DROP INDEX IF EXISTS idx_files_path;
    DROP INDEX IF EXISTS idx_metadata_composite_lookup;
    DROP INDEX IF EXISTS idx_files_hash_folder;
  `);

  console.log('✅ 인덱스 제거 완료');
}

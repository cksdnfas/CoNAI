/**
 * Migration: Add indexes for thumbnail loading performance
 *
 * Purpose: 썸네일 로딩 성능 최적화를 위한 인덱스 추가
 * - image_files 테이블: composite_hash + file_status 복합 인덱스 (JOIN 최적화)
 * - image_files 테이블: scan_date DESC 인덱스 (정렬 최적화)
 * - media_metadata 테이블: first_seen_date DESC 인덱스 (정렬 최적화)
 * - image_groups 테이블: composite_hash 인덱스 (JOIN 최적화)
 */

import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  console.log('🔄 마이그레이션: 썸네일 로딩 성능 인덱스 추가...');

  // 1. image_files: composite_hash + file_status 복합 인덱스
  // 사용 케이스: findAllWithFiles() JOIN 쿼리 최적화
  // WHERE file_status = 'active' AND composite_hash 조인 조건 최적화
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_composite_status
      ON image_files(composite_hash, file_status)
      WHERE file_status = 'active';
  `);
  console.log('  ✅ 인덱스 추가: idx_files_composite_status (composite_hash, file_status)');

  // 2. image_files: scan_date 내림차순 인덱스
  // 사용 케이스: ORDER BY scan_date DESC 쿼리 최적화
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_scan_date_desc
      ON image_files(scan_date DESC);
  `);
  console.log('  ✅ 인덱스 추가: idx_files_scan_date_desc (scan_date DESC)');

  // 3. media_metadata: first_seen_date 내림차순 인덱스
  // 사용 케이스: ORDER BY first_seen_date DESC 쿼리 최적화
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metadata_first_seen_desc
      ON media_metadata(first_seen_date DESC);
  `);
  console.log('  ✅ 인덱스 추가: idx_metadata_first_seen_desc (first_seen_date DESC)');

  // 4. image_groups: composite_hash 인덱스
  // 사용 케이스: 그룹 정보 JOIN 쿼리 최적화
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_groups_composite_hash
      ON image_groups(composite_hash);
  `);
  console.log('  ✅ 인덱스 추가: idx_groups_composite_hash (composite_hash)');

  // 5. image_files: file_status 단일 인덱스 (WHERE 절 최적화)
  // 사용 케이스: WHERE file_status = 'active' 필터링 최적화
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_status
      ON image_files(file_status)
      WHERE file_status = 'active';
  `);
  console.log('  ✅ 인덱스 추가: idx_files_status (file_status)');

  console.log('✅ 썸네일 로딩 성능 인덱스 추가 완료');
}

export function down(db: Database.Database): void {
  console.log('🔄 롤백: 썸네일 로딩 성능 인덱스 제거...');

  db.exec(`
    DROP INDEX IF EXISTS idx_files_composite_status;
    DROP INDEX IF EXISTS idx_files_scan_date_desc;
    DROP INDEX IF EXISTS idx_metadata_first_seen_desc;
    DROP INDEX IF EXISTS idx_groups_composite_hash;
    DROP INDEX IF EXISTS idx_files_status;
  `);

  console.log('✅ 인덱스 제거 완료');
}

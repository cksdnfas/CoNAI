/**
 * Migration: Enable auto-scan for default upload folder
 *
 * Purpose: 모든 폴더를 일관되게 처리하기 위해 기본 업로드 폴더의 auto_scan을 활성화
 * - 기존 데이터베이스의 기본 폴더 (id=1) 업데이트
 * - auto_scan: 0 → 1 (자동 스캔 활성화)
 * - scan_interval: NULL → 60 (60분마다 스캔)
 * - recursive: NULL → 1 (하위 폴더 포함)
 */

import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  console.log('🔄 마이그레이션: 기본 폴더 auto_scan 활성화...');

  // 기본 업로드 폴더의 auto_scan 설정 활성화
  const updateStmt = db.prepare(`
    UPDATE watched_folders
    SET
      auto_scan = 1,
      scan_interval = COALESCE(scan_interval, 60),
      recursive = COALESCE(recursive, 1)
    WHERE id = 1
      AND folder_type = 'upload'
      AND (auto_scan IS NULL OR auto_scan = 0)
  `);

  const result = updateStmt.run();

  if (result.changes > 0) {
    console.log(`  ✅ 기본 폴더 auto_scan 활성화 완료 (${result.changes}개 업데이트)`);
  } else {
    console.log('  ℹ️  기본 폴더가 이미 auto_scan 활성화 상태이거나 존재하지 않음');
  }
}

export function down(db: Database.Database): void {
  console.log('🔄 롤백: 기본 폴더 auto_scan 비활성화...');

  // 롤백 시 원래 상태로 복원
  const revertStmt = db.prepare(`
    UPDATE watched_folders
    SET auto_scan = 0
    WHERE id = 1 AND folder_type = 'upload'
  `);

  const result = revertStmt.run();
  console.log(`  ✅ 롤백 완료 (${result.changes}개 복원)`);
}

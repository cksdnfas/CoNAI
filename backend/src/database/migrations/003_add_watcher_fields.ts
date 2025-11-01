/**
 * Migration: Add file watcher fields to watched_folders table
 *
 * Purpose: 실시간 파일 모니터링을 위한 워처 상태 추적 필드 추가
 * - watcher_enabled: 워처 활성화 여부 (0/1)
 * - watcher_status: 워처 상태 ('watching', 'error', 'stopped', NULL)
 * - watcher_error: 오류 메시지
 * - watcher_last_event: 마지막 파일 이벤트 시간
 */

import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  console.log('⏭️  마이그레이션 003: Skipped (already applied in migration 000)');

  // Check if fields exist (for legacy databases)
  const tableInfo = db.prepare(`PRAGMA table_info(watched_folders)`).all() as Array<{ name: string }>;
  const hasWatcherEnabled = tableInfo.some(col => col.name === 'watcher_enabled');

  if (!hasWatcherEnabled) {
    console.log('🔄 Applying migration 003 for legacy database...');

    // Add watcher fields for legacy database
    db.exec(`ALTER TABLE watched_folders ADD COLUMN watcher_enabled INTEGER DEFAULT 0;`);
    console.log('  ✅ 필드 추가: watcher_enabled');

    db.exec(`ALTER TABLE watched_folders ADD COLUMN watcher_status TEXT;`);
    console.log('  ✅ 필드 추가: watcher_status');

    db.exec(`ALTER TABLE watched_folders ADD COLUMN watcher_error TEXT;`);
    console.log('  ✅ 필드 추가: watcher_error');

    db.exec(`ALTER TABLE watched_folders ADD COLUMN watcher_last_event DATETIME;`);
    console.log('  ✅ 필드 추가: watcher_last_event');

    console.log('✅ Migration 003 applied for legacy database');
  }
}

export function down(db: Database.Database): void {
  console.log('🔄 롤백: 파일 워처 필드 제거...');

  // SQLite는 컬럼 삭제를 직접 지원하지 않으므로 테이블 재생성 필요
  console.log('  ℹ️  SQLite 제한: ALTER TABLE DROP COLUMN 미지원');
  console.log('  ℹ️  필요 시 테이블 재생성 스크립트 실행 필요');

  // 참고: 실제 롤백이 필요한 경우 아래 단계로 진행
  // 1. 새 테이블 생성 (워처 필드 제외)
  // 2. 데이터 복사
  // 3. 기존 테이블 삭제
  // 4. 새 테이블 이름 변경
}

import Database from 'better-sqlite3';

/**
 * 마이그레이션: 스캔 로그 시스템 추가
 * - scan_logs: 폴더 스캔 시 발생한 오류 및 상세 로그 저장
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 003: 스캔 로그 테이블 생성 시작...');

  // scan_logs 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- 스캔 정보
      folder_id INTEGER NOT NULL,
      scan_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      scan_status TEXT NOT NULL,

      -- 결과 요약
      total_scanned INTEGER DEFAULT 0,
      new_images INTEGER DEFAULT 0,
      existing_images INTEGER DEFAULT 0,
      updated_paths INTEGER DEFAULT 0,
      missing_images INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,

      -- 스캔 시간
      duration_ms INTEGER,

      -- 상세 오류 로그 (JSON 배열)
      error_details TEXT,

      FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE
    )
  `);
  console.log('  ✅ scan_logs 테이블 생성');

  // 인덱스 생성
  db.exec('CREATE INDEX IF NOT EXISTS idx_scan_logs_folder_id ON scan_logs(folder_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_scan_logs_scan_date ON scan_logs(scan_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_scan_logs_status ON scan_logs(scan_status)');
  console.log('  ✅ scan_logs 인덱스 생성');

  console.log('✅ Migration 003: 스캔 로그 테이블 생성 완료');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔍 Migration 003 rollback: 스캔 로그 테이블 제거 시작...');

  // 인덱스 제거
  db.exec('DROP INDEX IF EXISTS idx_scan_logs_folder_id');
  db.exec('DROP INDEX IF EXISTS idx_scan_logs_scan_date');
  db.exec('DROP INDEX IF EXISTS idx_scan_logs_status');

  // 테이블 제거
  db.exec('DROP TABLE IF EXISTS scan_logs');
  console.log('  ✅ scan_logs 테이블 제거');

  console.log('✅ Migration 003 rollback: 완료');
};

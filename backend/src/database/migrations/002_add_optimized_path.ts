import Database from 'better-sqlite3';

/**
 * 마이그레이션: optimized_path 컬럼 추가
 * 저용량 버전 이미지 경로를 저장하기 위한 컬럼 추가
 */
export const up = async (db: Database.Database): Promise<void> => {
  // optimized_path 컬럼 추가
  db.exec(`ALTER TABLE images ADD COLUMN optimized_path VARCHAR(500)`);
  console.log('✅ optimized_path 컬럼이 추가되었습니다.');

  // optimized_path 인덱스 추가
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_optimized_path ON images(optimized_path)`);
    console.log('✅ optimized_path 인덱스가 생성되었습니다.');
  } catch (err) {
    console.warn('Warning creating optimized_path index:', err);
  }
};

export const down = async (db: Database.Database): Promise<void> => {
  // 인덱스 제거
  try {
    db.exec(`DROP INDEX IF EXISTS idx_optimized_path`);
  } catch (err) {
    console.warn('Warning dropping optimized_path index:', err);
  }

  // 컬럼 제거 (SQLite는 ALTER TABLE DROP COLUMN을 지원하지 않으므로 테이블 재생성)
  db.exec(`
    CREATE TABLE images_backup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      thumbnail_path VARCHAR(500) NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      width INTEGER,
      height INTEGER,
      upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      UNIQUE(file_path)
    )
  `);

  // 데이터 복사
  db.exec(`
    INSERT INTO images_backup
    SELECT id, filename, original_name, file_path, thumbnail_path,
           file_size, mime_type, width, height, upload_date, metadata
    FROM images
  `);

  // 기존 테이블 삭제
  db.exec('DROP TABLE images');

  // 백업 테이블을 원래 이름으로 변경
  db.exec('ALTER TABLE images_backup RENAME TO images');
  console.log('✅ optimized_path 컬럼이 제거되었습니다.');
};

import Database from 'better-sqlite3';

export const up = async (db: Database.Database): Promise<void> => {
  // workflows 테이블에 color 컬럼 추가
  db.exec(`
    ALTER TABLE workflows ADD COLUMN color VARCHAR(7) DEFAULT '#2196f3'
  `);
  console.log('✅ Workflows 테이블에 color 컬럼이 추가되었습니다.');
};

export const down = async (db: Database.Database): Promise<void> => {
  // SQLite는 ALTER TABLE DROP COLUMN을 지원하지 않으므로
  // 테이블을 재생성하는 방식으로 롤백
  db.exec(`
    CREATE TABLE workflows_backup AS SELECT
      id, name, description, workflow_json, marked_fields,
      api_endpoint, is_active, created_date, updated_date
    FROM workflows
  `);

  db.exec('DROP TABLE workflows');

  db.exec(`
    CREATE TABLE workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      workflow_json TEXT NOT NULL,
      marked_fields TEXT,
      api_endpoint VARCHAR(500) DEFAULT 'http://127.0.0.1:8188',
      is_active BOOLEAN DEFAULT 1,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    INSERT INTO workflows
    SELECT * FROM workflows_backup
  `);

  db.exec('DROP TABLE workflows_backup');

  console.log('✅ Workflows 테이블에서 color 컬럼이 제거되었습니다.');
};

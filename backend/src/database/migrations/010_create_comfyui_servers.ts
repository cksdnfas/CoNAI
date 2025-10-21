import Database from 'better-sqlite3';

export const up = async (db: Database.Database): Promise<void> => {
  // ComfyUI 서버 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS comfyui_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      endpoint VARCHAR(500) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT 1,
      priority INTEGER DEFAULT 0,
      max_concurrent_jobs INTEGER DEFAULT 1,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ ComfyUI_servers 테이블이 생성되었습니다.');

  // 워크플로우-서버 관계 테이블 (다대다)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      is_enabled BOOLEAN DEFAULT 1,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES comfyui_servers(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, server_id)
    )
  `);
  console.log('✅ Workflow_servers 테이블이 생성되었습니다.');

  // generation_history에 서버 정보 필드 추가
  db.exec(`
    ALTER TABLE generation_history ADD COLUMN server_id INTEGER REFERENCES comfyui_servers(id) ON DELETE SET NULL
  `);
  console.log('✅ Generation_history에 server_id 필드가 추가되었습니다.');

  // 인덱스 생성
  const indexes = [
    { name: 'idx_comfyui_servers_is_active', table: 'comfyui_servers', column: 'is_active' },
    { name: 'idx_comfyui_servers_priority', table: 'comfyui_servers', column: 'priority' },
    { name: 'idx_workflow_servers_workflow_id', table: 'workflow_servers', column: 'workflow_id' },
    { name: 'idx_workflow_servers_server_id', table: 'workflow_servers', column: 'server_id' },
    { name: 'idx_generation_history_server_id', table: 'generation_history', column: 'server_id' }
  ];

  indexes.forEach(index => {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.column})`);
    } catch (err) {
      console.warn(`⚠️  Warning creating index ${index.name}:`, err);
    }
  });
  console.log('✅ ComfyUI 서버 관련 인덱스가 설정되었습니다.');

  // workflows 테이블에서 api_endpoint 필드 제거 (이제 서버를 별도로 관리)
  // SQLite는 ALTER TABLE DROP COLUMN을 지원하지 않으므로 마이그레이션 시 주의
  console.log('ℹ️  workflows 테이블의 api_endpoint는 deprecated되었습니다. workflow_servers를 사용하세요.');

  // 기본 서버 생성
  try {
    db.prepare(`INSERT OR IGNORE INTO comfyui_servers (name, endpoint, description, priority) VALUES (?, ?, ?, ?)`).run(
      'Local ComfyUI',
      'http://127.0.0.1:8188',
      '로컬 ComfyUI 서버',
      1
    );
    console.log('✅ 기본 ComfyUI 서버가 생성되었습니다.');
  } catch (err) {
    console.warn('⚠️  Warning creating default server:', err);
  }
};

export const down = async (db: Database.Database): Promise<void> => {
  // 인덱스 삭제
  const indexes = [
    'idx_comfyui_servers_is_active',
    'idx_comfyui_servers_priority',
    'idx_workflow_servers_workflow_id',
    'idx_workflow_servers_server_id',
    'idx_generation_history_server_id'
  ];

  indexes.forEach(indexName => {
    try {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    } catch (err) {
      console.warn(`⚠️  Warning dropping index ${indexName}:`, err);
    }
  });

  // 테이블 삭제
  db.exec('DROP TABLE IF EXISTS workflow_servers');
  console.log('✅ Workflow_servers 테이블이 삭제되었습니다.');

  db.exec('DROP TABLE IF EXISTS comfyui_servers');
  console.log('✅ ComfyUI_servers 테이블이 삭제되었습니다.');

  // generation_history의 server_id 필드는 SQLite 제약으로 제거 불가
  console.log('⚠️  generation_history.server_id 필드는 남아있습니다 (SQLite 제약).');
};

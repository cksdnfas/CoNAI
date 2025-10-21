import Database from 'better-sqlite3';

export const up = async (db: Database.Database): Promise<void> => {
  // workflows 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
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
  console.log('✅ Workflows 테이블이 생성되었습니다.');

  // generation_history 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      prompt_data TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      comfyui_prompt_id VARCHAR(255),
      generated_image_id INTEGER,
      error_message TEXT,
      execution_time INTEGER,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
      FOREIGN KEY (generated_image_id) REFERENCES images(id) ON DELETE SET NULL
    )
  `);
  console.log('✅ Generation_history 테이블이 생성되었습니다.');

  // 인덱스 생성
  const indexes = [
    { name: 'idx_workflows_name', table: 'workflows', column: 'name' },
    { name: 'idx_workflows_is_active', table: 'workflows', column: 'is_active' },
    { name: 'idx_workflows_created_date', table: 'workflows', column: 'created_date' },
    { name: 'idx_generation_history_workflow_id', table: 'generation_history', column: 'workflow_id' },
    { name: 'idx_generation_history_status', table: 'generation_history', column: 'status' },
    { name: 'idx_generation_history_comfyui_prompt_id', table: 'generation_history', column: 'comfyui_prompt_id' },
    { name: 'idx_generation_history_created_date', table: 'generation_history', column: 'created_date' }
  ];

  indexes.forEach(index => {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.column})`);
    } catch (err) {
      console.warn(`⚠️  Warning creating index ${index.name}:`, err);
    }
  });
  console.log('✅ Workflows 관련 인덱스가 설정되었습니다.');
};

export const down = async (db: Database.Database): Promise<void> => {
  // 인덱스 삭제
  const indexes = [
    'idx_workflows_name',
    'idx_workflows_is_active',
    'idx_workflows_created_date',
    'idx_generation_history_workflow_id',
    'idx_generation_history_status',
    'idx_generation_history_comfyui_prompt_id',
    'idx_generation_history_created_date'
  ];

  indexes.forEach(indexName => {
    try {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    } catch (err) {
      console.warn(`⚠️  Warning dropping index ${indexName}:`, err);
    }
  });

  // 테이블 삭제
  db.exec('DROP TABLE IF EXISTS generation_history');
  console.log('✅ Generation_history 테이블이 삭제되었습니다.');

  db.exec('DROP TABLE IF EXISTS workflows');
  console.log('✅ Workflows 테이블이 삭제되었습니다.');
};

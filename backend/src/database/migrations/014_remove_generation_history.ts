import Database from 'better-sqlite3';

/**
 * Migration: Remove generation_history table
 * Reason: Consolidating to api_generation_history in api-generation.db
 * This table was redundant with api_generation_history which provides:
 * - ComfyUI + NovelAI support
 * - Independent image path management
 * - Complete generation metadata
 * - Group auto-assignment support
 */

export const up = async (db: Database.Database): Promise<void> => {
  // Drop indexes first
  const indexes = [
    'idx_generation_history_workflow_id',
    'idx_generation_history_status',
    'idx_generation_history_comfyui_prompt_id',
    'idx_generation_history_created_date'
  ];

  indexes.forEach(indexName => {
    try {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
      console.log(`✅ Index ${indexName} dropped`);
    } catch (err) {
      console.warn(`⚠️  Warning dropping index ${indexName}:`, err);
    }
  });

  // Drop generation_history table
  db.exec('DROP TABLE IF EXISTS generation_history');
  console.log('✅ generation_history table removed (consolidated to api_generation_history)');
};

export const down = async (db: Database.Database): Promise<void> => {
  // Recreate generation_history table for rollback
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
  console.log('✅ generation_history table recreated');

  // Recreate indexes
  const indexes = [
    { name: 'idx_generation_history_workflow_id', column: 'workflow_id' },
    { name: 'idx_generation_history_status', column: 'status' },
    { name: 'idx_generation_history_comfyui_prompt_id', column: 'comfyui_prompt_id' },
    { name: 'idx_generation_history_created_date', column: 'created_date' }
  ];

  indexes.forEach(index => {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON generation_history(${index.column})`);
      console.log(`✅ Index ${index.name} recreated`);
    } catch (err) {
      console.warn(`⚠️  Warning creating index ${index.name}:`, err);
    }
  });
};

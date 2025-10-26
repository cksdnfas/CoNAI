import Database from 'better-sqlite3';

export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Starting migration: Remove priority and max_concurrent_jobs fields...');

  // SQLite doesn't support DROP COLUMN directly
  // We need to create a new table, copy data, drop old table, and rename new table

  // 1. Create new table without priority and max_concurrent_jobs
  db.exec(`
    CREATE TABLE IF NOT EXISTS comfyui_servers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      endpoint VARCHAR(500) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT 1,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ New comfyui_servers table created');

  // 2. Copy data from old table to new table
  db.exec(`
    INSERT INTO comfyui_servers_new (id, name, endpoint, description, is_active, created_date, updated_date)
    SELECT id, name, endpoint, description, is_active, created_date, updated_date
    FROM comfyui_servers
  `);
  console.log('✅ Data copied to new table');

  // 3. Drop old table
  db.exec('DROP TABLE comfyui_servers');
  console.log('✅ Old comfyui_servers table dropped');

  // 4. Rename new table to original name
  db.exec('ALTER TABLE comfyui_servers_new RENAME TO comfyui_servers');
  console.log('✅ New table renamed to comfyui_servers');

  // 5. Drop old priority index (other indexes will be recreated)
  try {
    db.exec('DROP INDEX IF EXISTS idx_comfyui_servers_priority');
    console.log('✅ Priority index dropped');
  } catch (err) {
    console.warn('⚠️  Warning dropping priority index:', err);
  }

  // 6. Recreate necessary indexes
  const indexes = [
    { name: 'idx_comfyui_servers_is_active', table: 'comfyui_servers', column: 'is_active' }
  ];

  indexes.forEach(index => {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.column})`);
    } catch (err) {
      console.warn(`⚠️  Warning creating index ${index.name}:`, err);
    }
  });
  console.log('✅ Indexes recreated');

  console.log('✅ Migration complete: priority and max_concurrent_jobs fields removed');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Rolling back migration: Restore priority and max_concurrent_jobs fields...');

  // 1. Create table with old schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS comfyui_servers_old (
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
  console.log('✅ Old schema table created');

  // 2. Copy data back (with default values for priority and max_concurrent_jobs)
  db.exec(`
    INSERT INTO comfyui_servers_old (id, name, endpoint, description, is_active, created_date, updated_date, priority, max_concurrent_jobs)
    SELECT id, name, endpoint, description, is_active, created_date, updated_date, 0, 1
    FROM comfyui_servers
  `);
  console.log('✅ Data copied with default values');

  // 3. Drop new table
  db.exec('DROP TABLE comfyui_servers');
  console.log('✅ New table dropped');

  // 4. Rename old table back
  db.exec('ALTER TABLE comfyui_servers_old RENAME TO comfyui_servers');
  console.log('✅ Table renamed back to comfyui_servers');

  // 5. Recreate all indexes
  const indexes = [
    { name: 'idx_comfyui_servers_is_active', table: 'comfyui_servers', column: 'is_active' },
    { name: 'idx_comfyui_servers_priority', table: 'comfyui_servers', column: 'priority' }
  ];

  indexes.forEach(index => {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.column})`);
    } catch (err) {
      console.warn(`⚠️  Warning creating index ${index.name}:`, err);
    }
  });
  console.log('✅ All indexes recreated');

  console.log('✅ Rollback complete: priority and max_concurrent_jobs fields restored');
};

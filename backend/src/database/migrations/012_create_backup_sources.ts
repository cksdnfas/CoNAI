import Database from 'better-sqlite3';

/**
 * Create backup_sources table for external source -> uploads ingest flow.
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔧 Creating backup_sources table...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL UNIQUE,
      display_name TEXT,
      target_folder_name TEXT NOT NULL,
      recursive INTEGER DEFAULT 1,
      watcher_enabled INTEGER DEFAULT 1,
      watcher_polling_interval INTEGER DEFAULT NULL,
      import_mode TEXT DEFAULT 'copy_original',
      webp_quality INTEGER DEFAULT 90,
      is_active INTEGER DEFAULT 1,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event DATETIME,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_backup_sources_active ON backup_sources(is_active)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_backup_sources_watcher_enabled ON backup_sources(watcher_enabled)`);

  console.log('✅ backup_sources table ready\n');
};

export const down = async (_db: Database.Database): Promise<void> => {
  console.log('⚠️  Rolling back backup_sources table...');
  console.log('  ⚠️  Automatic rollback is not implemented for this migration.');
};

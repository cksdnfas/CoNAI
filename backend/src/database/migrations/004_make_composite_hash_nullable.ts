import { Database } from 'better-sqlite3';

/**
 * Migration 004: Make composite_hash nullable for two-phase scanning
 *
 * DEPRECATED: This migration is now included in migration 000
 * Kept as no-op for backward compatibility
 */
export const up = (db: Database) => {
  console.log('⏭️  Migration 004: Skipped (already applied in migration 000)');

  // Check if migration is needed (for legacy databases)
  const tableInfo = db.prepare(`PRAGMA table_info(image_files)`).all() as Array<{ name: string; notnull: number }>;
  const compositeHashCol = tableInfo.find(col => col.name === 'composite_hash');

  if (compositeHashCol && compositeHashCol.notnull === 1) {
    // Legacy database - need to apply migration
    console.log('🔄 Applying migration 004 for legacy database...');

    // Check if temporary table exists from failed migration
    const tempTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='image_files_new'`).get();
    if (tempTableExists) {
      console.log('⚠️  Cleaning up failed migration...');
      db.exec(`DROP TABLE image_files_new`);
    }

    // Apply migration
    db.exec(`
      CREATE TABLE image_files_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        composite_hash TEXT,
        file_hash TEXT,
        original_file_path TEXT NOT NULL UNIQUE,
        folder_id INTEGER NOT NULL,
        file_status TEXT DEFAULT 'active' CHECK(file_status IN ('active', 'deleted', 'duplicate')),
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        file_modified_date DATETIME,
        scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_verified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE SET NULL,
        FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE
      )
    `);

    db.exec(`INSERT INTO image_files_new (id, composite_hash, original_file_path, folder_id, file_status, file_size, mime_type, file_modified_date, scan_date, last_verified_date) SELECT id, composite_hash, original_file_path, folder_id, file_status, file_size, mime_type, file_modified_date, scan_date, last_verified_date FROM image_files`);
    db.exec(`DROP TABLE image_files`);
    db.exec(`ALTER TABLE image_files_new RENAME TO image_files`);

    // Recreate indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_composite_hash ON image_files(composite_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_file_hash ON image_files(file_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_folder_id ON image_files(folder_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_status ON image_files(file_status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_path ON image_files(original_file_path)`);

    console.log('✅ Migration 004 applied for legacy database');
  }
};

export const down = (db: Database) => {
  console.log('Rolling back migration 004...');

  // Rollback: Recreate table with NOT NULL constraint
  // WARNING: This will fail if any NULL composite_hash values exist!
  db.exec(`
    CREATE TABLE image_files_old (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite_hash TEXT NOT NULL,  -- Restored NOT NULL constraint
      original_file_path TEXT NOT NULL UNIQUE,
      folder_id INTEGER NOT NULL,
      file_status TEXT DEFAULT 'active' CHECK(file_status IN ('active', 'deleted', 'duplicate')),
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_modified_date DATETIME,
      scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_verified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE
    )
  `);

  // Only copy rows with non-NULL composite_hash
  db.exec(`
    INSERT INTO image_files_old
    SELECT * FROM image_files
    WHERE composite_hash IS NOT NULL
  `);

  db.exec(`DROP TABLE image_files`);
  db.exec(`ALTER TABLE image_files_old RENAME TO image_files`);

  // Recreate original indexes
  db.exec(`CREATE INDEX idx_files_composite_hash ON image_files(composite_hash)`);
  db.exec(`CREATE INDEX idx_files_folder_id ON image_files(folder_id)`);
  db.exec(`CREATE INDEX idx_files_status ON image_files(file_status)`);
  db.exec(`CREATE INDEX idx_files_path ON image_files(original_file_path)`);

  console.log('✅ Migration 004 rollback complete');
};

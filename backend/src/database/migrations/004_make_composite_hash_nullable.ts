import { Database } from 'better-sqlite3';

/**
 * Migration 004: Make composite_hash nullable for two-phase scanning
 *
 * Phase 1 (Fast Registration): Images can be registered without composite_hash
 * Phase 2 (Background Processing): Hashes are generated and duplicates detected
 *
 * Changes:
 * - image_files.composite_hash: NOT NULL → NULL (allows fast registration)
 * - Add index for Phase 2 query optimization
 * - Maintain foreign key constraint with nullable support
 */
export const up = (db: Database) => {
  console.log('Running migration 004: Make composite_hash nullable...');

  // Step 1: Create new image_files table with nullable composite_hash
  db.exec(`
    CREATE TABLE image_files_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite_hash TEXT,  -- Changed from NOT NULL to nullable
      original_file_path TEXT NOT NULL UNIQUE,
      folder_id INTEGER NOT NULL,
      file_status TEXT DEFAULT 'active' CHECK(file_status IN ('active', 'deleted', 'duplicate')),
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_modified_date DATETIME,
      scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_verified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (composite_hash) REFERENCES image_metadata(composite_hash) ON DELETE SET NULL,
      FOREIGN KEY (folder_id) REFERENCES watched_folders(id) ON DELETE CASCADE
    )
  `);

  // Step 2: Copy all existing data
  db.exec(`
    INSERT INTO image_files_new
    SELECT * FROM image_files
  `);

  // Step 3: Drop old table
  db.exec(`DROP TABLE image_files`);

  // Step 4: Rename new table
  db.exec(`ALTER TABLE image_files_new RENAME TO image_files`);

  // Step 5: Recreate indexes with optimization for Phase 2 queries
  db.exec(`CREATE INDEX idx_files_composite_hash ON image_files(composite_hash)`);
  db.exec(`CREATE INDEX idx_files_folder_id ON image_files(folder_id)`);
  db.exec(`CREATE INDEX idx_files_status ON image_files(file_status)`);
  db.exec(`CREATE INDEX idx_files_path ON image_files(original_file_path)`);

  // NEW: Index for Phase 2 query (find images needing processing)
  // Covers: WHERE composite_hash IS NULL AND file_status = 'active' ORDER BY scan_date
  db.exec(`
    CREATE INDEX idx_files_needs_processing
    ON image_files(composite_hash, file_status, scan_date)
    WHERE composite_hash IS NULL
  `);

  console.log('✅ Migration 004 complete: composite_hash is now nullable');
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
      FOREIGN KEY (composite_hash) REFERENCES image_metadata(composite_hash) ON DELETE CASCADE,
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

import Database from 'better-sqlite3';

/**
 * Create image_metadata_edit_revisions table for metadata-save replacement history.
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔧 Creating image_metadata_edit_revisions table...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_metadata_edit_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      composite_hash TEXT NOT NULL,
      image_file_id INTEGER,
      previous_file_path TEXT NOT NULL,
      replacement_file_path TEXT NOT NULL,
      recycle_bin_path TEXT NOT NULL,
      previous_metadata_json TEXT,
      next_metadata_json TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      restored_date DATETIME,
      FOREIGN KEY (image_file_id) REFERENCES image_files(id) ON DELETE SET NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_metadata_edit_revisions_hash ON image_metadata_edit_revisions(composite_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_metadata_edit_revisions_created ON image_metadata_edit_revisions(created_date DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_image_metadata_edit_revisions_restored ON image_metadata_edit_revisions(restored_date)`);

  console.log('✅ image_metadata_edit_revisions table ready\n');
};

export const down = async (_db: Database.Database): Promise<void> => {
  console.log('⚠️  Rolling back image_metadata_edit_revisions table...');
  console.log('  ⚠️  Automatic rollback is not implemented for this migration.');
};

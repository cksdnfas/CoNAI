import type { Database } from 'better-sqlite3';

function hasColumn(db: Database, columnName: string): boolean {
  const columns = db.prepare('PRAGMA table_info(image_files)').all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

/** Add durable per-file retry state for background hashing/media extraction. */
export const up = async (db: Database): Promise<void> => {
  if (!hasColumn(db, 'background_attempt_count')) {
    db.exec('ALTER TABLE image_files ADD COLUMN background_attempt_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'background_next_retry_at')) {
    db.exec('ALTER TABLE image_files ADD COLUMN background_next_retry_at DATETIME DEFAULT NULL');
  }
  if (!hasColumn(db, 'background_last_error')) {
    db.exec('ALTER TABLE image_files ADD COLUMN background_last_error TEXT DEFAULT NULL');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_background_retry
    ON image_files(background_next_retry_at, scan_date)
    WHERE composite_hash IS NULL AND file_status = 'active'
  `);
};

export const down = async (db: Database): Promise<void> => {
  db.exec('DROP INDEX IF EXISTS idx_files_background_retry');
  // Keep the additive columns so rollback cannot rewrite a potentially large media table.
};

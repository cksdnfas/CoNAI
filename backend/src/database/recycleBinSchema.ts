import type Database from 'better-sqlite3';

/**
 * Where each RecycleBin file came from, so an administrator can restore it. Lives in user.db (not images.db): the
 * RecycleBin also holds workflow outputs and edited originals, and images.db migrations stay library-only.
 * Additive and idempotent; ensured lazily by the RecycleBin code instead of at startup.
 */
export function ensureRecycleBinSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recycle_bin_entries (
      bin_name TEXT PRIMARY KEY,
      original_path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

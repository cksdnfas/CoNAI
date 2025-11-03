/**
 * Migration: Remove folder_type column from watched_folders table
 *
 * Reason: folder_type field is unused in the codebase:
 * - Not used by any business logic (scanning, processing, file operations)
 * - Not displayed in the UI folder list
 * - All folders behave identically regardless of type
 * - Legacy field that serves no functional purpose
 *
 * This migration removes:
 * - folder_type column from watched_folders table
 * - idx_folders_type index
 */

import type { Database } from 'better-sqlite3';

export const up = (db: Database): void => {
  console.log('[Migration 007] Removing folder_type column...');

  // SQLite doesn't support DROP COLUMN directly
  // We need to recreate the table without the folder_type column

  // Step 1: Create new table without folder_type
  db.exec(`
    CREATE TABLE watched_folders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      auto_scan INTEGER DEFAULT 1,
      scan_interval INTEGER DEFAULT 60,
      recursive INTEGER DEFAULT 1,
      exclude_extensions TEXT,
      exclude_patterns TEXT,
      is_active INTEGER DEFAULT 1,
      last_scan_date TEXT,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,
      watcher_enabled INTEGER DEFAULT 0,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now'))
    )
  `);

  // Step 2: Copy data from old table (excluding folder_type)
  db.exec(`
    INSERT INTO watched_folders_new (
      id, folder_path, folder_name, auto_scan, scan_interval,
      recursive, exclude_extensions, exclude_patterns, is_active,
      last_scan_date, last_scan_status, last_scan_found, last_scan_error,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event,
      created_date, updated_date
    )
    SELECT
      id, folder_path, folder_name, auto_scan, scan_interval,
      recursive, exclude_extensions, exclude_patterns, is_active,
      last_scan_date, last_scan_status, last_scan_found, last_scan_error,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event,
      created_date, updated_date
    FROM watched_folders
  `);

  // Step 3: Drop old table
  db.exec('DROP TABLE watched_folders');

  // Step 4: Rename new table
  db.exec('ALTER TABLE watched_folders_new RENAME TO watched_folders');

  // Step 5: Recreate indexes (excluding idx_folders_type)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_active
    ON watched_folders(is_active);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_scan_status
    ON watched_folders(last_scan_status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_watcher_status
    ON watched_folders(watcher_status);
  `);

  console.log('[Migration 007] ✅ Successfully removed folder_type column');
};

export const down = (db: Database): void => {
  console.log('[Migration 007] Rolling back folder_type removal...');

  // Note: This rollback recreates the column but all values will be 'scan'

  // Step 1: Create table with folder_type
  db.exec(`
    CREATE TABLE watched_folders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      folder_type TEXT DEFAULT 'scan',
      auto_scan INTEGER DEFAULT 1,
      scan_interval INTEGER DEFAULT 60,
      recursive INTEGER DEFAULT 1,
      exclude_extensions TEXT,
      exclude_patterns TEXT,
      is_active INTEGER DEFAULT 1,
      last_scan_date TEXT,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,
      watcher_enabled INTEGER DEFAULT 0,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now'))
    )
  `);

  // Step 2: Copy data back (folder_type will default to 'scan')
  db.exec(`
    INSERT INTO watched_folders_new (
      id, folder_path, folder_name, folder_type, auto_scan, scan_interval,
      recursive, exclude_extensions, exclude_patterns, is_active,
      last_scan_date, last_scan_status, last_scan_found, last_scan_error,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event,
      created_date, updated_date
    )
    SELECT
      id, folder_path, folder_name, 'scan', auto_scan, scan_interval,
      recursive, exclude_extensions, exclude_patterns, is_active,
      last_scan_date, last_scan_status, last_scan_found, last_scan_error,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event,
      created_date, updated_date
    FROM watched_folders
  `);

  // Step 3: Drop old table
  db.exec('DROP TABLE watched_folders');

  // Step 4: Rename new table
  db.exec('ALTER TABLE watched_folders_new RENAME TO watched_folders');

  // Step 5: Recreate all indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_active
    ON watched_folders(is_active);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_scan_status
    ON watched_folders(last_scan_status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_type
    ON watched_folders(folder_type);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_watcher_status
    ON watched_folders(watcher_status);
  `);

  console.log('[Migration 007] ⚠️ Rolled back (all folder_type values set to "scan")');
};

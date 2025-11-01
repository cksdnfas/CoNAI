import Database from 'better-sqlite3';
import { SUPPORTED_IMAGE_EXTENSIONS } from '../../constants/supportedExtensions';

/**
 * Migration: Change file_extensions (include list) to exclude_extensions (exclude list)
 *
 * This migration changes the folder scanning behavior from:
 * - OLD: User specifies which extensions TO scan (include list)
 * - NEW: System scans all supported extensions, user specifies which to EXCLUDE (exclude list)
 *
 * Benefits:
 * - More intuitive UX: "exclude what you don't want" vs "include what you want"
 * - Future-proof: Adding video support doesn't require user action
 * - Centralized: Extension support defined in code, not per-folder config
 */

export const up = async (db: Database.Database): Promise<void> => {
  console.log('⏭️  Migration 006: Skipped (already applied in migration 000)');

  // Check if exclude_extensions exists (for legacy databases)
  const tableInfo = db.prepare(`PRAGMA table_info(watched_folders)`).all() as Array<{ name: string }>;
  const hasExcludeExtensions = tableInfo.some(col => col.name === 'exclude_extensions');

  if (hasExcludeExtensions) {
    console.log('  ✅ exclude_extensions column already exists, skipping migration');
    return;
  }

  console.log('🔄 Applying migration 006 for legacy database...');

  // Step 1: Add the new exclude_extensions column
  db.exec(`
    ALTER TABLE watched_folders
    ADD COLUMN exclude_extensions TEXT
  `);

  // Step 2: Migrate existing data
  // Logic: If file_extensions was specified (include list), convert to exclude list
  // by finding which supported extensions are NOT in the include list
  const folders = db.prepare('SELECT id, file_extensions FROM watched_folders').all() as Array<{
    id: number;
    file_extensions: string | null;
  }>;

  const updateStmt = db.prepare('UPDATE watched_folders SET exclude_extensions = ? WHERE id = ?');

  for (const folder of folders) {
    let excludeList: string[] = [];

    if (folder.file_extensions) {
      try {
        const includeList: string[] = JSON.parse(folder.file_extensions);

        // If user had a specific include list, calculate which supported extensions to exclude
        if (includeList.length > 0) {
          // Normalize include list (lowercase, ensure leading dot)
          const normalizedInclude = includeList.map(ext =>
            ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
          );

          // Find supported extensions NOT in the include list
          excludeList = SUPPORTED_IMAGE_EXTENSIONS.filter(
            ext => !normalizedInclude.includes(ext)
          );
        }
        // If include list was empty array [], treat as "scan all" (no exclusions)
      } catch (error) {
        console.warn(`Failed to parse file_extensions for folder ${folder.id}:`, error);
        // On parse error, default to no exclusions (scan all)
      }
    }
    // If file_extensions was null, default to no exclusions (scan all)

    // Update the folder with exclude list (empty array if no exclusions)
    updateStmt.run(JSON.stringify(excludeList), folder.id);
  }

  // Step 3: Drop the old file_extensions column
  // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
  db.exec(`
    -- Create new table without file_extensions
    CREATE TABLE watched_folders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      folder_type TEXT DEFAULT 'scan',
      auto_scan INTEGER DEFAULT 0,
      scan_interval INTEGER DEFAULT 60,
      recursive INTEGER DEFAULT 1,
      exclude_extensions TEXT,
      exclude_patterns TEXT,
      is_active INTEGER DEFAULT 1,
      last_scan_date DATETIME,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      watcher_enabled INTEGER DEFAULT 0,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event DATETIME
    );

    -- Copy data from old table to new table
    INSERT INTO watched_folders_new (
      id, folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive,
      exclude_extensions, exclude_patterns, is_active, last_scan_date, last_scan_status,
      last_scan_found, last_scan_error, created_date, updated_date,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event
    )
    SELECT
      id, folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive,
      exclude_extensions, exclude_patterns, is_active, last_scan_date, last_scan_status,
      last_scan_found, last_scan_error, created_date, updated_date,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event
    FROM watched_folders;

    -- Drop old table
    DROP TABLE watched_folders;

    -- Rename new table to original name
    ALTER TABLE watched_folders_new RENAME TO watched_folders;

    -- Recreate indexes
    CREATE INDEX IF NOT EXISTS idx_watched_folders_path ON watched_folders(folder_path);
    CREATE INDEX IF NOT EXISTS idx_watched_folders_is_active ON watched_folders(is_active);
    CREATE INDEX IF NOT EXISTS idx_watched_folders_folder_type ON watched_folders(folder_type);
    CREATE INDEX IF NOT EXISTS idx_watched_folders_watcher_enabled ON watched_folders(watcher_enabled);
  `);

  console.log('Migration 006 completed: exclude_extensions column added, file_extensions removed');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('Rolling back migration 006: Restore file_extensions from exclude_extensions');

  // Step 1: Add back file_extensions column
  db.exec(`
    ALTER TABLE watched_folders
    ADD COLUMN file_extensions TEXT
  `);

  // Step 2: Migrate data back
  // Convert exclude list back to include list
  const folders = db.prepare('SELECT id, exclude_extensions FROM watched_folders').all() as Array<{
    id: number;
    exclude_extensions: string | null;
  }>;

  const updateStmt = db.prepare('UPDATE watched_folders SET file_extensions = ? WHERE id = ?');

  for (const folder of folders) {
    let includeList: string[] = [];

    if (folder.exclude_extensions) {
      try {
        const excludeList: string[] = JSON.parse(folder.exclude_extensions);

        // If there were exclusions, include list is all supported extensions EXCEPT excluded ones
        if (excludeList.length > 0) {
          const normalizedExclude = excludeList.map(ext =>
            ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
          );

          includeList = SUPPORTED_IMAGE_EXTENSIONS.filter(
            ext => !normalizedExclude.includes(ext)
          );
        } else {
          // No exclusions means scan all = include all supported extensions
          includeList = [...SUPPORTED_IMAGE_EXTENSIONS];
        }
      } catch (error) {
        console.warn(`Failed to parse exclude_extensions for folder ${folder.id}:`, error);
        // On error, default to all supported extensions
        includeList = [...SUPPORTED_IMAGE_EXTENSIONS];
      }
    } else {
      // null = scan all = include all supported extensions
      includeList = [...SUPPORTED_IMAGE_EXTENSIONS];
    }

    updateStmt.run(JSON.stringify(includeList), folder.id);
  }

  // Step 3: Drop exclude_extensions column (recreate table)
  db.exec(`
    -- Create new table with file_extensions
    CREATE TABLE watched_folders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      folder_type TEXT DEFAULT 'scan',
      auto_scan INTEGER DEFAULT 0,
      scan_interval INTEGER DEFAULT 60,
      recursive INTEGER DEFAULT 1,
      file_extensions TEXT,
      exclude_patterns TEXT,
      is_active INTEGER DEFAULT 1,
      last_scan_date DATETIME,
      last_scan_status TEXT,
      last_scan_found INTEGER DEFAULT 0,
      last_scan_error TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      watcher_enabled INTEGER DEFAULT 0,
      watcher_status TEXT,
      watcher_error TEXT,
      watcher_last_event DATETIME
    );

    -- Copy data
    INSERT INTO watched_folders_new (
      id, folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive,
      file_extensions, exclude_patterns, is_active, last_scan_date, last_scan_status,
      last_scan_found, last_scan_error, created_date, updated_date,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event
    )
    SELECT
      id, folder_path, folder_name, folder_type, auto_scan, scan_interval, recursive,
      file_extensions, exclude_patterns, is_active, last_scan_date, last_scan_status,
      last_scan_found, last_scan_error, created_date, updated_date,
      watcher_enabled, watcher_status, watcher_error, watcher_last_event
    FROM watched_folders;

    -- Drop old table
    DROP TABLE watched_folders;

    -- Rename
    ALTER TABLE watched_folders_new RENAME TO watched_folders;

    -- Recreate indexes
    CREATE INDEX IF NOT EXISTS idx_watched_folders_path ON watched_folders(folder_path);
    CREATE INDEX IF NOT EXISTS idx_watched_folders_is_active ON watched_folders(is_active);
    CREATE INDEX IF NOT EXISTS idx_watched_folders_folder_type ON watched_folders(folder_type);
    CREATE INDEX IF NOT EXISTS idx_watched_folders_watcher_enabled ON watched_folders(watcher_enabled);
  `);

  console.log('Migration 006 rollback completed: file_extensions restored');
};

import Database from 'better-sqlite3';

/**
 * Add watcher_polling_interval column to watched_folders table
 * This allows configurable polling intervals for network drives and slower file systems
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔧 Adding watcher_polling_interval column to watched_folders...');

  // Check if column already exists
  const tableInfo = db.pragma('table_info(watched_folders)') as Array<{ name: string }>;
  const columnExists = tableInfo.some((col) => col.name === 'watcher_polling_interval');

  if (!columnExists) {
    db.exec(`
      ALTER TABLE watched_folders
      ADD COLUMN watcher_polling_interval INTEGER DEFAULT NULL
    `);
    console.log('  ✅ watcher_polling_interval column added (default: NULL = auto-detect)');
  } else {
    console.log('  ⏭️  Column already exists, skipping...');
  }

  console.log('✅ Migration complete\n');
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('⚠️  Rolling back watcher_polling_interval column...');

  // SQLite doesn't support DROP COLUMN directly in older versions
  // This would require recreating the table, which is risky
  // For now, we'll just log a warning
  console.log('  ⚠️  SQLite does not support DROP COLUMN easily.');
  console.log('  ⚠️  Manual intervention required if rollback is needed.');
  console.log('  ⚠️  Consider recreating the table or leaving the column as-is.');
};

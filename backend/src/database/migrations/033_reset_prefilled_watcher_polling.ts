import type { Database } from 'better-sqlite3';

/**
 * Reset UI-prefilled watcher polling intervals back to auto-detect.
 *
 * The folder/backup-source settings forms unconditionally prefilled
 * `watcher_polling_interval` with 2000 and persisted it on every create/save,
 * so effectively every row opted into chokidar polling mode. Polling installs
 * an fs.watchFile stat timer per file, re-statting the entire tree every
 * interval — on large libraries that permanently saturates the libuv thread
 * pool right after startup and the whole web UI crawls.
 *
 * Only rows carrying exactly the prefill value (2000) are reset to NULL
 * (= auto-detect: native events locally, polling on network paths). Any other
 * value was typed deliberately and is preserved.
 */
export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 033_reset_prefilled_watcher_polling.ts');

  const watchedFolders = db.prepare(`
    UPDATE watched_folders
    SET watcher_polling_interval = NULL
    WHERE watcher_polling_interval = 2000
  `).run();

  const backupSources = db.prepare(`
    UPDATE backup_sources
    SET watcher_polling_interval = NULL
    WHERE watcher_polling_interval = 2000
  `).run();

  console.log(`✅ Reset prefilled watcher polling intervals to auto-detect (watched_folders: ${watchedFolders.changes}, backup_sources: ${backupSources.changes})`);
};

export const down = async (_db: Database): Promise<void> => {
  // The prefill value carried no user intent, so there is nothing meaningful to restore.
  console.log('⏭️  033_reset_prefilled_watcher_polling has no rollback (prefilled values carried no intent)');
};

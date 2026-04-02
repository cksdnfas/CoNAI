import { db } from '../../database/init';

export interface WatchedFolderWatcherRecord {
  id: number;
  folder_path: string;
  folder_name: string;
  recursive: number;
  exclude_extensions: string | null;
  exclude_patterns: string | null;
  watcher_enabled?: number;
  watcher_polling_interval?: number | null;
}

/** Load all active auto-scan folders that may start a watcher during service initialization. */
export function listAutoScanWatcherFolders(): WatchedFolderWatcherRecord[] {
  return db.prepare(`
    SELECT id, folder_path, folder_name, recursive,
           exclude_extensions, exclude_patterns, watcher_enabled,
           watcher_polling_interval
    FROM watched_folders
    WHERE is_active = 1 AND auto_scan = 1
  `).all() as WatchedFolderWatcherRecord[];
}

/** Load one watched-folder record needed to build a watcher instance. */
export function findWatchedFolderForWatcher(folderId: number): WatchedFolderWatcherRecord | null {
  return db.prepare(`
    SELECT id, folder_path, folder_name, recursive,
           exclude_extensions, exclude_patterns, watcher_polling_interval
    FROM watched_folders
    WHERE id = ? AND is_active = 1
  `).get(folderId) as WatchedFolderWatcherRecord | null;
}

/** Disable one watcher in the DB after a startup or retry failure. */
export function disableWatcherInDatabase(folderId: number, errorMessage: string): void {
  db.prepare(`
    UPDATE watched_folders
    SET watcher_enabled = 0,
        watcher_status = 'error',
        watcher_error = ?
    WHERE id = ?
  `).run(errorMessage, folderId);
}

/** Persist one watcher runtime status snapshot into watched_folders. */
export function updateWatcherStatusInDatabase(folderId: number, status: string, error: string | null): void {
  db.prepare(`
    UPDATE watched_folders
    SET watcher_status = ?,
        watcher_error = ?
    WHERE id = ?
  `).run(status, error, folderId);
}

/** Persist the most recent watcher event timestamp. */
export function updateWatcherLastEventInDatabase(folderId: number, lastEventIso: string): void {
  db.prepare(`
    UPDATE watched_folders
    SET watcher_last_event = ?
    WHERE id = ?
  `).run(lastEventIso, folderId);
}

/** Mark one tracked file as missing after an unlink event. */
export function markWatchedFileMissing(filePath: string, lastVerifiedIso: string): number {
  const result = db.prepare(`
    UPDATE image_files
    SET file_status = 'missing',
        last_verified_date = ?
    WHERE original_file_path = ?
  `).run(lastVerifiedIso, filePath);

  return result.changes;
}

/** Check whether a watched folder still exists in the DB before a deferred batch scan runs. */
export function watchedFolderExists(folderId: number): boolean {
  const row = db.prepare('SELECT id FROM watched_folders WHERE id = ?').get(folderId);
  return Boolean(row);
}

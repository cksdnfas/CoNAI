import { resolveUploadsPath } from '../config/runtimePaths';
import { db } from '../database/init';
import type { FileType } from '../types/image';
import { checkDirectoryAccess, checkFileReadAccess } from '../utils/fileAccess';
import { resolveFolderPath } from '../utils/pathResolver';

export interface WatchedFileSnapshot {
  id: number;
  original_file_path: string;
  folder_id: number;
  folder_path: string;
  composite_hash: string | null;
  file_type: FileType;
  file_status: string;
  mime_type: string;
  file_size: number;
  file_modified_date: string | null;
  last_verified_date: string | null;
  thumbnail_path: string | null;
}

export const SELECT_WATCHED_FILE = `SELECT f.id, f.original_file_path, f.folder_id, wf.folder_path, f.composite_hash,
  f.file_type, f.file_status, f.mime_type, f.file_size, f.file_modified_date, f.last_verified_date, mm.thumbnail_path
  FROM image_files f JOIN watched_folders wf ON wf.id = f.folder_id
  LEFT JOIN media_metadata mm ON mm.composite_hash = f.composite_hash`;

// A scan can relink this very id while a watcher or verification page waits on the filesystem.
export const SAME_WATCHED_FILE = `id = @id AND original_file_path = @original_file_path AND folder_id = @folder_id
  AND composite_hash IS @composite_hash AND file_type = @file_type AND file_status = @file_status
  AND mime_type = @mime_type AND file_size = @file_size AND file_modified_date IS @file_modified_date
  AND last_verified_date IS @last_verified_date
  AND EXISTS (SELECT 1 FROM watched_folders WHERE id = @folder_id AND folder_path = @folder_path)`;

const checkingRoots = new Map<string, Promise<boolean>>();

/** Share simultaneous probes during a burst of unlink events, never cache availability across events. */
export function canConfirmMissingFiles(folderPath: string): Promise<boolean> {
  const inFlight = checkingRoots.get(folderPath);
  if (inFlight) return inFlight;
  const checking = checkDirectoryAccess(resolveFolderPath(folderPath))
    .then(access => access.readable && !access.error)
    .finally(() => checkingRoots.delete(folderPath));
  checkingRoots.set(folderPath, checking);
  return checking;
}

export async function originalIsMissing(file: WatchedFileSnapshot): Promise<boolean> {
  return !(await checkFileReadAccess(resolveUploadsPath(file.original_file_path))).exists;
}

/** Reconcile an event with the current disk and DB, not just the pathname delivered by the watcher/worker. */
export async function reconcileWatchedUnlink(
  folderId: number, filePath: string, options: { pendingId?: number; isCurrent?: () => boolean } = {},
): Promise<'deleted' | 'unchanged' | 'offline'> {
  const file = db.prepare(`${SELECT_WATCHED_FILE} WHERE f.folder_id = ? AND f.original_file_path = ?`)
    .get(folderId, filePath) as WatchedFileSnapshot | undefined;
  if (!file || (options.pendingId !== undefined
    && (file.id !== options.pendingId || file.composite_hash !== null || file.file_status !== 'active'))) return 'unchanged';
  if (!await originalIsMissing(file)) return 'unchanged';
  if (!await canConfirmMissingFiles(file.folder_path)) return 'offline';
  if (!await originalIsMissing(file) || options.isCurrent?.() === false) return 'unchanged';
  return db.prepare(`DELETE FROM image_files WHERE ${SAME_WATCHED_FILE}`).run(file).changes ? 'deleted' : 'unchanged';
}

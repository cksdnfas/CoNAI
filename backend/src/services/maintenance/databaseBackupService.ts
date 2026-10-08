import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { runtimePaths } from '../../config/runtimePaths';

/**
 * Online, consistent copies of the SQLite databases.
 *
 * Copying a WAL database file while the app runs can produce a torn or stale copy, so this uses the SQLite backup
 * API through better-sqlite3 (`db.backup`). It copies page batches between event-loop turns; the progress callback
 * keeps each batch small so requests keep flowing during a multi-GB copy.
 *
 * Layout: `<databaseDir>/backups/<YYYYMMDD-HHMMSS>/{images,user,auth}.db`. A run writes into `<stamp>.partial`
 * first and renames it when every file is done, so a failed run never counts as a backup. Retention only ever
 * touches folders with that exact stamp name — hand-made copies in the same folder are left alone.
 */

const BACKUP_DIR_PATTERN = /^\d{8}-\d{6}$/;
const PARTIAL_SUFFIX = '.partial';
/** Pages per backup step (4KiB pages → ~1MiB per event-loop turn). */
const PAGES_PER_STEP = 256;

export const DEFAULT_DATABASE_BACKUP_KEEP = 7;

export interface DatabaseBackupSource {
  /** File name inside the backup folder, e.g. `images.db`. */
  fileName: string;
  db: Database.Database;
}

export interface DatabaseBackupFileResult {
  fileName: string;
  bytes: number;
  totalPages: number;
}

export interface DatabaseBackupResult {
  name: string;
  path: string;
  files: DatabaseBackupFileResult[];
  removed: string[];
  durationMs: number;
}

export interface DatabaseBackupEntry {
  name: string;
  createdAt: string;
  totalBytes: number;
  files: Array<{ fileName: string; bytes: number }>;
}

export interface DatabaseBackupHooks {
  /** Per-file progress; `pageSize` turns pages into bytes for "user.db · 412 / 1,024 MB". */
  progress?: (fileName: string, totalPages: number, remainingPages: number, pageSize: number) => void;
  throwIfCancelled?: () => void;
}

export function getDatabaseBackupRoot(): string {
  return path.join(runtimePaths.databaseDir, 'backups');
}

function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseStamp(name: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name);
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

/** Resolve the default sources lazily so importing this module never opens a database. */
export async function resolveDefaultBackupSources(): Promise<DatabaseBackupSource[]> {
  const { db } = await import('../../database/init');
  const { getUserSettingsDb } = await import('../../database/userSettingsDb');
  const { getAuthDb } = await import('../../database/authDb');

  const sources: DatabaseBackupSource[] = [{ fileName: 'images.db', db }];
  for (const [fileName, open] of [['user.db', getUserSettingsDb], ['auth.db', getAuthDb]] as const) {
    try {
      sources.push({ fileName, db: open() });
    } catch {
      // Not initialised in this process (e.g. auth disabled): nothing to copy.
    }
  }
  return sources;
}

export function listDatabaseBackups(root: string = getDatabaseBackupRoot()): DatabaseBackupEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && BACKUP_DIR_PATTERN.test(entry.name))
    .map((entry) => {
      const dir = path.join(root, entry.name);
      const files = fs.readdirSync(dir)
        .filter((name) => name.endsWith('.db'))
        .map((fileName) => ({ fileName, bytes: fs.statSync(path.join(dir, fileName)).size }));
      return {
        name: entry.name,
        createdAt: (parseStamp(entry.name) ?? new Date(0)).toISOString(),
        totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        files,
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Keep the newest `keep` stamped backups; also clears `.partial` leftovers of crashed runs. */
export function pruneDatabaseBackups(keep: number, root: string = getDatabaseBackupRoot()): string[] {
  const removed: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return removed;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(PARTIAL_SUFFIX) && BACKUP_DIR_PATTERN.test(entry.name.slice(0, -PARTIAL_SUFFIX.length))) {
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    }
  }

  const backups = listDatabaseBackups(root);
  for (const backup of backups.slice(Math.max(1, Math.floor(keep)))) {
    fs.rmSync(path.join(root, backup.name), { recursive: true, force: true });
    removed.push(backup.name);
  }

  return removed;
}

export class DatabaseBackupNotFoundError extends Error {}
export class DatabaseBackupBusyError extends Error {}

/**
 * The folder of one finished backup, or DatabaseBackupNotFoundError. Only exact stamp names the list returns qualify:
 * no `.partial`, no traversal, no links standing in for the folder.
 */
export function resolveDatabaseBackupDir(stamp: unknown, root: string = getDatabaseBackupRoot()): string {
  if (typeof stamp !== 'string' || !BACKUP_DIR_PATTERN.test(stamp)) {
    throw new DatabaseBackupNotFoundError('Backup not found');
  }
  const dir = path.join(root, stamp);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    throw new DatabaseBackupNotFoundError('Backup not found');
  }
  if (!stat.isDirectory()) {
    throw new DatabaseBackupNotFoundError('Backup not found');
  }
  return dir;
}

/** The `.db` files of one finished backup (regular files only), for download. */
export function listDatabaseBackupFiles(stamp: unknown, root: string = getDatabaseBackupRoot()): Array<{ fileName: string; absolutePath: string }> {
  const dir = resolveDatabaseBackupDir(stamp, root);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.db'))
    .map((entry) => ({ fileName: entry.name, absolutePath: path.join(dir, entry.name) }));
}

/** Delete one finished backup. Refused while a backup runs, so a run never prunes or races a folder in use. */
export function deleteDatabaseBackup(stamp: unknown, root: string = getDatabaseBackupRoot()): void {
  if (isDatabaseBackupRunning()) {
    throw new DatabaseBackupBusyError('A database backup is running');
  }
  const dir = resolveDatabaseBackupDir(stamp, root);
  fs.rmSync(dir, { recursive: true, force: true });
}

let backupInFlight: Promise<DatabaseBackupResult> | null = null;

export function isDatabaseBackupRunning(): boolean {
  return backupInFlight !== null;
}

/** Wait for a running backup to finish; shutdown calls this before closing the connections. */
export async function waitForDatabaseBackup(): Promise<void> {
  try {
    await backupInFlight;
  } catch {
    // The run already logged its own failure.
  }
}

export async function runDatabaseBackup(options: {
  keep?: number;
  root?: string;
  sources?: DatabaseBackupSource[];
  now?: Date;
  hooks?: DatabaseBackupHooks;
} = {}): Promise<DatabaseBackupResult> {
  if (backupInFlight) {
    throw new Error('A database backup is already running');
  }

  backupInFlight = (async () => {
    const startedAt = Date.now();
    const root = options.root ?? getDatabaseBackupRoot();
    const sources = options.sources ?? await resolveDefaultBackupSources();
    let name = formatStamp(options.now ?? new Date());
    // Two runs in the same second (manual + schedule) must not collide.
    while (fs.existsSync(path.join(root, name)) || fs.existsSync(path.join(root, `${name}${PARTIAL_SUFFIX}`))) {
      name = formatStamp(new Date(parseStamp(name)!.getTime() + 1000));
    }

    const partialDir = path.join(root, `${name}${PARTIAL_SUFFIX}`);
    const finalDir = path.join(root, name);
    fs.mkdirSync(partialDir, { recursive: true });

    const files: DatabaseBackupFileResult[] = [];
    try {
      for (const source of sources) {
        options.hooks?.throwIfCancelled?.();
        const target = path.join(partialDir, source.fileName);
        const pageSize = Number(source.db.pragma('page_size', { simple: true })) || 4096;
        const progress = await source.db.backup(target, {
          progress: ({ totalPages, remainingPages }) => {
            options.hooks?.progress?.(source.fileName, totalPages, remainingPages, pageSize);
            options.hooks?.throwIfCancelled?.();
            return PAGES_PER_STEP;
          },
        });
        // The callback runs before each step, so the last step is never reported: close the file at 100%.
        options.hooks?.progress?.(source.fileName, progress.totalPages, 0, pageSize);
        files.push({ fileName: source.fileName, bytes: fs.statSync(target).size, totalPages: progress.totalPages });
      }

      fs.renameSync(partialDir, finalDir);
    } catch (error) {
      fs.rmSync(partialDir, { recursive: true, force: true });
      throw error;
    }

    const removed = pruneDatabaseBackups(options.keep ?? DEFAULT_DATABASE_BACKUP_KEEP, root);
    const durationMs = Date.now() - startedAt;
    const totalMb = files.reduce((sum, file) => sum + file.bytes, 0) / (1024 * 1024);
    console.log(`💾 Database backup ${name}: ${files.map((file) => file.fileName).join(', ')} (${totalMb.toFixed(1)}MB) in ${(durationMs / 1000).toFixed(1)}s${removed.length > 0 ? `, pruned ${removed.length}` : ''}`);

    return { name, path: finalDir, files, removed, durationMs };
  })();

  try {
    return await backupInFlight;
  } finally {
    backupInFlight = null;
  }
}

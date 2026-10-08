import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { StoredFileEntry, SystemFolderBatchResult, SystemFolderEntry, SystemFolderFailureCode, SystemFolderListing, SystemFolderRoot, SystemFolderRootId } from '@conai/shared';
import { runtimePaths } from '../config/runtimePaths';
import {
  RECYCLE_BIN_PATH,
  forgetMissingRecycleBinOrigins,
  forgetRecycleBinOrigins,
  moveFileWithoutReplacing,
  parseRecycleBinFileName,
  readRecycleBinOrigins,
  unlinkWithTransientLockRetry,
  type RecycleBinOrigin,
} from '../utils/recycleBin';
import { fileStoreRoot } from './fileStorePaths';
import { filePreviewMime, renderPreviewWebp } from './fileStorePreview';

/**
 * Administrator view of server folders (RecycleBin, uploads, save, temp, logs) next to the file store.
 * Paths from requests are `/`-separated names inside one root; every step is checked so a request can never leave
 * its root, follow a link or junction, or reach the databases and the private file store.
 */
export class SystemFolderError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: SystemFolderFailureCode) { super(message); }
}

type RootDefinition = { directory: () => string; mode: SystemFolderRoot['mode'] };

const ROOTS: Record<SystemFolderRootId, RootDefinition> = {
  'recycle-bin': { directory: () => RECYCLE_BIN_PATH, mode: 'recycle' },
  uploads: { directory: () => runtimePaths.uploadsDir, mode: 'read-only' },
  save: { directory: () => runtimePaths.saveDir, mode: 'read-only' },
  temp: { directory: () => runtimePaths.tempDir, mode: 'read-only' },
  logs: { directory: () => runtimePaths.logsDir, mode: 'read-only' },
};
const ROOT_IDS = Object.keys(ROOTS) as SystemFolderRootId[];
export const SYSTEM_FOLDER_PAGE_LIMIT = 500;
const MAX_BATCH = 1000;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.txt': 'text/plain', '.log': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.jsonl': 'application/json',
  '.csv': 'text/csv', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.pdf': 'application/pdf', '.zip': 'application/zip',
};

function guessMime(name: string): string | null {
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? null;
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function realOrResolved(target: string): string {
  try { return fs.realpathSync(target); } catch { return path.resolve(target); }
}

/** Never browsable even when a root contains them: the SQLite databases and the private per-account file store. */
function deniedAreas(): string[] {
  return [runtimePaths.databaseDir, fileStoreRoot].map(realOrResolved);
}

/** Inside a denied area. Its parent folders stay browsable; listings leave the area itself out. */
function isDenied(candidate: string, denied = deniedAreas()): boolean {
  return denied.some((area) => within(area, candidate));
}

export function parseRootId(value: unknown): SystemFolderRootId {
  if (typeof value !== 'string' || !ROOT_IDS.includes(value as SystemFolderRootId)) throw new SystemFolderError('알 수 없는 폴더야.', 404);
  return value as SystemFolderRootId;
}

/** One name inside a root: no separators, traversal, drive or stream syntax, or control characters. */
function parseSegment(value: string): string {
  if (!value || value === '.' || value === '..' || Buffer.byteLength(value, 'utf8') > 255
    || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value)) {
    throw new SystemFolderError('잘못된 경로야.');
  }
  return value;
}

export function parseRelativePath(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string' || value.length > 2048) throw new SystemFolderError('잘못된 경로야.');
  return value.split('/').map(parseSegment);
}

export function parseNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH) throw new SystemFolderError(`항목을 1~${MAX_BATCH}개 골라줘.`);
  return [...new Set(value.map((name) => {
    if (typeof name !== 'string') throw new SystemFolderError('잘못된 이름이야.');
    return parseSegment(name);
  }))];
}

type Resolved = { absolute: string; stat: fs.Stats; segments: string[] };

function rootDirectory(rootId: SystemFolderRootId): string {
  const directory = ROOTS[rootId].directory();
  if (!fs.existsSync(directory)) throw new SystemFolderError('이 폴더는 아직 없어.', 404);
  return fs.realpathSync(directory);
}

/** Walk from the root one name at a time with lstat, so no link or junction anywhere below the root is followed. */
function resolveInRoot(rootId: SystemFolderRootId, segments: string[]): Resolved {
  const root = rootDirectory(rootId);
  const denied = deniedAreas();
  let current = root;
  let stat = fs.lstatSync(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    try { stat = fs.lstatSync(current); } catch { throw new SystemFolderError('파일이나 폴더를 찾을 수 없어.', 404); }
    if (stat.isSymbolicLink()) throw new SystemFolderError('링크는 열 수 없어.', 403);
  }
  if (!within(root, fs.realpathSync(current)) || isDenied(current, denied)) throw new SystemFolderError('이 경로는 열 수 없어.', 403);
  if (!stat.isFile() && !stat.isDirectory()) throw new SystemFolderError('파일이나 폴더가 아니야.', 403);
  return { absolute: current, stat, segments };
}

function resolveFile(rootId: SystemFolderRootId, segments: string[]): Resolved {
  const resolved = resolveInRoot(rootId, segments);
  if (!resolved.stat.isFile()) throw new SystemFolderError('파일이 아니야.');
  return resolved;
}

type DirectoryName = { name: string; folder: boolean };
/** Sorted names per directory, reused until the directory changes; the RecycleBin can hold 100k+ files. */
const listingCache = new Map<string, { mtimeMs: number; order: 'asc' | 'desc'; names: DirectoryName[] }>();
const LISTING_CACHE_SIZE = 16;

async function directoryNames(directory: string, order: 'asc' | 'desc'): Promise<DirectoryName[]> {
  const mtimeMs = (await fs.promises.stat(directory)).mtimeMs;
  const cached = listingCache.get(directory);
  if (cached && cached.mtimeMs === mtimeMs && cached.order === order) return cached.names;
  const denied = deniedAreas();
  const names: DirectoryName[] = [];
  for (const dirent of await fs.promises.readdir(directory, { withFileTypes: true })) {
    // Links, devices and sockets are left out; so is anything inside the databases or the private file store.
    if (!dirent.isFile() && !dirent.isDirectory()) continue;
    if (dirent.isDirectory() && isDenied(path.join(directory, dirent.name), denied)) continue;
    names.push({ name: dirent.name, folder: dirent.isDirectory() });
  }
  const direction = order === 'asc' ? 1 : -1;
  // Folders first; RecycleBin and upload names start with a timestamp, so name order is time order.
  names.sort((left, right) => (left.folder !== right.folder ? (left.folder ? -1 : 1) : left.name < right.name ? -direction : left.name > right.name ? direction : 0));
  listingCache.delete(directory);
  listingCache.set(directory, { mtimeMs, order, names });
  while (listingCache.size > LISTING_CACHE_SIZE) listingCache.delete(listingCache.keys().next().value as string);
  return names;
}

function recycleInfo(name: string, origin: RecycleBinOrigin | undefined) {
  const parsed = parseRecycleBinFileName(name);
  return {
    originalName: origin ? path.basename(origin.originalPath) : parsed.originalName,
    originalPath: origin?.originalPath ?? null,
    deletedAt: origin?.deletedAt ?? parsed.deletedAt,
    source: origin?.source ?? null,
    restorable: origin !== undefined,
  };
}

function toEntry(rootId: SystemFolderRootId, segments: string[], name: string, stat: fs.Stats, origins?: Map<string, RecycleBinOrigin>): SystemFolderEntry {
  const folder = stat.isDirectory();
  const entry: SystemFolderEntry = {
    name,
    path: [...segments, name].join('/'),
    kind: folder ? 'folder' : 'file',
    size: folder ? 0 : stat.size,
    modifiedAt: stat.mtime.toISOString(),
    mimeType: folder ? null : guessMime(name),
  };
  if (rootId === 'recycle-bin' && segments.length === 0 && !folder && origins) entry.recycle = recycleInfo(name, origins.get(name));
  return entry;
}

export const SystemFolderService = {
  roots(): SystemFolderRoot[] {
    return ROOT_IDS.map((id) => ({ id, mode: ROOTS[id].mode, available: fs.existsSync(ROOTS[id].directory()) }));
  },

  async list(rootId: SystemFolderRootId, segments: string[], offset: number, limit: number, order: 'asc' | 'desc' = 'desc'): Promise<SystemFolderListing> {
    const folder = resolveInRoot(rootId, segments);
    if (!folder.stat.isDirectory()) throw new SystemFolderError('폴더가 아니야.');
    const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, SYSTEM_FOLDER_PAGE_LIMIT) : 100;
    const names = await directoryNames(folder.absolute, order);
    const page = names.slice(safeOffset, safeOffset + safeLimit);
    const stats = await Promise.all(page.map(async ({ name }) => {
      try {
        const stat = await fs.promises.lstat(path.join(folder.absolute, name));
        return stat.isFile() || stat.isDirectory() ? { name, stat } : null;
      } catch {
        return null; // Removed since the directory was read.
      }
    }));
    const present = stats.filter((item): item is { name: string; stat: fs.Stats } => item !== null);
    const origins = rootId === 'recycle-bin' && segments.length === 0 ? readRecycleBinOrigins(present.map((item) => item.name)) : undefined;
    return {
      root: rootId,
      path: segments.join('/'),
      breadcrumbs: segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') })),
      entries: present.map(({ name, stat }) => toEntry(rootId, segments, name, stat, origins)),
      total: names.length,
      offset: safeOffset,
      limit: safeLimit,
    };
  },

  stat(rootId: SystemFolderRootId, segments: string[]): SystemFolderEntry {
    if (segments.length === 0) throw new SystemFolderError('파일이나 폴더를 골라줘.');
    const resolved = resolveInRoot(rootId, segments);
    const parent = segments.slice(0, -1);
    const name = segments[segments.length - 1];
    const origins = rootId === 'recycle-bin' && parent.length === 0 ? readRecycleBinOrigins([name]) : undefined;
    return toEntry(rootId, parent, name, resolved.stat, origins);
  },

  /** File to stream inline: only types the browser can show inertly (images, video, audio, PDF, plain text). */
  async resolveView(rootId: SystemFolderRootId, segments: string[]): Promise<{ absolute: string; name: string; size: number; mime: string }> {
    const { absolute, stat } = resolveFile(rootId, segments);
    const name = segments[segments.length - 1];
    const mime = await filePreviewMime({ name, mimeType: guessMime(name) } as StoredFileEntry, absolute);
    if (!mime) throw new SystemFolderError('미리 볼 수 없는 형식이야.', 415);
    return { absolute, name, size: stat.size, mime };
  },

  resolveDownload(rootId: SystemFolderRootId, segments: string[]): { absolute: string; name: string } {
    const { absolute } = resolveFile(rootId, segments);
    return { absolute, name: segments[segments.length - 1] };
  },

  /** Cached 320px WebP of an image or video, kept in the private store (temp is served publicly). */
  async thumbnail(rootId: SystemFolderRootId, segments: string[]): Promise<string> {
    const view = await this.resolveView(rootId, segments);
    if (!view.mime.startsWith('image/') && !view.mime.startsWith('video/')) throw new SystemFolderError('썸네일이 없는 형식이야.', 404);
    const stat = fs.statSync(view.absolute);
    const key = crypto.createHash('sha256').update(`${view.absolute}\0${stat.size}\0${stat.mtimeMs}`).digest('hex').slice(0, 40);
    const directory = path.join(fileStoreRoot, '.system-thumbs');
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new SystemFolderError('썸네일 폴더가 링크야.', 500);
    const cached = path.join(directory, `${key}.webp`);
    if (fs.existsSync(cached)) return cached;
    fs.mkdirSync(directory, { recursive: true });
    const temporary = path.join(directory, `${key}-${crypto.randomUUID()}.webp`);
    try {
      await renderPreviewWebp(view.absolute, view.mime, temporary);
      fs.renameSync(temporary, cached);
      return cached;
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    }
  },

  /**
   * Put RecycleBin files back where they were deleted from. An occupied original location fails the item, or with
   * `rename` gets a free ` (복원 N)` name next to it. Files without a recorded origin cannot be restored.
   */
  async restore(names: string[], conflict: 'fail' | 'rename'): Promise<SystemFolderBatchResult> {
    const result: SystemFolderBatchResult = { done: [], failed: [] };
    const origins = readRecycleBinOrigins(names);
    const binRoot = rootDirectory('recycle-bin');
    const denied = deniedAreas();
    for (const name of names) {
      try {
        const { absolute } = resolveFile('recycle-bin', [name]);
        const origin = origins.get(name);
        if (!origin) throw new SystemFolderError('원래 위치 기록이 없어서 복원할 수 없어.', 409, 'no-origin');
        const original = path.resolve(origin.originalPath);
        const targetDirectory = realOrResolved(path.dirname(original));
        if (isDenied(targetDirectory, denied) || within(binRoot, targetDirectory)) throw new SystemFolderError('이 위치로는 복원할 수 없어.', 403);
        await fs.promises.mkdir(path.dirname(original), { recursive: true });
        // The move itself refuses an occupied name (EEXIST), so a file created after any check is never replaced.
        const restoredTo = await restoreWithoutReplacing(absolute, original, conflict);
        forgetRecycleBinOrigins([name]);
        result.done.push({ name, restoredTo });
      } catch (error) {
        result.failed.push(failure(name, error));
      }
    }
    return result;
  },

  async deletePermanently(names: string[]): Promise<SystemFolderBatchResult> {
    const result: SystemFolderBatchResult = { done: [], failed: [] };
    for (const name of names) {
      try {
        const { absolute } = resolveFile('recycle-bin', [name]);
        await unlinkWithTransientLockRetry(absolute);
        result.done.push({ name });
      } catch (error) {
        result.failed.push(failure(name, error));
      }
    }
    forgetRecycleBinOrigins(result.done.map((item) => item.name));
    return result;
  },

  /**
   * Delete every file at the top of the RecycleBin as it was when emptying started (folders and links are left
   * alone), yielding between chunks. Files deleted into the bin meanwhile stay, with their origins.
   */
  async empty(): Promise<{ deleted: number; failed: number }> {
    const directory = rootDirectory('recycle-bin');
    const deletedNames: string[] = [];
    let failed = 0;
    const dirents = await fs.promises.readdir(directory, { withFileTypes: true });
    for (let index = 0; index < dirents.length; index += 1) {
      const dirent = dirents[index];
      if (!dirent.isFile()) continue;
      try {
        await fs.promises.unlink(path.join(directory, dirent.name));
        deletedNames.push(dirent.name);
      } catch {
        failed += 1;
      }
      if (index % 200 === 199) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    forgetRecycleBinOrigins(deletedNames);
    forgetMissingRecycleBinOrigins(directory);
    return { deleted: deletedNames.length, failed };
  },
};

const isTaken = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';

/** Restore to the original name, or with `rename` to the first free ` (복원 N)` sibling; never over an existing file. */
async function restoreWithoutReplacing(source: string, original: string, conflict: 'fail' | 'rename'): Promise<string> {
  try {
    await moveFileWithoutReplacing(source, original);
    return original;
  } catch (error) {
    if (!isTaken(error)) throw error;
    if (conflict !== 'rename') throw new SystemFolderError('원래 위치에 같은 이름의 파일이 있어.', 409, 'conflict');
  }
  const directory = path.dirname(original);
  const extension = path.extname(original);
  const stem = path.basename(original, extension);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(directory, `${stem} (복원 ${index})${extension}`);
    try {
      await moveFileWithoutReplacing(source, candidate);
      return candidate;
    } catch (error) {
      if (!isTaken(error)) throw error;
    }
  }
  throw new SystemFolderError('복원할 이름을 정하지 못했어.', 409);
}

/** One failed item; `code` lets the client react (e.g. offer rename-on-restore for a conflict). */
function failure(name: string, error: unknown): SystemFolderBatchResult['failed'][number] {
  const code = error instanceof SystemFolderError ? error.code : undefined;
  return code ? { name, error: errorMessage(error), code } : { name, error: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  if (error instanceof SystemFolderError) return error.message;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return '다른 프로그램이 파일을 쓰고 있어.';
  return '처리하지 못했어.';
}

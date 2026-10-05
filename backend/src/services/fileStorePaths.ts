import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

export const fileStoreRoot = path.join(runtimePaths.basePath, 'files');
export const fileStoreIncoming = path.join(fileStoreRoot, '.incoming');
/** Blobs found on disk without a database row during the per-account layout migration. */
export const fileStoreOrphans = path.join(fileStoreRoot, '.orphans');

function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Exclude the whole private store even when a user watches an ancestor directory. */
export function isFileStorePath(candidate: string): boolean {
  return within(path.resolve(fileStoreRoot), path.resolve(candidate));
}

export function ensureFileStoreDirectories(): void {
  fs.mkdirSync(fileStoreRoot, { recursive: true });
  const root = fs.realpathSync(fileStoreRoot);
  for (const directory of [runtimePaths.uploadsDir, runtimePaths.tempDir, runtimePaths.saveDir]) {
    const publicRoot = fs.existsSync(directory) ? fs.realpathSync(directory) : path.resolve(directory);
    if (within(publicRoot, root) || within(root, publicRoot)) {
      throw new Error('Private file storage must not overlap uploads, temp, or save directories. Check runtime paths.');
    }
  }
  fs.mkdirSync(fileStoreIncoming, { recursive: true });
  if (fs.lstatSync(fileStoreIncoming).isSymbolicLink()) throw new Error('File staging directory cannot be a link');
}

/** Each account's blobs live in their own directory: `account-<id>` or `bootstrap` (no auth configured). */
export function fileOwnerDirectoryName(owner: string): string {
  if (owner === 'bootstrap') return 'bootstrap';
  const match = /^account:(\d+)$/.exec(owner);
  if (!match) throw new Error('Invalid file owner key');
  return `account-${match[1]}`;
}

function assertNotLink(target: string, message: string) {
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(message);
}

/** Create the owner's blob directory; the directory itself must never be a link into somewhere else. */
export function ensureFileOwnerDirectory(owner: string): string {
  const directory = path.join(fileStoreRoot, fileOwnerDirectoryName(owner));
  assertNotLink(directory, 'File owner directory cannot be a link');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/** No user-supplied names or paths are ever used as filesystem paths. */
export function storedFilePath(owner: string, id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid stored file ID');
  const directory = path.join(fileStoreRoot, fileOwnerDirectoryName(owner));
  assertNotLink(directory, 'File owner directory cannot be a link');
  const target = path.join(directory, `${id}.bin`);
  assertNotLink(target, 'Stored file cannot be a link');
  return target;
}

/** Cached preview of an image file (regenerated when the file is newer). */
export function fileStoreThumbnailPath(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid stored file ID');
  return path.join(fileStoreRoot, '.thumbs', `${id}.webp`);
}

/**
 * Move blobs from the old flat `files/<id>.bin` layout into per-owner directories.
 * Idempotent and retryable: a blob only leaves the root once it has been renamed successfully.
 */
export function migrateFileStoreLayout(lookupOwner: (id: string) => string | null): { moved: number; orphaned: number } {
  ensureFileStoreDirectories();
  const result = { moved: 0, orphaned: 0 };
  for (const entry of fs.readdirSync(fileStoreRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{32}\.bin$/.test(entry.name)) continue;
    const id = entry.name.slice(0, 32);
    const source = path.join(fileStoreRoot, entry.name);
    const owner = lookupOwner(id);
    let target: string;
    if (owner === null) {
      fs.mkdirSync(fileStoreOrphans, { recursive: true });
      target = path.join(fileStoreOrphans, entry.name);
    } else {
      ensureFileOwnerDirectory(owner);
      target = storedFilePath(owner, id);
    }
    if (fs.existsSync(target)) {
      // The same blob already exists at the destination; keep the extra copy out of the way instead of overwriting.
      fs.mkdirSync(fileStoreOrphans, { recursive: true });
      target = path.join(fileStoreOrphans, `${id}-${Date.now()}.bin`);
    }
    fs.renameSync(source, target);
    if (owner === null || target.startsWith(fileStoreOrphans)) result.orphaned++;
    else result.moved++;
  }
  return result;
}

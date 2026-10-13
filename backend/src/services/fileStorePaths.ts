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
  assertNotLink(fileStoreRoot, 'File store cannot be a link');
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

/** Legacy directory names are accepted only during layout migration. */
function assertNotLink(target: string, message: string) {
  try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error(message); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Kept for internal callers that identify the writer separately from storage. */
export function ensureFileOwnerDirectory(_actor: string): string {
  ensureFileStoreDirectories();
  return fileStoreRoot;
}

/** File IDs select the shared blob; the actor is not an access scope. */
export function storedFilePath(_actor: string, id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid stored file ID');
  assertNotLink(fileStoreRoot, 'File store cannot be a link');
  const target = path.join(fileStoreRoot, `${id}.bin`);
  assertNotLink(target, 'Stored file cannot be a link');
  return target;
}

/** Cached preview of an image file (regenerated when the file is newer). */
export function fileStoreThumbnailPath(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid stored file ID');
  return path.join(fileStoreRoot, '.thumbs', `${id}.webp`);
}

/** Rename each legacy item once. Never merge or overwrite an existing destination. */
export function migrateFileStoreLayout(): { moved: number; orphaned: number } {
  ensureFileStoreDirectories();
  const result = { moved: 0, orphaned: 0 };
  for (const [base, projects] of [[fileStoreRoot, false], [path.join(fileStoreRoot, '.revisions'), false], [path.join(runtimePaths.basePath, 'workspaces'), true]] as const) {
    if (!fs.existsSync(base)) continue;
    assertNotLink(base, 'Migration root cannot be a link');
    const resolvedBase = fs.realpathSync(base);
    for (const directory of fs.readdirSync(base, { withFileTypes: true })) {
      if (!/^(account-[1-9]\d*|bootstrap)$/.test(directory.name)) continue;
      const legacy = path.join(resolvedBase, directory.name);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`Unsafe legacy file directory: ${legacy}`);
      for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
        if (!(projects ? /^[a-f0-9]{32}$/ : /^[a-f0-9]{32}\.bin$/).test(entry.name)) continue;
        const source = path.resolve(legacy, entry.name);
        const target = path.resolve(resolvedBase, entry.name);
        if (!within(resolvedBase, source) || !within(resolvedBase, target) || entry.isSymbolicLink() || (projects ? !entry.isDirectory() : !entry.isFile())) throw new Error(`Unsafe migration item: ${source}`);
        assertNotLink(target, 'Migration target cannot be a link');
        if (fs.existsSync(target)) throw new Error(`Shared file migration collision: ${target}`);
        fs.renameSync(source, target);
        result.moved++;
      }
    }
  }
  return result;
}

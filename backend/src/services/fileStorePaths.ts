import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

export const fileStoreRoot = path.join(runtimePaths.basePath, 'files');
export const fileStoreIncoming = path.join(fileStoreRoot, '.incoming');

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

/** No user-supplied names or paths are ever used as filesystem paths. */
export function storedFilePath(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid stored file ID');
  const target = path.join(fileStoreRoot, `${id}.bin`);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Stored file cannot be a link');
  return target;
}

/** Cached preview of an image file (regenerated when the file is newer). */
export function fileStoreThumbnailPath(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid stored file ID');
  return path.join(fileStoreRoot, '.thumbs', `${id}.webp`);
}

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isImageExtension, isSupportedExtension, isVideoExtension } from '../constants/supportedExtensions';
import { writeToAvailablePath } from '../utils/availableFilePath';
import { isPathInside } from '../utils/pathResolver';
import { moveFileWithoutReplacing } from '../utils/recycleBin';
import type { BackupSource } from './backupSourceService';
import { settingsService } from './settingsService';
import { VideoOptimizationService } from './videoOptimizationService';
import { WebPConversionService } from './webpConversionService';

/** Yield as directories are read; an early return closes the open directory iterators. */
export async function* existingBackupFiles(directory: string, recursive: boolean, signal: AbortSignal): AsyncGenerator<string> {
  signal.throwIfAborted();
  const dir = await fs.promises.opendir(directory);
  for await (const entry of dir) {
    signal.throwIfAborted();
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && recursive) yield* existingBackupFiles(file, true, signal);
    else if (entry.isFile() && isSupportedExtension(path.extname(entry.name))) yield file;
  }
}

async function waitForFileWrite(file: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 20; attempt++) {
    signal.throwIfAborted();
    try {
      const before = await fs.promises.stat(file);
      await delay(300, undefined, { signal });
      const after = await fs.promises.stat(file);
      if (before.size === after.size && after.size > 0) {
        await fs.promises.access(file, fs.constants.R_OK);
        return;
      }
    } catch { signal.throwIfAborted(); }
  }
  throw new Error(`파일 쓰기 완료를 확인하지 못했습니다: ${file}`);
}

async function exists(file: string) {
  try { await fs.promises.access(file); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Initial sync mirrors existing paths; a live add preserves both files if names collide. */
export async function importBackupFile(source: BackupSource, root: string, file: string, initial: boolean, signal: AbortSignal): Promise<string | null> {
  const relative = path.relative(source.source_path, file);
  const ext = path.extname(file).toLowerCase();
  if (!isPathInside(source.source_path, file) || !isSupportedExtension(ext)) return null;
  if (!initial) await waitForFileWrite(file, signal);
  signal.throwIfAborted();
  const original = path.join(root, relative);
  const base = path.join(path.dirname(original), path.parse(original).name);
  const video = isVideoExtension(ext) && ext !== '.gif' ? settingsService.loadSettings().videoOptimization : null;
  const targets = video?.enabled && video.applyToBackupImports ? VideoOptimizationService.outputPaths(base, ext) : null;
  const webp = source.import_mode === 'convert_webp' && isImageExtension(ext);
  const preferred = targets?.optimized ?? (webp ? `${base}.webp` : original);
  if (initial && (await exists(preferred) || (targets && targets.original !== preferred && await exists(targets.original)))) return null;
  await fs.promises.mkdir(path.dirname(original), { recursive: true });
  signal.throwIfAborted();
  if (targets && video) {
    return (await VideoOptimizationService.persistWithFallback(file, base, ext, {
      crf: video.crf, audioBitrateKbps: video.audioBitrateKbps, logLabel: 'backup import', signal,
    })).outputPath;
  }
  const publish = async (write: (target: string) => Promise<void>) => {
    if (!initial) return writeToAvailablePath(preferred, write);
    try { await write(preferred); return preferred; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
      throw error;
    }
  };
  if (!webp) return publish(target => fs.promises.copyFile(file, target, fs.constants.COPYFILE_EXCL));
  const { buffer } = await WebPConversionService.convertFileToWebPBuffer(file, {
    quality: source.webp_quality, sourcePathForMetadata: file, originalFileName: path.basename(file),
  });
  // An interrupted write at the real .webp name would make the next initial sync skip a partial image.
  const stage = path.join(path.dirname(preferred), `.conai-${randomUUID()}.part`);
  const handle = await fs.promises.open(stage, 'wx');
  try {
    try { await handle.writeFile(buffer, { signal }); } finally { await handle.close(); }
    signal.throwIfAborted();
    return await publish(target => moveFileWithoutReplacing(stage, target));
  } finally {
    await fs.promises.rm(stage, { force: true });
  }
}

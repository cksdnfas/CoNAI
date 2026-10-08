import fs from 'fs';
import path from 'path';
import {
  RECYCLE_BIN_PATH,
  forgetMissingRecycleBinOrigins,
  forgetRecycleBinOrigins,
  parseRecycleBinFileName,
  readRecycleBinOrigins,
} from '../../utils/recycleBin';
import { fileStoreRoot } from '../fileStorePaths';

/**
 * RecycleBin retention: delete top-level RecycleBin files older than the configured number of days.
 *
 * Age comes from the recorded deletion time (`recycle_bin_entries`) or, for files deleted before origins were
 * recorded, the timestamp in the bin file name. A file with neither stays. Folders and links are never touched.
 * The same pass drops origin records whose file is gone and administrator previews (`files/.system-thumbs`) older
 * than the cutoff. Work runs in chunks and yields between them, so a bin of 100k+ files never blocks the server.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK_SIZE = 500;

export interface RecycleBinRetentionOptions {
  retentionDays: number;
  now?: Date;
  /** Overrides for tests. */
  recycleBinDirectory?: string;
  previewDirectory?: string;
}

export interface RecycleBinRetentionHooks {
  progress?: (processed: number, total: number) => void;
  yield?: () => Promise<void>;
  throwIfCancelled?: () => void;
}

export interface RecycleBinRetentionResult {
  retentionDays: number;
  skipped: boolean;
  scannedFiles: number;
  deletedFiles: number;
  deletedBytes: number;
  failedFiles: number;
  /** Files whose deletion time could not be told (no record, unrecognised name). */
  undatedFiles: number;
  deletedPreviews: number;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Deletion time in ms: the recorded one, else the bin name's timestamp, else null. */
function deletedAtMs(name: string, recordedDeletedAt: string | undefined): number | null {
  const candidate = recordedDeletedAt ?? parseRecycleBinFileName(name).deletedAt;
  if (!candidate) return null;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? ms : null;
}

/** Remove one top-level file if it is still a regular file (never a link, folder or anything that changed type). */
async function unlinkRegularFile(filePath: string): Promise<number | null> {
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile()) return null;
  await fs.promises.unlink(filePath);
  return stat.size;
}

async function prunePreviews(directory: string, cutoffMs: number, hooks: RecycleBinRetentionHooks): Promise<number> {
  let dirents: fs.Dirent[];
  try {
    const stat = await fs.promises.lstat(directory);
    if (!stat.isDirectory()) return 0;
    dirents = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return 0; // No previews made yet.
  }

  let deleted = 0;
  for (let index = 0; index < dirents.length; index += 1) {
    const dirent = dirents[index];
    if (dirent.isFile()) {
      const filePath = path.join(directory, dirent.name);
      try {
        const stat = await fs.promises.lstat(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoffMs) {
          await fs.promises.unlink(filePath);
          deleted += 1;
        }
      } catch {
        // Gone or busy: the next run tries again.
      }
    }
    if (index % CHUNK_SIZE === CHUNK_SIZE - 1) {
      hooks.throwIfCancelled?.();
      await (hooks.yield ?? yieldToEventLoop)();
    }
  }
  return deleted;
}

export async function runRecycleBinRetention(
  options: RecycleBinRetentionOptions,
  hooks: RecycleBinRetentionHooks = {},
): Promise<RecycleBinRetentionResult> {
  const retentionDays = options.retentionDays;
  const result: RecycleBinRetentionResult = {
    retentionDays,
    skipped: false,
    scannedFiles: 0,
    deletedFiles: 0,
    deletedBytes: 0,
    failedFiles: 0,
    undatedFiles: 0,
    deletedPreviews: 0,
  };
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    return { ...result, skipped: true };
  }

  const cutoffMs = (options.now ?? new Date()).getTime() - retentionDays * ONE_DAY_MS;
  const directory = options.recycleBinDirectory ?? RECYCLE_BIN_PATH;
  const pause = hooks.yield ?? yieldToEventLoop;

  let names: string[] = [];
  try {
    const stat = await fs.promises.lstat(directory);
    if (stat.isDirectory()) {
      names = (await fs.promises.readdir(directory, { withFileTypes: true }))
        .filter((dirent) => dirent.isFile())
        .map((dirent) => dirent.name);
    }
  } catch {
    // No RecycleBin yet.
  }

  for (let start = 0; start < names.length; start += CHUNK_SIZE) {
    hooks.throwIfCancelled?.();
    const chunk = names.slice(start, start + CHUNK_SIZE);
    const origins = readRecycleBinOrigins(chunk);
    const deletedNames: string[] = [];
    for (const name of chunk) {
      result.scannedFiles += 1;
      const deletedAt = deletedAtMs(name, origins.get(name)?.deletedAt);
      if (deletedAt === null) {
        result.undatedFiles += 1;
        continue;
      }
      if (deletedAt >= cutoffMs) continue;
      try {
        const size = await unlinkRegularFile(path.join(directory, name));
        if (size !== null) {
          deletedNames.push(name);
          result.deletedFiles += 1;
          result.deletedBytes += size;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          deletedNames.push(name);
        } else {
          result.failedFiles += 1;
        }
      }
    }
    forgetRecycleBinOrigins(deletedNames);
    hooks.progress?.(Math.min(start + CHUNK_SIZE, names.length), names.length);
    await pause();
  }

  if (names.length > 0 || fs.existsSync(directory)) {
    forgetMissingRecycleBinOrigins(directory);
  }
  result.deletedPreviews = await prunePreviews(options.previewDirectory ?? path.join(fileStoreRoot, '.system-thumbs'), cutoffMs, hooks);
  return result;
}

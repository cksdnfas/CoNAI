import fs from 'fs';
import path from 'path';
import { db } from '../../database/init';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { maybeTruncateImagesWal } from '../../database/walMaintenance';
import { runtimePaths } from '../../config/runtimePaths';
import { ImageStatsModel } from '../../models/Image/ImageStatsModel';
import { resolveThumbnailAbsolutePath } from '../../utils/thumbnailGenerator';
import { fileStoreIncoming } from '../fileStorePaths';
import { HistoryCommandService } from '../historyCommandService';
import { PromptCollectionService } from '../promptCollectionService';
import { SystemMaintenanceLockService } from '../systemMaintenanceLockService';
import { collectUserDbMediaReferences } from './userMediaReferences';

/**
 * Library garbage collection: rows and files that nothing will ever show again.
 *
 * 1. `image_files` rows marked `missing` that have not been seen for N days.
 * 2. `media_metadata` rows with no file row left, unless something still points at the hash (manual group
 *    membership, an unrestored edit revision, anything in user.db). Keeping a referenced row means a moved file
 *    that comes back re-attaches to its tags, groups and chat references.
 * 3. Thumbnail files no row points at (old regenerations, rows deleted before the delete path cleaned up).
 * 4. Temp leftovers: empty graph execution folders, stale file-store uploads, stale video frames.
 *
 * Every pass is keyset-paged with short write transactions and yields between pages, so it can run on the live
 * server. A dry run walks the same paths and only counts.
 */

const PAGE_SIZE = 500;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export interface MediaOrphanCleanupOptions {
  dryRun: boolean;
  /** `missing` file rows unseen for at least this many days are purged. */
  missingOlderThanDays: number;
  /** File-less metadata rows untouched for at least this many days are deleted. */
  orphanOlderThanDays: number;
  sweepThumbnails: boolean;
  sweepTemp: boolean;
  /** Thumbnail files newer than this are skipped: a generation may not have written its row yet. */
  thumbnailGraceMs: number;
  /** Temp leftovers newer than this are kept. */
  tempMaxAgeMs: number;
}

export const DEFAULT_MEDIA_ORPHAN_CLEANUP_OPTIONS: MediaOrphanCleanupOptions = {
  dryRun: true,
  missingOlderThanDays: 30,
  orphanOlderThanDays: 30,
  sweepThumbnails: true,
  sweepTemp: true,
  thumbnailGraceMs: ONE_HOUR_MS,
  tempMaxAgeMs: ONE_DAY_MS,
};

export interface MediaOrphanCleanupResult {
  dryRun: boolean;
  missingFiles: { matched: number; deleted: number };
  orphanMetadata: {
    scanned: number;
    candidates: number;
    keptReferenced: number;
    deleted: number;
    thumbnailsDeleted: number;
  };
  orphanThumbnails: { scanned: number; orphaned: number; deleted: number; bytes: number; emptyDirsRemoved: number };
  tempLeftovers: { graphExecutionDirs: number; incomingEntries: number; videoFrames: number; bytes: number };
  userDbReferenceTokens: number;
  durationMs: number;
}

export interface MediaOrphanCleanupHooks {
  phase?: (phase: string) => void;
  progress?: (processed: number) => void;
  warn?: (message: string) => void;
  yield?: () => Promise<void>;
  throwIfCancelled?: () => void;
}

const defaultYield = () => new Promise<void>((resolve) => setImmediate(resolve));

function emptyResult(dryRun: boolean): MediaOrphanCleanupResult {
  return {
    dryRun,
    missingFiles: { matched: 0, deleted: 0 },
    orphanMetadata: { scanned: 0, candidates: 0, keptReferenced: 0, deleted: 0, thumbnailsDeleted: 0 },
    orphanThumbnails: { scanned: 0, orphaned: 0, deleted: 0, bytes: 0, emptyDirsRemoved: 0 },
    tempLeftovers: { graphExecutionDirs: 0, incomingEntries: 0, videoFrames: 0, bytes: 0 },
    userDbReferenceTokens: 0,
    durationMs: 0,
  };
}

function daysModifier(days: number): string {
  return `-${Math.max(0, Math.floor(days))} days`;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(',');
}

async function unlinkIfPresent(filePath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** Normalised identity of an absolute path for comparisons (Windows paths compare case-insensitively). */
function pathKey(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* 1. missing file rows                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

async function purgeMissingFileRows(
  options: MediaOrphanCleanupOptions,
  result: MediaOrphanCleanupResult,
  hooks: MediaOrphanCleanupHooks,
): Promise<void> {
  const selectPage = db.prepare(`
    SELECT id FROM image_files
    WHERE id > ?
      AND file_status = 'missing'
      AND COALESCE(last_verified_date, scan_date) < datetime('now', ?)
    ORDER BY id
    LIMIT ${PAGE_SIZE}
  `);
  const deleteRow = db.prepare(`DELETE FROM image_files WHERE id = ? AND file_status = 'missing'`);
  const deleteBatch = db.transaction((ids: number[]) => ids.reduce((sum, id) => sum + deleteRow.run(id).changes, 0));

  const modifier = daysModifier(options.missingOlderThanDays);
  let lastId = 0;
  for (;;) {
    hooks.throwIfCancelled?.();
    const ids = (selectPage.all(lastId, modifier) as Array<{ id: number }>).map((row) => row.id);
    if (ids.length === 0) {
      break;
    }

    lastId = ids[ids.length - 1];
    result.missingFiles.matched += ids.length;
    if (!options.dryRun) {
      result.missingFiles.deleted += deleteBatch(ids);
    }
    hooks.progress?.(result.missingFiles.matched);
    await (hooks.yield ?? defaultYield)();
  }

  if (!options.dryRun && result.missingFiles.deleted > 0) {
    maybeTruncateImagesWal('media-orphan-cleanup:missing-files');
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* 2. file-less metadata rows                                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

interface MetadataPageRow {
  rid: number;
  composite_hash: string;
  has_file: number;
  is_old: number;
}

interface DeletedMetadataRow {
  composite_hash: string;
  thumbnail_path: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  character_prompt_text: string | null;
  auto_tags: string | null;
}

/** Hashes among `hashes` that images.db itself still needs: manual group curation and restorable edits. */
function findImagesDbReferencedHashes(hashes: string[]): Set<string> {
  const referenced = new Set<string>();
  if (hashes.length === 0) {
    return referenced;
  }

  const marks = placeholders(hashes.length);
  const queries = [
    `SELECT DISTINCT composite_hash FROM image_groups WHERE collection_type = 'manual' AND composite_hash IN (${marks})`,
    `SELECT DISTINCT composite_hash FROM image_metadata_edit_revisions WHERE restored_date IS NULL AND composite_hash IN (${marks})`,
  ];

  for (const sql of queries) {
    try {
      for (const row of db.prepare(sql).all(...hashes) as Array<{ composite_hash: string }>) {
        referenced.add(row.composite_hash);
      }
    } catch (error) {
      // A missing optional table must not let the collector delete referenced rows: treat every hash as kept.
      console.warn('[MediaOrphanCleanup] Reference lookup failed, keeping this page:', error instanceof Error ? error.message : error);
      return new Set(hashes);
    }
  }

  return referenced;
}

async function deleteOrphanMetadata(
  options: MediaOrphanCleanupOptions,
  result: MediaOrphanCleanupResult,
  hooks: MediaOrphanCleanupHooks,
): Promise<void> {
  const references = await collectUserDbMediaReferences(getUserSettingsDb(), {
    yield: hooks.yield ?? defaultYield,
    throwIfCancelled: hooks.throwIfCancelled,
  });
  result.userDbReferenceTokens = references.hashes.size;
  for (const table of references.skippedTables) {
    hooks.warn?.(`user.db table ${table} could not be scanned for media references`);
  }

  // Page by rowid over the whole table and decide in JS; a NOT EXISTS filter inside the LIMIT would rescan the
  // same leading rows on every page.
  const selectPage = db.prepare(`
    SELECT
      m.rowid AS rid,
      m.composite_hash,
      EXISTS (SELECT 1 FROM image_files f WHERE f.composite_hash = m.composite_hash) AS has_file,
      COALESCE(m.metadata_updated_date, m.first_seen_date) < datetime('now', ?) AS is_old
    FROM media_metadata m
    WHERE m.rowid > ?
    ORDER BY m.rowid
    LIMIT ${PAGE_SIZE}
  `);
  const selectDeleted = (count: number) => db.prepare(`
    SELECT composite_hash, thumbnail_path, prompt, negative_prompt, character_prompt_text, auto_tags
    FROM media_metadata WHERE composite_hash IN (${placeholders(count)})
  `);
  // The NOT EXISTS re-check closes the window where a file was registered after the page was read.
  const deleteRow = db.prepare(`
    DELETE FROM media_metadata
    WHERE composite_hash = ?
      AND NOT EXISTS (SELECT 1 FROM image_files WHERE composite_hash = ?)
  `);

  const modifier = daysModifier(options.orphanOlderThanDays);
  let lastRowId = 0;
  for (;;) {
    hooks.throwIfCancelled?.();
    const rows = selectPage.all(modifier, lastRowId) as MetadataPageRow[];
    if (rows.length === 0) {
      break;
    }

    lastRowId = rows[rows.length - 1].rid;
    result.orphanMetadata.scanned += rows.length;

    const candidates = rows.filter((row) => row.has_file === 0 && row.is_old === 1).map((row) => row.composite_hash);
    result.orphanMetadata.candidates += candidates.length;

    if (candidates.length > 0) {
      const imagesDbReferenced = findImagesDbReferencedHashes(candidates);
      const deletable = candidates.filter((hash) => !imagesDbReferenced.has(hash) && !references.hashes.has(hash.toLowerCase()));
      result.orphanMetadata.keptReferenced += candidates.length - deletable.length;

      if (deletable.length > 0) {
        if (options.dryRun) {
          result.orphanMetadata.deleted += deletable.length;
        } else {
          const snapshot = selectDeleted(deletable.length).all(...deletable) as DeletedMetadataRow[];
          const deletedHashes = new Set<string>();
          db.transaction(() => {
            for (const hash of deletable) {
              if (deleteRow.run(hash, hash).changes > 0) {
                deletedHashes.add(hash);
              }
            }
          })();

          result.orphanMetadata.deleted += deletedHashes.size;
          for (const row of snapshot) {
            if (!deletedHashes.has(row.composite_hash)) {
              continue;
            }

            await cleanupAfterMetadataDelete(row, result, hooks);
          }
        }
      }
    }

    hooks.progress?.(result.orphanMetadata.scanned);
    await (hooks.yield ?? defaultYield)();
  }

  if (!options.dryRun && result.orphanMetadata.deleted > 0) {
    ImageStatsModel.invalidateAutoTagStatsCache();
    maybeTruncateImagesWal('media-orphan-cleanup:metadata');
  }
}

/** Side effects of one deleted metadata row, same as the user-facing delete path. */
async function cleanupAfterMetadataDelete(
  row: DeletedMetadataRow,
  result: MediaOrphanCleanupResult,
  hooks: MediaOrphanCleanupHooks,
): Promise<void> {
  if (row.thumbnail_path) {
    const absolutePath = resolveThumbnailAbsolutePath(row.thumbnail_path);
    if (absolutePath) {
      try {
        if (await unlinkIfPresent(absolutePath)) {
          result.orphanMetadata.thumbnailsDeleted++;
        }
      } catch (error) {
        hooks.warn?.(`thumbnail ${row.thumbnail_path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  try {
    await PromptCollectionService.removeFromImage(row.prompt, row.negative_prompt, row.character_prompt_text, row.auto_tags);
  } catch (error) {
    hooks.warn?.(`prompt collection ${row.composite_hash}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    HistoryCommandService.deleteByCompositeHash(row.composite_hash);
  } catch (error) {
    hooks.warn?.(`generation history ${row.composite_hash}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* 3. thumbnail files nothing points at                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

async function sweepOrphanThumbnails(
  options: MediaOrphanCleanupOptions,
  result: MediaOrphanCleanupResult,
  hooks: MediaOrphanCleanupHooks,
): Promise<void> {
  const thumbnailsRoot = path.join(runtimePaths.tempDir, 'thumbnails');
  if (!fs.existsSync(thumbnailsRoot)) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const dateDirs = (await fs.promises.readdir(thumbnailsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const dirName of dateDirs) {
    const dirPath = path.join(thumbnailsRoot, dirName);
    const directory = await fs.promises.opendir(dirPath);
    let batch: string[] = [];

    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.webp')) {
        continue;
      }

      batch.push(entry.name);
      if (batch.length >= PAGE_SIZE) {
        await processThumbnailBatch(dirPath, batch, options, result, hooks);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await processThumbnailBatch(dirPath, batch, options, result, hooks);
    }

    // Day folders other than today's that ended up empty go too; today's is still being written to.
    if (!options.dryRun && dirName !== today) {
      try {
        if ((await fs.promises.readdir(dirPath)).length === 0) {
          await fs.promises.rmdir(dirPath);
          result.orphanThumbnails.emptyDirsRemoved++;
        }
      } catch {
        // A thumbnail landed meanwhile, or the folder is in use: leave it.
      }
    }
  }
}

async function processThumbnailBatch(
  dirPath: string,
  fileNames: string[],
  options: MediaOrphanCleanupOptions,
  result: MediaOrphanCleanupResult,
  hooks: MediaOrphanCleanupHooks,
): Promise<void> {
  hooks.throwIfCancelled?.();
  result.orphanThumbnails.scanned += fileNames.length;

  const hashes = fileNames.map((name) => name.slice(0, -'.webp'.length));
  const rows = db.prepare(
    `SELECT composite_hash, thumbnail_path FROM media_metadata WHERE composite_hash IN (${placeholders(hashes.length)})`,
  ).all(...hashes) as Array<{ composite_hash: string; thumbnail_path: string | null }>;

  const referencedPaths = new Set<string>();
  for (const row of rows) {
    const absolutePath = row.thumbnail_path ? resolveThumbnailAbsolutePath(row.thumbnail_path) : null;
    if (absolutePath) {
      referencedPaths.add(pathKey(absolutePath));
    }
  }

  const cutoff = Date.now() - options.thumbnailGraceMs;
  for (const fileName of fileNames) {
    const absolutePath = path.join(dirPath, fileName);
    if (referencedPaths.has(pathKey(absolutePath))) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolutePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs > cutoff) {
      continue;
    }

    result.orphanThumbnails.orphaned++;
    result.orphanThumbnails.bytes += stat.size;
    if (!options.dryRun) {
      try {
        if (await unlinkIfPresent(absolutePath)) {
          result.orphanThumbnails.deleted++;
        }
      } catch (error) {
        hooks.warn?.(`thumbnail ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  hooks.progress?.(result.orphanThumbnails.scanned);
  await (hooks.yield ?? defaultYield)();
}

/* ------------------------------------------------------------------------------------------------------------ */
/* 4. temp leftovers                                                                                             */
/* ------------------------------------------------------------------------------------------------------------ */

/** Remove empty folders under `dir` (bottom-up) older than the cutoff. Returns true when `dir` itself went. */
async function pruneEmptyDirectories(dir: string, cutoffMs: number, dryRun: boolean): Promise<{ removed: boolean; empty: boolean }> {
  let entries: fs.Dirent[];
  let ownMtimeMs: number;
  try {
    // Read the folder's own age first: removing an empty child below bumps the parent's mtime to now.
    ownMtimeMs = (await fs.promises.stat(dir)).mtimeMs;
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { removed: false, empty: false };
  }

  let empty = true;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      empty = false;
      continue;
    }

    const child = await pruneEmptyDirectories(path.join(dir, entry.name), cutoffMs, dryRun);
    if (!child.empty) {
      empty = false;
    }
  }

  if (!empty) {
    return { removed: false, empty: false };
  }

  try {
    if (ownMtimeMs > cutoffMs) {
      return { removed: false, empty: false };
    }
    if (!dryRun) {
      await fs.promises.rmdir(dir);
    }
    return { removed: true, empty: true };
  } catch {
    return { removed: false, empty: false };
  }
}

/** Delete direct children of `dir` (files or whole folders) last modified before the cutoff. */
async function removeStaleEntries(dir: string, cutoffMs: number, dryRun: boolean): Promise<{ count: number; bytes: number }> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { count: 0, bytes: 0 };
  }

  let count = 0;
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    try {
      const stat = await fs.promises.lstat(entryPath);
      if (stat.mtimeMs > cutoffMs || stat.isSymbolicLink()) {
        continue;
      }
      count++;
      bytes += stat.isFile() ? stat.size : 0;
      if (!dryRun) {
        await fs.promises.rm(entryPath, { recursive: true, force: true });
      }
    } catch {
      // Gone already or in use.
    }
  }

  return { count, bytes };
}

async function sweepTempLeftovers(
  options: MediaOrphanCleanupOptions,
  result: MediaOrphanCleanupResult,
  hooks: MediaOrphanCleanupHooks,
): Promise<void> {
  const cutoffMs = Date.now() - options.tempMaxAgeMs;

  const graphRoot = path.join(runtimePaths.tempDir, 'graph-executions');
  let executionDirs: fs.Dirent[] = [];
  try {
    executionDirs = await fs.promises.readdir(graphRoot, { withFileTypes: true });
  } catch {
    executionDirs = [];
  }
  for (const entry of executionDirs) {
    hooks.throwIfCancelled?.();
    if (!entry.isDirectory()) {
      continue;
    }
    const pruned = await pruneEmptyDirectories(path.join(graphRoot, entry.name), cutoffMs, options.dryRun);
    if (pruned.removed) {
      result.tempLeftovers.graphExecutionDirs++;
    }
    await (hooks.yield ?? defaultYield)();
  }

  const incoming = await removeStaleEntries(fileStoreIncoming, cutoffMs, options.dryRun);
  result.tempLeftovers.incomingEntries += incoming.count;
  result.tempLeftovers.bytes += incoming.bytes;

  const frames = await removeStaleEntries(path.join(runtimePaths.tempDir, 'video_frames'), cutoffMs, options.dryRun);
  result.tempLeftovers.videoFrames += frames.count;
  result.tempLeftovers.bytes += frames.bytes;
}

/* ------------------------------------------------------------------------------------------------------------ */

export function normalizeMediaOrphanCleanupOptions(input: Partial<MediaOrphanCleanupOptions> | undefined): MediaOrphanCleanupOptions {
  const options = { ...DEFAULT_MEDIA_ORPHAN_CLEANUP_OPTIONS, ...(input ?? {}) };
  const days = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    // Never below one day: a zero cutoff would race files the scanner is about to register.
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
  };

  return {
    dryRun: options.dryRun !== false,
    missingOlderThanDays: days(options.missingOlderThanDays, DEFAULT_MEDIA_ORPHAN_CLEANUP_OPTIONS.missingOlderThanDays),
    orphanOlderThanDays: days(options.orphanOlderThanDays, DEFAULT_MEDIA_ORPHAN_CLEANUP_OPTIONS.orphanOlderThanDays),
    sweepThumbnails: options.sweepThumbnails !== false,
    sweepTemp: options.sweepTemp !== false,
    thumbnailGraceMs: Math.max(0, Number(options.thumbnailGraceMs) || 0),
    tempMaxAgeMs: Math.max(0, Number(options.tempMaxAgeMs) || 0),
  };
}

export async function runMediaOrphanCleanup(
  input: Partial<MediaOrphanCleanupOptions> = {},
  hooks: MediaOrphanCleanupHooks = {},
): Promise<MediaOrphanCleanupResult> {
  const options = normalizeMediaOrphanCleanupOptions(input);
  const result = emptyResult(options.dryRun);
  const startedAt = Date.now();

  if (SystemMaintenanceLockService.isExclusiveActive()) {
    throw new Error('Media identity maintenance is running; try the orphan cleanup again after it finishes');
  }

  hooks.phase?.('missing-files');
  await purgeMissingFileRows(options, result, hooks);

  hooks.phase?.('orphan-metadata');
  await deleteOrphanMetadata(options, result, hooks);

  if (options.sweepThumbnails) {
    hooks.phase?.('orphan-thumbnails');
    await sweepOrphanThumbnails(options, result, hooks);
  }

  if (options.sweepTemp) {
    hooks.phase?.('temp-leftovers');
    await sweepTempLeftovers(options, result, hooks);
  }

  result.durationMs = Date.now() - startedAt;
  console.log(
    `🧹 Media orphan cleanup${options.dryRun ? ' [DRY RUN]' : ''}: ` +
      `missing rows ${result.missingFiles.matched}, orphan metadata ${result.orphanMetadata.deleted}` +
      ` (kept ${result.orphanMetadata.keptReferenced} referenced), orphan thumbnails ${result.orphanThumbnails.orphaned},` +
      ` temp leftovers ${result.tempLeftovers.graphExecutionDirs + result.tempLeftovers.incomingEntries + result.tempLeftovers.videoFrames}` +
      ` in ${result.durationMs}ms`,
  );

  return result;
}

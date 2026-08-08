import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import type { Request, Response } from 'express';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import {
  MediaMetadataFileQueries,
  type MediaVisibilityGuardRecord,
} from '../../models/Image/MediaMetadataFileQueries';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import { requestThumbnailRepair } from '../../services/runtimeJobs/handlers/thumbnailRepairHandlers';
import { requestVideoPoster } from '../../services/runtimeJobs/handlers/videoPosterHandlers';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import type { ImageFileRecord, ImageMetadataRecord } from '../../types/image';
import {
  getCompositeHashOrBlock,
  getMimeTypeFromFilePath,
  pipeFileToResponse,
  streamCacheableFile,
  streamRangeFile,
} from './query-file-response-helpers';

export { getCompositeHashOrBlock, getMimeTypeFromFilePath, pipeFileToResponse, streamCacheableFile, streamRangeFile };

export type ImageDownloadType = 'original' | 'thumbnail';

/**
 * 미디어 서빙 행 캐시 (단기 TTL).
 *
 * 비디오 1개 재생이 Range 요청 수십 개를 만들고, 요청마다 가드 행 + 파일 행 동기 SQLite
 * 조회가 단일 프로세스를 직렬 점유했다. **행만 캐시하고 판정(숨김/후처리 준비)은 매 요청
 * 다시 평가**하므로, 티어 정책 변경은 즉시 반영되고 행 데이터 신선도만 TTL 로 제한된다.
 */
const MEDIA_SERVE_ROW_CACHE_TTL_MS = 2_000;
const MEDIA_SERVE_ROW_CACHE_MAX_ENTRIES = 500;

type MediaServeRowCacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const visibilityGuardRowCache = new Map<string, MediaServeRowCacheEntry<MediaVisibilityGuardRecord | null>>();
const activeFileRowCache = new Map<string, MediaServeRowCacheEntry<ImageFileRecord[]>>();

function readMediaServeRowCache<T>(cache: Map<string, MediaServeRowCacheEntry<T>>, key: string): MediaServeRowCacheEntry<T> | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry;
}

function writeMediaServeRowCache<T>(cache: Map<string, MediaServeRowCacheEntry<T>>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + MEDIA_SERVE_ROW_CACHE_TTL_MS, value });

  while (cache.size > MEDIA_SERVE_ROW_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

/** Contract smoke helper. Production code never calls this. */
export function clearMediaServeRowCachesForTests(): void {
  visibilityGuardRowCache.clear();
  activeFileRowCache.clear();
}

export const MAX_BATCH_DOWNLOAD_FILE_COUNT = 200;
export const MAX_BATCH_DOWNLOAD_TOTAL_SOURCE_BYTES = 512 * 1024 * 1024;

export class BatchDownloadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchDownloadLimitError';
  }
}

/**
 * Load the guard columns for one image and block hidden-policy access centrally.
 *
 * Media routes only need visibility plus the thumbnail path, and `media_metadata`
 * rows average ~11KB — a `SELECT *` here made every thumbnail on a gallery page
 * walk a row overflow chain for three values.
 */
export async function getVisibleMetadataOrBlock(res: Response, compositeHash: string): Promise<MediaVisibilityGuardRecord | null> {
  const cachedGuard = readMediaServeRowCache(visibilityGuardRowCache, compositeHash);
  const metadata = cachedGuard
    ? cachedGuard.value
    : MediaMetadataFileQueries.findVisibilityGuardByHash(compositeHash);
  if (!cachedGuard) {
    writeMediaServeRowCache(visibilityGuardRowCache, compositeHash, metadata);
  }

  if (!metadata) {
    res.status(404).json({
      success: false,
      error: 'Metadata not found'
    });
    return null;
  }

  if (!MediaPostprocessVisibilityService.isReadyRecord(metadata)) {
    res.status(404).json({
      success: false,
      error: 'Metadata not found'
    });
    return null;
  }

  if (ImageSafetyService.isHidden(metadata.rating_score)) {
    res.status(403).json({
      success: false,
      error: 'This image is hidden by the current safety policy'
    });
    return null;
  }

  return metadata;
}

/** Load the active file row for one composite hash and send the shared not-found response if absent. */
export async function getActiveFileOrBlock(res: Response, compositeHash: string, errorMessage: string) {
  const cachedFiles = readMediaServeRowCache(activeFileRowCache, compositeHash);
  const files = cachedFiles
    ? cachedFiles.value
    : await ImageFileModel.findActiveByHash(compositeHash);
  if (!cachedFiles) {
    writeMediaServeRowCache(activeFileRowCache, compositeHash, files ?? []);
  }

  if (!files || files.length === 0) {
    res.status(404).json({
      success: false,
      error: errorMessage
    });
    return null;
  }

  return files[0] as ImageFileRecord;
}

/** Resolve the active file path and mark the DB row missing when the file disappeared on disk. */
export function getExistingActiveFilePathOrBlock(
  res: Response,
  file: ImageFileRecord,
  options: {
    missingError: string
    warnMessage?: string
  },
) {
  const filePath = resolveUploadsPath(file.original_file_path);

  if (!fs.existsSync(filePath)) {
    if (options.warnMessage) {
      console.warn(options.warnMessage);
    }
    ImageFileModel.updateStatus(file.id, 'missing');
    // missing 전이가 TTL 동안 캐시에 가려져 재경고/재기록되지 않게 즉시 비운다.
    if (file.composite_hash) {
      activeFileRowCache.delete(file.composite_hash);
    }
    res.status(404).json({
      success: false,
      error: options.missingError
    });
    return null;
  }

  return filePath;
}

/** Resolve the on-disk thumbnail for one metadata row, or null when it is absent. */
function resolveExistingThumbnailPath(metadata: Pick<ImageMetadataRecord, 'thumbnail_path'>): string | null {
  if (!metadata.thumbnail_path) {
    return null;
  }

  const thumbnailPath = path.join(runtimePaths.tempDir, metadata.thumbnail_path);
  return fs.existsSync(thumbnailPath) ? thumbnailPath : null;
}

/**
 * Serve the thumbnail, or fall back to the original and queue a background repair.
 *
 * Regeneration used to happen inline here: a sharp resize plus a synchronous
 * metadata UPDATE inside a GET, blocking the single Node event loop for every
 * other user. The GET now always returns immediately and the repair is delegated
 * to the runtime-jobs queue.
 *
 * Video and animated media used to be exempt from that entirely: with no
 * `thumbnail_path` on their rows this route streamed the **original file**, so a
 * page of video results pulled hundreds of megabytes through the process. They now
 * take the same path as images once a poster frame exists (HEAVY-2), and the
 * original is only streamed while the poster is still being generated.
 */
export async function serveThumbnailOrOriginal(
  req: Request,
  res: Response,
  compositeHash: string,
  metadata: Pick<ImageMetadataRecord, 'thumbnail_path'>,
  file: ImageFileRecord,
) {
  const mimeType = file.mime_type;
  const fileType = file.file_type;
  const isTimeBasedMedia = (mimeType && mimeType.startsWith('video/')) || fileType === 'animated';

  if (isTimeBasedMedia) {
    const posterPath = resolveExistingThumbnailPath(metadata);
    if (posterPath) {
      await streamCacheableFile(req, res, posterPath, 'image/webp');
      return;
    }

    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Video file not found',
      warnMessage: `[ImageServe] Video file missing on disk: ${resolveUploadsPath(file.original_file_path)}`,
    });

    if (!originalPath) {
      return;
    }

    // No poster yet: answer from the original this once and build the poster in the
    // background so the next request costs a few KB instead of the whole file.
    requestVideoPoster(compositeHash, originalPath);
    streamRangeFile(req, res, originalPath, mimeType);
    return;
  }

  const thumbnailPath = resolveExistingThumbnailPath(metadata);

  if (!thumbnailPath) {
    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Thumbnail and original file not found',
      warnMessage: `[ImageServe] Both thumbnail and original missing: ${file.original_file_path}`,
    });

    if (!originalPath) {
      return;
    }

    requestThumbnailRepair(compositeHash, originalPath);
    await streamCacheableFile(req, res, originalPath, mimeType);
    return;
  }

  await streamCacheableFile(req, res, thumbnailPath, 'image/webp');
}

async function resolveThumbnailDownloadFile(
  compositeHash: string,
  metadata: Pick<ImageMetadataRecord, 'thumbnail_path'>,
  file: ImageFileRecord,
) {
  let thumbnailPath = metadata.thumbnail_path
    ? path.join(runtimePaths.tempDir, metadata.thumbnail_path)
    : null;

  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    return {
      filePath: thumbnailPath,
      extension: path.extname(thumbnailPath) || '.webp',
    };
  }

  const originalPath = resolveUploadsPath(file.original_file_path);
  if (!fs.existsSync(originalPath)) {
    return null;
  }

  try {
    const relativeThumbPath = await ThumbnailGenerator.generateThumbnail(originalPath, compositeHash);
    MediaMetadataModel.update(compositeHash, { thumbnail_path: relativeThumbPath });
    const regeneratedPath = path.join(runtimePaths.tempDir, relativeThumbPath);
    if (fs.existsSync(regeneratedPath)) {
      return {
        filePath: regeneratedPath,
        extension: path.extname(regeneratedPath) || '.webp',
      };
    }
  } catch (error) {
    console.error(`[ImageDownload] Failed to regenerate thumbnail for ${file.composite_hash}:`, error);
  }

  return null;
}

export async function resolveDownloadFileForType(
  compositeHash: string,
  metadata: Pick<ImageMetadataRecord, 'thumbnail_path'>,
  file: ImageFileRecord,
  downloadType: ImageDownloadType,
) {
  if (downloadType === 'thumbnail') {
    return resolveThumbnailDownloadFile(compositeHash, metadata, file);
  }

  const originalPath = resolveUploadsPath(file.original_file_path);
  if (!fs.existsSync(originalPath)) {
    return null;
  }

  return {
    filePath: originalPath,
    extension: path.extname(file.original_file_path) || '.bin',
  };
}

interface BatchDownloadArchiveEntry {
  filePath: string;
  name: string;
}

/** Resolve batch files with two bulk DB queries before streaming the archive. */
async function prepareBatchDownloadArchive(
  compositeHashes: string[],
  downloadType: ImageDownloadType = 'original',
  options: { includeHidden?: boolean } = {},
) {
  const usedNames = new Map<string, number>();
  let totalSourceBytes = 0;
  const limitedHashes = compositeHashes.slice(0, MAX_BATCH_DOWNLOAD_FILE_COUNT);
  const metadataByHash = new Map(
    MediaMetadataModel.findByHashes(limitedHashes).map((metadata) => [metadata.composite_hash, metadata]),
  );
  const fileByHash = new Map<string, ImageFileRecord>();
  for (const file of ImageFileModel.findActiveByHashes(limitedHashes)) {
    if (file.composite_hash && !fileByHash.has(file.composite_hash)) {
      fileByHash.set(file.composite_hash, file);
    }
  }
  const entries: BatchDownloadArchiveEntry[] = [];

  for (const compositeHash of limitedHashes) {
    const metadata = metadataByHash.get(compositeHash);
    if (
      !metadata ||
      !MediaPostprocessVisibilityService.isReadyRecord(metadata) ||
      (!options.includeHidden && ImageSafetyService.isHidden(metadata.rating_score))
    ) {
      continue;
    }

    const file = fileByHash.get(compositeHash);
    if (!file) {
      continue;
    }

    const resolved = await resolveDownloadFileForType(compositeHash, metadata, file, downloadType);
    if (!resolved) {
      continue;
    }

    const stats = await fs.promises.stat(resolved.filePath);
    totalSourceBytes += stats.size;
    if (totalSourceBytes > MAX_BATCH_DOWNLOAD_TOTAL_SOURCE_BYTES) {
      throw new BatchDownloadLimitError(`Batch download is limited to ${MAX_BATCH_DOWNLOAD_TOTAL_SOURCE_BYTES} bytes of source files`);
    }

    const parsedName = path.parse(file.original_file_path);
    const baseName = parsedName.name || `${compositeHash}`;
    const extension = downloadType === 'thumbnail'
      ? resolved.extension || '.webp'
      : (parsedName.ext || resolved.extension || '.bin');
    const candidateName = `${baseName}${extension}`;
    const duplicateCount = usedNames.get(candidateName) || 0;
    usedNames.set(candidateName, duplicateCount + 1);
    const finalName = duplicateCount === 0
      ? candidateName
      : `${baseName}-${duplicateCount}${extension}`;

    entries.push({ filePath: resolved.filePath, name: finalName });
  }

  if (entries.length === 0) {
    return null;
  }

  return {
    archiveName: `conai-images-${downloadType}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
    entries,
  };
}

/** Stream a zip archive with filesystem backpressure instead of buffering it in RAM. */
export async function streamBatchDownloadArchive(
  res: Response,
  compositeHashes: string[],
  downloadType: ImageDownloadType = 'original',
  options: { includeHidden?: boolean } = {},
): Promise<boolean> {
  const prepared = await prepareBatchDownloadArchive(compositeHashes, downloadType, options);
  if (!prepared) {
    return false;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${prepared.archiveName}"; filename*=UTF-8''${encodeURIComponent(prepared.archiveName)}`);

  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const fail = (error: Error) => reject(error);

    archive.once('error', fail);
    res.once('error', fail);
    res.once('close', () => {
      if (!res.writableFinished) {
        archive.abort();
        resolve();
      }
    });
    res.once('finish', resolve);
    archive.pipe(res);

    for (const entry of prepared.entries) {
      archive.file(entry.filePath, { name: entry.name });
    }

    void archive.finalize();
  });

  return true;
}

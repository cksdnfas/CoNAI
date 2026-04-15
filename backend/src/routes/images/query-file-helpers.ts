import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import AdmZip from 'adm-zip';
import type { Request, Response } from 'express';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import type { ImageFileRecord, ImageMetadataRecord } from '../../types/image';
import { logger } from '../../utils/logger';
import { routeParam } from '../routeParam';

export type ImageDownloadType = 'original' | 'thumbnail';

export interface ImageServeDiagnostics {
  mode?: 'thumbnail' | 'original' | 'video';
  hadThumbnailPath?: boolean;
  thumbnailExistsAtStart?: boolean;
  thumbnailRegenerated?: boolean;
  thumbnailRegenMs?: number;
  servedOriginalFallback?: boolean;
  cacheStatMs?: number;
  etagHit?: boolean;
}

/** Build a stable ETag from file mtime and size. */
export function generateETag(stats: fs.Stats): string {
  const hash = crypto.createHash('md5');
  hash.update(`${stats.mtime.getTime()}-${stats.size}`);
  return `"${hash.digest('hex')}"`;
}

/** Validate the composite-hash route param and send the shared 400 response when invalid. */
export function getCompositeHashOrBlock(req: Request, res: Response) {
  const compositeHash = routeParam(routeParam(req.params.compositeHash));

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
    return null;
  }

  return compositeHash;
}

/** Load visible metadata for one image and block hidden-policy access centrally. */
export async function getVisibleMetadataOrBlock(res: Response, compositeHash: string) {
  const metadata = await MediaMetadataModel.findByHash(compositeHash);

  if (!metadata) {
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
  const files = await ImageFileModel.findActiveByHash(compositeHash);

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
    res.status(404).json({
      success: false,
      error: options.missingError
    });
    return null;
  }

  return filePath;
}

/** Build the detail-route image payload from visible metadata and one active file. */
export function buildImageWithFileViewData(metadata: ImageMetadataRecord, file: ImageFileRecord) {
  return {
    ...metadata,
    file_id: file.id,
    original_file_path: file.original_file_path,
    file_size: file.file_size,
    mime_type: file.mime_type || 'image/jpeg',
    file_type: file.file_type
  };
}

/** Stream a video-like file with range support and long-lived caching headers. */
export function streamRangeFile(req: Request, res: Response, filePath: string, mimeType: string) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    });

    fileStream.pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable'
  });

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
}

/** Stream one static file with ETag handling and immutable cache headers. */
export async function streamCacheableFile(
  req: Request,
  res: Response,
  filePath: string,
  contentType: string,
  diagnostics?: ImageServeDiagnostics,
) {
  const statStartedAt = Date.now();
  const stats = await fs.promises.stat(filePath);
  if (diagnostics) {
    diagnostics.cacheStatMs = Date.now() - statStartedAt;
  }

  const etag = generateETag(stats);

  if (req.headers['if-none-match'] === etag) {
    if (diagnostics) {
      diagnostics.etagHit = true;
    }
    res.status(304).end();
    return;
  }

  if (diagnostics) {
    diagnostics.etagHit = false;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('ETag', etag);

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
}

/** Serve the thumbnail path, regenerate it when missing, or fall back to the original file. */
export async function serveThumbnailOrOriginal(
  req: Request,
  res: Response,
  compositeHash: string,
  metadata: ImageMetadataRecord,
  file: ImageFileRecord,
  diagnostics?: ImageServeDiagnostics,
) {
  const mimeType = file.mime_type;
  const fileType = file.file_type;

  if ((mimeType && mimeType.startsWith('video/')) || fileType === 'animated') {
    if (diagnostics) {
      diagnostics.mode = 'video';
    }

    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Video file not found',
      warnMessage: `[ImageServe] Video file missing on disk: ${resolveUploadsPath(file.original_file_path)}`,
    });

    if (!originalPath) {
      return;
    }

    streamRangeFile(req, res, originalPath, mimeType);
    return;
  }

  let thumbnailPath = metadata.thumbnail_path
    ? path.join(runtimePaths.tempDir, metadata.thumbnail_path)
    : null;

  if (diagnostics) {
    diagnostics.mode = 'thumbnail';
    diagnostics.hadThumbnailPath = Boolean(metadata.thumbnail_path);
    diagnostics.thumbnailExistsAtStart = Boolean(thumbnailPath && fs.existsSync(thumbnailPath));
  }

  let serveOriginal = false;

  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) {
    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Thumbnail and original file not found',
      warnMessage: `[ImageServe] Both thumbnail and original missing: ${file.original_file_path}`,
    });

    if (!originalPath) {
      return;
    }

    try {
      logger.debug('[ImageServe] Regenerating missing thumbnail', { compositeHash, originalPath });
      const regenStartedAt = Date.now();
      const relativeThumbPath = await ThumbnailGenerator.generateThumbnail(originalPath, compositeHash);
      MediaMetadataModel.update(compositeHash, { thumbnail_path: relativeThumbPath });
      thumbnailPath = path.join(runtimePaths.tempDir, relativeThumbPath);

      if (diagnostics) {
        diagnostics.thumbnailRegenerated = true;
        diagnostics.thumbnailRegenMs = Date.now() - regenStartedAt;
      }

      if (!fs.existsSync(thumbnailPath)) {
        serveOriginal = true;
      }
    } catch (err) {
      console.error(`[ImageServe] Failed to regenerate thumbnail: ${err}`);
      serveOriginal = true;
    }
  }

  if (serveOriginal) {
    if (diagnostics) {
      diagnostics.mode = 'original';
      diagnostics.servedOriginalFallback = true;
    }

    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Original file not found',
    });

    if (!originalPath) {
      return;
    }

    await streamCacheableFile(req, res, originalPath, mimeType, diagnostics);
    return;
  }

  if (!thumbnailPath) {
    res.status(404).json({ success: false, error: 'Thumbnail path error' });
    return;
  }

  await streamCacheableFile(req, res, thumbnailPath, 'image/webp', diagnostics);
}

async function resolveThumbnailDownloadFile(compositeHash: string, metadata: ImageMetadataRecord, file: ImageFileRecord) {
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
  metadata: ImageMetadataRecord,
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

/** Build a zip archive from visible active files for batch download. */
export async function buildBatchDownloadArchive(compositeHashes: string[], downloadType: ImageDownloadType = 'original') {
  const zip = new AdmZip();
  const usedNames = new Map<string, number>();
  let addedCount = 0;

  for (const compositeHash of compositeHashes) {
    const metadata = MediaMetadataModel.findByHash(compositeHash);
    if (!metadata || ImageSafetyService.isHidden(metadata.rating_score)) {
      continue;
    }

    const files = ImageFileModel.findActiveByHash(compositeHash);
    if (files.length === 0) {
      continue;
    }

    const file = files[0];
    const resolved = await resolveDownloadFileForType(compositeHash, metadata, file, downloadType);
    if (!resolved) {
      continue;
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

    zip.addLocalFile(resolved.filePath, '', finalName);
    addedCount += 1;
  }

  if (addedCount === 0) {
    return null;
  }

  return {
    archiveName: `conai-images-${downloadType}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
    zipBuffer: zip.toBuffer()
  };
}

/** Resolve the content type for path-based file serving. */
export function getMimeTypeFromFilePath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska'
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

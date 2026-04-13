import fs from 'fs';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageSafetyService } from '../../services/imageSafetyService';
import type { ImageFileRecord } from '../../types/image';
import { routeParam } from '../routeParam';

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
export async function streamCacheableFile(req: Request, res: Response, filePath: string, contentType: string) {
  const stats = await fs.promises.stat(filePath);
  const etag = generateETag(stats);

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('ETag', etag);

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
}

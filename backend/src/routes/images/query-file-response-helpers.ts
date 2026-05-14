import crypto from 'crypto';
import fs from 'fs';
import type { Request, Response } from 'express';
import { routeParam } from '../routeParam';

const IMMUTABLE_FILE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Build a stable ETag from file mtime and size. */
function generateETag(stats: fs.Stats): string {
  const hash = crypto.createHash('md5');
  hash.update(`${stats.mtime.getTime()}-${stats.size}`);
  return `"${hash.digest('hex')}"`;
}

function getHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function getFileCacheValidators(stats: fs.Stats) {
  return {
    etag: generateETag(stats),
    lastModified: stats.mtime.toUTCString(),
  };
}

function parseHttpDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isSameOrOlderThanHeaderDate(stats: fs.Stats, headerDateMs: number) {
  return Math.floor(stats.mtimeMs / 1000) <= Math.floor(headerDateMs / 1000);
}

function matchesIfNoneMatch(ifNoneMatchHeader: string | undefined, etag: string) {
  if (!ifNoneMatchHeader) {
    return false;
  }

  return ifNoneMatchHeader
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value === etag || value === `W/${etag}`);
}

function shouldReturnNotModified(req: Request, stats: fs.Stats, etag: string) {
  const ifNoneMatch = getHeaderValue(req.headers['if-none-match']);
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return true;
  }

  if (ifNoneMatch) {
    return false;
  }

  const ifModifiedSince = parseHttpDate(getHeaderValue(req.headers['if-modified-since']));
  return ifModifiedSince !== null && isSameOrOlderThanHeaderDate(stats, ifModifiedSince);
}

function shouldHonorRangeRequest(req: Request, stats: fs.Stats, etag: string) {
  const ifRange = getHeaderValue(req.headers['if-range']);
  if (!ifRange) {
    return true;
  }

  if (ifRange.startsWith('"') || ifRange.startsWith('W/')) {
    return ifRange === etag;
  }

  const ifRangeDate = parseHttpDate(ifRange);
  return ifRangeDate !== null && isSameOrOlderThanHeaderDate(stats, ifRangeDate);
}

function setImmutableCacheHeaders(
  res: Response,
  validators: ReturnType<typeof getFileCacheValidators>,
) {
  res.setHeader('Cache-Control', IMMUTABLE_FILE_CACHE_CONTROL);
  res.setHeader('ETag', validators.etag);
  res.setHeader('Last-Modified', validators.lastModified);
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

/** Stream a video-like file with range support and long-lived caching headers. */
export function streamRangeFile(req: Request, res: Response, filePath: string, mimeType: string) {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const validators = getFileCacheValidators(stats);
  const { etag } = validators;
  const range = getHeaderValue(req.headers.range);

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  setImmutableCacheHeaders(res, validators);

  if (!range) {
    if (shouldReturnNotModified(req, stats, etag)) {
      res.status(304).end();
      return;
    }

    res.status(200);
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (!shouldHonorRangeRequest(req, stats, etag)) {
    res.status(200);
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const startText = parts[0]?.trim() ?? '';
  const endText = parts[1]?.trim() ?? '';

  let start = startText ? parseInt(startText, 10) : 0;
  let end = endText ? parseInt(endText, 10) : fileSize - 1;

  if (!startText && endText) {
    const suffixLength = parseInt(endText, 10);
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else if (startText && !endText) {
    end = fileSize - 1;
  }

  end = Math.min(end, fileSize - 1);

  if (
    Number.isNaN(start)
    || Number.isNaN(end)
    || start < 0
    || end < start
    || start >= fileSize
  ) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${fileSize}`);
    res.end();
    return;
  }

  const chunkSize = (end - start) + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  res.setHeader('Content-Length', chunkSize);
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

/** Stream one static file with ETag handling and immutable cache headers. */
export async function streamCacheableFile(
  req: Request,
  res: Response,
  filePath: string,
  contentType: string,
) {
  const stats = await fs.promises.stat(filePath);
  const validators = getFileCacheValidators(stats);
  const { etag } = validators;
  const isNotModified = shouldReturnNotModified(req, stats, etag);

  setImmutableCacheHeaders(res, validators);

  if (isNotModified) {
    res.status(304).end();
    return;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);
  fs.createReadStream(filePath).pipe(res);
}

/** Resolve the content type for path-based file serving. */
export function getMimeTypeFromFilePath(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska'
  };

  return ext ? (mimeTypes[ext] || 'application/octet-stream') : 'application/octet-stream';
}

import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  MAX_MULTIPLE_UPLOAD_FILES,
  MAX_MULTIPLE_UPLOAD_TOTAL_BYTES,
} from '../../middleware/upload';
import { ImageProcessor } from '../../services/imageProcessor';
import { VideoProcessor } from '../../services/videoProcessor';
import { logger } from '../../utils/logger';

const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPLE_UPLOAD_REQUEST_BYTES = MAX_MULTIPLE_UPLOAD_TOTAL_BYTES + MULTIPART_OVERHEAD_ALLOWANCE_BYTES;
const IMAGE_UPLOAD_PAYLOAD_PATHS = new Set([
  '/upload',
  '/upload-multiple',
  '/upload-multiple-stream',
  '/convert-webp',
  '/rewrite-metadata',
  '/extract-metadata',
  '/extract-tagger',
  '/extract-kaloscope',
]);

const IMAGE_SIGNATURE_MIME_TYPES = [
  { mimeType: 'image/jpeg', matches: (header: Buffer) => header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff },
  { mimeType: 'image/png', matches: (header: Buffer) => header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mimeType: 'image/webp', matches: (header: Buffer) => header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mimeType: 'image/gif', matches: (header: Buffer) => ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString('ascii')) },
  { mimeType: 'image/bmp', matches: (header: Buffer) => header.subarray(0, 2).toString('ascii') === 'BM' },
  { mimeType: 'image/tiff', matches: (header: Buffer) => header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])) },
] as const;

const VIDEO_FORMAT_ALIASES: Record<string, readonly string[]> = {
  'video/mp4': ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
  'video/quicktime': ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
  'video/webm': ['matroska', 'webm'],
  'video/x-matroska': ['matroska', 'webm'],
  'video/x-msvideo': ['avi'],
};

export class UploadValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 415) {
    super(message);
    this.name = 'UploadValidationError';
    this.statusCode = statusCode;
  }
}

/** Flatten Multer field arrays into one stable request file list. */
export function listRequestUploadFiles(req: Request): Express.Multer.File[] {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  if (!req.files || typeof req.files !== 'object') {
    return [];
  }

  return Object.values(req.files).flat();
}

/** Record only non-sensitive upload metrics used by the completion audit log. */
export function setUploadAuditMetrics(res: Response, files: readonly Express.Multer.File[]): void {
  res.locals.uploadAuditMetrics = {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0),
  };
}

/** Add a stable rejection reason to the current upload audit entry. */
export function setUploadAuditReason(res: Response, reason: string): void {
  res.locals.uploadAuditReason = reason;
}

/** Write one upload decision to the normal retained application log. */
export function auditUploadRequest(scope: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.once('finish', () => {
      const metrics = res.locals.uploadAuditMetrics as { fileCount?: number; totalBytes?: number } | undefined;
      const record = {
        event: res.statusCode < 400 ? 'upload.allowed' : 'upload.denied',
        scope,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        accountId: req.session?.accountId ?? null,
        accountType: req.session?.accountType ?? (req.session?.authenticated ? 'bootstrap' : 'anonymous'),
        ip: req.ip,
        fileCount: metrics?.fileCount ?? 0,
        totalBytes: metrics?.totalBytes ?? 0,
        reason: typeof res.locals.uploadAuditReason === 'string'
          ? res.locals.uploadAuditReason
          : (res.statusCode === 401 || res.statusCode === 403) ? 'permission_denied' : null,
        durationMs: Date.now() - startedAt,
      };

      const message = `[UploadAudit] ${JSON.stringify(record)}`;
      if (res.statusCode < 400) {
        logger.info(message);
      } else {
        logger.warn(message);
      }
    });

    next();
  };
}

/** Best-effort deletion for temporary Multer files. */
export async function cleanupTemporaryUploads(files: readonly Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map(async (file) => {
    if (!file.path) {
      return;
    }

    try {
      await fs.promises.unlink(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[UploadCleanup] Failed to delete staged upload', file.path, error);
      }
    }
  }));
}

/** Best-effort deletion for one uniquely named final upload artifact. */
export async function cleanupStoredUpload(baseUploadPath: string, relativePath: string): Promise<void> {
  const resolvedBase = path.resolve(baseUploadPath);
  const resolvedTarget = path.resolve(resolvedBase, relativePath);
  if (resolvedTarget === resolvedBase || !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    logger.warn('[UploadCleanup] Refused to delete a path outside the upload root', relativePath);
    return;
  }

  try {
    await fs.promises.unlink(resolvedTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('[UploadCleanup] Failed to delete final upload', resolvedTarget, error);
    }
  }
}

/** Reject known oversized multipart requests before Multer writes their contents. */
export const rejectOversizedMultipleUploadRequest: RequestHandler = (req, res, next) => {
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPLE_UPLOAD_REQUEST_BYTES) {
    setUploadAuditReason(res, 'request_too_large');
    res.status(413).json({
      success: false,
      error: `Combined upload request exceeds ${MAX_MULTIPLE_UPLOAD_TOTAL_BYTES} bytes`,
    });
    return;
  }

  next();
};

/** Enforce aggregate limits after parsing as a fallback for chunked multipart requests. */
export const enforceMultipleUploadLimits: RequestHandler = async (req, res, next) => {
  const files = listRequestUploadFiles(req);
  setUploadAuditMetrics(res, files);
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0);

  if (files.length > MAX_MULTIPLE_UPLOAD_FILES || totalBytes > MAX_MULTIPLE_UPLOAD_TOTAL_BYTES) {
    setUploadAuditReason(res, files.length > MAX_MULTIPLE_UPLOAD_FILES ? 'too_many_files' : 'combined_size_exceeded');
    await cleanupTemporaryUploads(files);
    res.status(413).json({
      success: false,
      error: `Upload is limited to ${MAX_MULTIPLE_UPLOAD_FILES} files and ${MAX_MULTIPLE_UPLOAD_TOTAL_BYTES} combined bytes`,
    });
    return;
  }

  next();
};

async function readUploadHeader(filePath: string): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function validateImageUpload(file: Express.Multer.File): Promise<void> {
  const header = await readUploadHeader(file.path);
  const detectedMimeType = IMAGE_SIGNATURE_MIME_TYPES.find((candidate) => candidate.matches(header))?.mimeType ?? null;
  if (!detectedMimeType || detectedMimeType !== file.mimetype.toLowerCase()) {
    throw new UploadValidationError(`Uploaded file content does not match declared type ${file.mimetype}`);
  }

  const imageInfo = await ImageProcessor.getImageInfo(file.path);
  if (imageInfo.width <= 0 || imageInfo.height <= 0) {
    throw new UploadValidationError('Uploaded image has invalid dimensions');
  }
}

async function validateVideoUpload(file: Express.Multer.File): Promise<void> {
  const allowedFormats = VIDEO_FORMAT_ALIASES[file.mimetype.toLowerCase()];
  if (!allowedFormats) {
    throw new UploadValidationError(`Unsupported video type: ${file.mimetype}`);
  }

  const metadata = await VideoProcessor.extractMetadata(file.path);
  const actualFormats = new Set(metadata.format.toLowerCase().split(',').map((value) => value.trim()).filter(Boolean));
  if (!allowedFormats.some((format) => actualFormats.has(format))) {
    throw new UploadValidationError(`Uploaded file content does not match declared type ${file.mimetype}`);
  }
}

/** Validate decoded media and declared MIME before any library file is created. */
export async function validateUploadedMediaFile(file: Express.Multer.File): Promise<void> {
  if (!file.path) {
    throw new UploadValidationError('Temporary upload path is missing', 400);
  }

  try {
    if (file.mimetype.toLowerCase().startsWith('image/')) {
      await validateImageUpload(file);
      return;
    }

    if (file.mimetype.toLowerCase().startsWith('video/')) {
      await validateVideoUpload(file);
      return;
    }
  } catch (error) {
    if (error instanceof UploadValidationError) {
      throw error;
    }

    throw new UploadValidationError(`Uploaded file is not valid ${file.mimetype} media`);
  }

  throw new UploadValidationError(`Unsupported file type: ${file.mimetype}`);
}

/** Identify image-router requests that carry staged upload payloads. */
export function isImageUploadPayloadRequest(req: Request): boolean {
  if (req.method !== 'POST') {
    return false;
  }

  return IMAGE_UPLOAD_PAYLOAD_PATHS.has(req.path);
}

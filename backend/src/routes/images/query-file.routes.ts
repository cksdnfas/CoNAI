import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { enrichImageWithFileView } from './utils';
import {
  buildBatchDownloadArchive,
  buildImageWithFileViewData,
  getActiveFileOrBlock,
  getCompositeHashOrBlock,
  getExistingActiveFilePathOrBlock,
  getMimeTypeFromFilePath,
  getVisibleMetadataOrBlock,
  resolveDownloadFileForType,
  serveThumbnailOrOriginal,
  streamCacheableFile,
  streamRangeFile,
  type ImageDownloadType,
  type ImageServeDiagnostics,
} from './query-file-helpers';
import { routeParam } from '../routeParam';
import { logger } from '../../utils/logger';

const router = Router();
const SLOW_IMAGE_REQUEST_MS = 300;

function attachImagePerfLog(
  req: Request,
  res: Response,
  label: string,
  details: Record<string, unknown>,
) {
  const startedAt = Date.now();

  res.once('finish', () => {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= SLOW_IMAGE_REQUEST_MS) {
      logger.debug(`[ImagePerf][${label}]`, {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        elapsedMs,
        ...details,
      });
    }
  });
}

function parseImageDownloadType(value: unknown): ImageDownloadType {
  return value === 'thumbnail' ? 'thumbnail' : 'original';
}

async function handleTypedImageDownload(req: Request, res: Response, forcedType?: ImageDownloadType) {
  const compositeHash = getCompositeHashOrBlock(req, res);

  if (!compositeHash) {
    return;
  }

  const metadata = await getVisibleMetadataOrBlock(res, compositeHash);
  if (!metadata) {
    return;
  }

  const file = await getActiveFileOrBlock(res, compositeHash, 'Image file not found');
  if (!file) {
    return;
  }

  const downloadType = forcedType ?? parseImageDownloadType(req.query.type);
  const resolved = await resolveDownloadFileForType(compositeHash, metadata, file, downloadType);
  if (!resolved) {
    res.status(404).json({
      success: false,
      error: `Requested ${downloadType} file not found`
    });
    return;
  }

  const parsedOriginalName = path.parse(file.original_file_path);
  const filename = downloadType === 'thumbnail'
    ? `${parsedOriginalName.name || compositeHash}${resolved.extension || '.webp'}`
    : (parsedOriginalName.base || `${compositeHash}${resolved.extension || '.bin'}`);
  const encodedFilename = encodeURIComponent(filename);
  const contentType = downloadType === 'thumbnail' ? 'image/webp' : (file.mime_type || getMimeTypeFromFilePath(resolved.filePath));

  res.setHeader('Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
  );
  res.setHeader('Content-Type', contentType);

  const fileStream = fs.createReadStream(resolved.filePath);
  fileStream.pipe(res);
}

router.get('/:compositeHash', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = getCompositeHashOrBlock(req, res);

  if (!compositeHash) {
    return;
  }

  try {
    const file = await getActiveFileOrBlock(res, compositeHash, 'File not found');

    if (!file) {
      return;
    }

    const metadata = await getVisibleMetadataOrBlock(res, compositeHash);

    if (!metadata) {
      return;
    }

    res.json({
      success: true,
      data: enrichImageWithFileView(buildImageWithFileViewData(metadata, file))
    });
    return;
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch image'
    });
    return;
  }
}));

router.get('/:compositeHash/file', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = getCompositeHashOrBlock(req, res);

  if (!compositeHash) {
    return;
  }

  const details: Record<string, unknown> = { compositeHash };
  attachImagePerfLog(req, res, 'file', details);

  try {
    const metadataStartedAt = Date.now();
    if (!(await getVisibleMetadataOrBlock(res, compositeHash))) {
      return;
    }
    details.metadataMs = Date.now() - metadataStartedAt;

    const fileLookupStartedAt = Date.now();
    const file = await getActiveFileOrBlock(res, compositeHash, 'File not found');
    details.fileLookupMs = Date.now() - fileLookupStartedAt;

    if (!file) {
      return;
    }

    const pathCheckStartedAt = Date.now();
    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'File not found on disk',
      warnMessage: `[ImageServe] File missing on disk during raw file access: ${resolveUploadsPath(file.original_file_path)}`,
    });
    details.pathCheckMs = Date.now() - pathCheckStartedAt;

    if (!originalPath) {
      return;
    }

    const mimeType = file.mime_type;
    details.mimeType = mimeType;

    if (mimeType && mimeType.startsWith('video/')) {
      details.streamMode = 'video';
      streamRangeFile(req, res, originalPath, mimeType);
      return;
    }

    const diagnostics: ImageServeDiagnostics = { mode: 'original' };
    await streamCacheableFile(req, res, originalPath, mimeType, diagnostics);
    Object.assign(details, diagnostics);
    return;
  } catch (error) {
    console.error('File serve error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve file'
    });
    return;
  }
}));

router.get('/:compositeHash/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = getCompositeHashOrBlock(req, res);

  if (!compositeHash) {
    return;
  }

  const details: Record<string, unknown> = { compositeHash };
  attachImagePerfLog(req, res, 'thumbnail', details);

  try {
    const metadataStartedAt = Date.now();
    const metadata = await getVisibleMetadataOrBlock(res, compositeHash);
    details.metadataMs = Date.now() - metadataStartedAt;

    if (!metadata) {
      return;
    }

    const fileLookupStartedAt = Date.now();
    const file = await getActiveFileOrBlock(res, compositeHash, 'Image file not found');
    details.fileLookupMs = Date.now() - fileLookupStartedAt;
    if (!file) {
      return;
    }

    const diagnostics: ImageServeDiagnostics = {};
    await serveThumbnailOrOriginal(req, res, compositeHash, metadata, file, diagnostics);
    Object.assign(details, diagnostics);
    return;
  } catch (error) {
    console.error('Thumbnail error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve thumbnail'
    });
    return;
  }
}));

router.post('/download/batch', asyncHandler(async (req: Request, res: Response) => {
  const compositeHashes = Array.isArray(req.body?.compositeHashes)
    ? req.body.compositeHashes.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const downloadType = parseImageDownloadType(req.body?.type);

  const uniqueHashes = Array.from(new Set<string>(compositeHashes)).filter((hash: string) => hash.length === 48 || hash.length === 32);

  if (uniqueHashes.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No valid composite hashes provided'
    });
  }

  try {
    const archive = await buildBatchDownloadArchive(uniqueHashes, downloadType);

    if (!archive) {
      return res.status(404).json({
        success: false,
        error: `No downloadable ${downloadType} files were found`
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', archive.zipBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${archive.archiveName}"; filename*=UTF-8''${encodeURIComponent(archive.archiveName)}`);
    res.send(archive.zipBuffer);
    return;
  } catch (error) {
    console.error('Batch download error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create download archive'
    });
  }
}));

router.get('/:compositeHash/download', asyncHandler(async (req: Request, res: Response) => {
  try {
    await handleTypedImageDownload(req, res);
    return;
  } catch (error) {
    console.error('Typed download error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download image'
    });
    return;
  }
}));

router.get('/:compositeHash/download/original', asyncHandler(async (req: Request, res: Response) => {
  try {
    await handleTypedImageDownload(req, res, 'original');
    return;
  } catch (error) {
    console.error('Original download error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download original image'
    });
    return;
  }
}));

router.get('/by-path/:encodedPath', asyncHandler(async (req: Request, res: Response) => {
  const encodedPath = routeParam(routeParam(req.params.encodedPath));

  try {
    const filePath = decodeURIComponent(encodedPath);
    const fileRecord = ImageFileModel.findByPath(filePath);

    if (fileRecord?.file_status === 'active' && fileRecord.composite_hash) {
      const metadata = await MediaMetadataModel.findByHash(fileRecord.composite_hash);
      if (metadata && ImageSafetyService.isHidden(metadata.rating_score)) {
        return res.status(403).json({
          success: false,
          error: 'This image is hidden by the current safety policy'
        });
      }
    }

    const resolvedPath = resolveUploadsPath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    res.setHeader('Content-Type', getMimeTypeFromFilePath(filePath));
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const fileStream = fs.createReadStream(resolvedPath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Path-based image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve image'
    });
    return;
  }
}));

router.get('/placeholder', asyncHandler(async (req: Request, res: Response) => {
  try {
    const placeholderPath = resolveUploadsPath('placeholder-image.svg');

    if (!fs.existsSync(placeholderPath)) {
      return res.status(404).json({
        success: false,
        error: 'Placeholder image not found'
      });
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const fileStream = fs.createReadStream(placeholderPath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Placeholder image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve placeholder image'
    });
    return;
  }
}));

export { router as queryFileRoutes };

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
  serveThumbnailOrOriginal,
  streamCacheableFile,
  streamRangeFile,
} from './query-file-helpers';
import { routeParam } from '../routeParam';

const router = Router();

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

  try {
    if (!(await getVisibleMetadataOrBlock(res, compositeHash))) {
      return;
    }

    const file = await getActiveFileOrBlock(res, compositeHash, 'File not found');

    if (!file) {
      return;
    }

    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'File not found on disk',
      warnMessage: `[ImageServe] File missing on disk during raw file access: ${resolveUploadsPath(file.original_file_path)}`,
    });

    if (!originalPath) {
      return;
    }

    const mimeType = file.mime_type;

    if (mimeType && mimeType.startsWith('video/')) {
      streamRangeFile(req, res, originalPath, mimeType);
      return;
    }

    await streamCacheableFile(req, res, originalPath, mimeType);
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

  try {
    const metadata = await getVisibleMetadataOrBlock(res, compositeHash);

    if (!metadata) {
      return;
    }

    const file = await getActiveFileOrBlock(res, compositeHash, 'Image file not found');
    if (!file) {
      return;
    }

    await serveThumbnailOrOriginal(req, res, compositeHash, metadata, file);
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

  const uniqueHashes = Array.from(new Set<string>(compositeHashes)).filter((hash: string) => hash.length === 48 || hash.length === 32);

  if (uniqueHashes.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No valid composite hashes provided'
    });
  }

  try {
    const archive = buildBatchDownloadArchive(uniqueHashes);

    if (!archive) {
      return res.status(404).json({
        success: false,
        error: 'No downloadable files were found'
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

router.get('/:compositeHash/download/original', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = getCompositeHashOrBlock(req, res);

  if (!compositeHash) {
    return;
  }

  try {
    if (!(await getVisibleMetadataOrBlock(res, compositeHash))) {
      return;
    }

    const file = await getActiveFileOrBlock(res, compositeHash, 'Image file not found');

    if (!file) {
      return;
    }

    const filePath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'File not found',
    });

    if (!filePath) {
      return;
    }

    const filename = path.basename(file.original_file_path);
    const encodedFilename = encodeURIComponent(filename);

    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Type', file.mime_type);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
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

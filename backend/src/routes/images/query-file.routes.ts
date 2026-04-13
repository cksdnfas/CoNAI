import { Router, Request, Response } from 'express';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { enrichImageWithFileView } from './utils';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import {
  getActiveFileOrBlock,
  getCompositeHashOrBlock,
  getExistingActiveFilePathOrBlock,
  getVisibleMetadataOrBlock,
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

    const imageWithFile = {
      ...metadata,
      file_id: file.id,
      original_file_path: file.original_file_path,
      file_size: file.file_size,
      mime_type: file.mime_type || 'image/jpeg',
      file_type: file.file_type
    };

    res.json({
      success: true,
      data: enrichImageWithFileView(imageWithFile)
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

    const mimeType = file.mime_type;
    const fileType = file.file_type;

    if ((mimeType && mimeType.startsWith('video/')) || fileType === 'animated') {
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
        console.log(`[ImageServe] Regenerating missing thumbnail for ${compositeHash}`);
        const relativeThumbPath = await ThumbnailGenerator.generateThumbnail(originalPath, compositeHash);
        MediaMetadataModel.update(compositeHash, { thumbnail_path: relativeThumbPath });
        thumbnailPath = path.join(runtimePaths.tempDir, relativeThumbPath);

        if (!fs.existsSync(thumbnailPath)) {
          serveOriginal = true;
        }
      } catch (err) {
        console.error(`[ImageServe] Failed to regenerate thumbnail: ${err}`);
        serveOriginal = true;
      }
    }

    if (serveOriginal) {
      const originalPath = getExistingActiveFilePathOrBlock(res, file, {
        missingError: 'Original file not found',
      });
      if (!originalPath) {
        return;
      }

      await streamCacheableFile(req, res, originalPath, mimeType);
      return;
    }

    if (!thumbnailPath) {
      return res.status(404).json({ success: false, error: 'Thumbnail path error' });
    }

    await streamCacheableFile(req, res, thumbnailPath, 'image/webp');
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
    const zip = new AdmZip();
    const usedNames = new Map<string, number>();
    let addedCount = 0;

    for (const compositeHash of uniqueHashes) {
      const metadata = MediaMetadataModel.findByHash(compositeHash);
      if (!metadata || ImageSafetyService.isHidden(metadata.rating_score)) {
        continue;
      }

      const files = ImageFileModel.findActiveByHash(compositeHash);
      if (files.length === 0) {
        continue;
      }

      const file = files[0];
      const filePath = resolveUploadsPath(file.original_file_path);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const parsedName = path.parse(file.original_file_path);
      const originalName = parsedName.base || `${compositeHash}`;
      const duplicateCount = usedNames.get(originalName) || 0;
      usedNames.set(originalName, duplicateCount + 1);
      const finalName = duplicateCount === 0
        ? originalName
        : `${parsedName.name}-${duplicateCount}${parsedName.ext}`;

      zip.addLocalFile(filePath, '', finalName);
      addedCount += 1;
    }

    if (addedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'No downloadable files were found'
      });
    }

    const zipBuffer = zip.toBuffer();
    const archiveName = `conai-images-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', zipBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`);
    res.send(zipBuffer);
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
    const resolvedPath = resolveUploadsPath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

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
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
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

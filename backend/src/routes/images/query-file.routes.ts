import { Router, Request, Response } from 'express';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { enrichImageWithFileView } from './utils';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import { routeParam } from '../routeParam';

const router = Router();

function generateETag(stats: fs.Stats): string {
  const hash = crypto.createHash('md5');
  hash.update(`${stats.mtime.getTime()}-${stats.size}`);
  return `"${hash.digest('hex')}"`;
}

router.get('/:compositeHash', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = routeParam(routeParam(req.params.compositeHash));

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const files = await ImageFileModel.findActiveByHash(compositeHash);

    if (!files || files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const metadata = await MediaMetadataModel.findByHash(compositeHash);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Metadata not found'
      });
    }

    const imageWithFile = {
      ...metadata,
      file_id: files[0].id,
      original_file_path: files[0].original_file_path,
      file_size: files[0].file_size,
      mime_type: files[0].mime_type || 'image/jpeg',
      file_type: files[0].file_type
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
  const compositeHash = routeParam(routeParam(req.params.compositeHash));

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const files = await ImageFileModel.findActiveByHash(compositeHash);

    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const originalPath = resolveUploadsPath(files[0].original_file_path);

    if (!fs.existsSync(originalPath)) {
      console.warn(`[ImageServe] File missing on disk during raw file access: ${originalPath}`);
      ImageFileModel.updateStatus(files[0].id, 'missing');

      return res.status(404).json({
        success: false,
        error: 'File not found on disk'
      });
    }

    const mimeType = files[0].mime_type;

    if (mimeType && mimeType.startsWith('video/')) {
      const stat = fs.statSync(originalPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        const fileStream = fs.createReadStream(originalPath, { start, end });

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

      const fileStream = fs.createReadStream(originalPath);
      fileStream.pipe(res);
      return;
    }

    const stats = await fs.promises.stat(originalPath);
    const etag = generateETag(stats);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);

    const fileStream = fs.createReadStream(originalPath);
    fileStream.pipe(res);
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
  const compositeHash = routeParam(routeParam(req.params.compositeHash));

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const metadata = await MediaMetadataModel.findByHash(compositeHash);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    const files = await ImageFileModel.findActiveByHash(compositeHash);
    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found'
      });
    }

    const mimeType = files[0].mime_type;

    if (mimeType && mimeType.startsWith('video/')) {
      const originalPath = resolveUploadsPath(files[0].original_file_path);

      if (!fs.existsSync(originalPath)) {
        console.warn(`[ImageServe] Video file missing on disk: ${originalPath}`);
        ImageFileModel.updateStatus(files[0].id, 'missing');

        return res.status(404).json({
          success: false,
          error: 'Video file not found'
        });
      }

      const stat = fs.statSync(originalPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        const fileStream = fs.createReadStream(originalPath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        const fileStream = fs.createReadStream(originalPath);
        fileStream.pipe(res);
      }
      return;
    }

    let thumbnailPath = metadata.thumbnail_path
      ? path.join(runtimePaths.tempDir, metadata.thumbnail_path)
      : null;

    let serveOriginal = false;

    if (!thumbnailPath || !fs.existsSync(thumbnailPath)) {
      const originalPath = resolveUploadsPath(files[0].original_file_path);

      if (!fs.existsSync(originalPath)) {
        console.warn(`[ImageServe] Both thumbnail and original missing: ${files[0].original_file_path}`);
        ImageFileModel.updateStatus(files[0].id, 'missing');

        return res.status(404).json({
          success: false,
          error: 'Thumbnail and original file not found'
        });
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
      const originalPath = resolveUploadsPath(files[0].original_file_path);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Original file not found'
        });
      }

      const stats = await fs.promises.stat(originalPath);
      const etag = generateETag(stats);

      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', etag);
      const fileStream = fs.createReadStream(originalPath);
      fileStream.pipe(res);
      return;
    }

    if (!thumbnailPath) {
      return res.status(404).json({ success: false, error: 'Thumbnail path error' });
    }

    const stats = await fs.promises.stat(thumbnailPath);
    const etag = generateETag(stats);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    const fileStream = fs.createReadStream(thumbnailPath);
    fileStream.pipe(res);
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
  const compositeHash = routeParam(routeParam(req.params.compositeHash));

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const files = await ImageFileModel.findActiveByHash(compositeHash);

    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found'
      });
    }

    const filePath = resolveUploadsPath(files[0].original_file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const filename = path.basename(files[0].original_file_path);
    const encodedFilename = encodeURIComponent(filename);

    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Type', files[0].mime_type);

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

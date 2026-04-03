import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { asyncHandler } from '../middleware/errorHandler';
import { ImageEditorService } from '../services/imageEditorService';
import { TempImageService, EditOptions } from '../services/tempImageService';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { publicUrls, runtimePaths } from '../config/runtimePaths';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { WebPConversionService } from '../services/webpConversionService';

const router = Router();
const SAVE_BROWSER_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** Normalize one relative save-path segment for browser-safe URL generation. */
function toSaveBrowserRelativePath(filePath: string) {
  return path.relative(runtimePaths.saveDir, filePath).replace(/\\/g, '/');
}

/** Walk the save directory recursively and collect image files for picker UIs. */
async function collectSaveBrowserImages(directoryPath: string): Promise<string[]> {
  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      collected.push(...await collectSaveBrowserImages(fullPath));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (SAVE_BROWSER_IMAGE_EXTENSIONS.has(extension)) {
      collected.push(fullPath);
    }
  }

  return collected;
}

/**
 * List save-folder images for attachment picker UIs.
 * GET /api/image-editor/save-images
 */
router.get('/save-images', asyncHandler(async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(runtimePaths.saveDir)) {
      return res.json({
        success: true,
        data: {
          items: [],
          total: 0,
        },
      });
    }

    const filePaths = await collectSaveBrowserImages(runtimePaths.saveDir);
    const items = await Promise.all(
      filePaths.map(async (filePath) => {
        const stats = await fs.promises.stat(filePath);
        const relativePath = toSaveBrowserRelativePath(filePath);

        return {
          id: relativePath,
          relative_path: relativePath,
          file_name: path.basename(filePath),
          url: `${publicUrls.saveBaseUrl}/${relativePath.split('/').map(encodeURIComponent).join('/')}`,
          mime_type: `image/${path.extname(filePath).replace('.', '').toLowerCase() || 'png'}`,
          file_size: stats.size,
          modified_at: stats.mtime.toISOString(),
        };
      }),
    );

    items.sort((left, right) => new Date(right.modified_at).getTime() - new Date(left.modified_at).getTime());

    return res.json({
      success: true,
      data: {
        items,
        total: items.length,
      },
    });
  } catch (error) {
    console.error('Error listing save-browser images:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list save images',
    });
  }
}));

/**
 * Get image as WebP for editing (original size, quality 100%)
 * GET /api/image-editor/:id/webp
 */
router.get('/:id/webp', asyncHandler(async (req: Request, res: Response) => {
  const imageId = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(imageId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const imageFile = ImageFileModel.findById(imageId);
    if (!imageFile) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found'
      });
    }

    const originalPath = imageFile.original_file_path;

    if (!fs.existsSync(originalPath)) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found on disk'
      });
    }

    const conversion = await WebPConversionService.convertFileToWebPBuffer(originalPath, {
      quality: 100,
      lossless: false,
      sourcePathForMetadata: originalPath,
      originalFileName: path.basename(originalPath),
      mimeType: imageFile.mime_type || 'image/webp',
    });

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=300'); // 5분 캐시
    return res.send(conversion.buffer);
  } catch (error) {
    console.error('Error converting image to WebP:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to convert image'
    });
  }
}));

/**
 * Create temporary edited image (volatile - for API transmission)
 * POST /api/image-editor/:id/temp
 */
router.post('/:id/temp', asyncHandler(async (req: Request, res: Response) => {
  const imageId = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(imageId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  const editOptions: EditOptions = req.body;

  try {
    const result = await ImageEditorService.editImage(imageId, editOptions);

    return res.json({
      success: true,
      data: {
        tempId: result.tempId,
        tempImagePath: result.tempImagePath,
        tempMaskPath: result.tempMaskPath,
        expiresAt: result.expiresAt,
        width: result.width,
        height: result.height
      }
    });
  } catch (error) {
    console.error('Error creating temp edited image:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create temporary edited image'
    });
  }
}));

/**
 * Save edited image to temp/canvas directory
 * POST /api/image-editor/:id/save
 * Body: { imageData: base64 string, maskData?: base64 string }
 */
router.post('/:id/save', asyncHandler(async (req: Request, res: Response) => {
  const imageId = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(imageId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  const { imageData, maskData } = req.body;

  if (!imageData) {
    return res.status(400).json({
      success: false,
      error: 'Image data is required'
    });
  }

  try {
    // Convert base64 to Buffer
    const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const maskBuffer = maskData ? Buffer.from(maskData.replace(/^data:image\/\w+;base64,/, ''), 'base64') : undefined;

    const result = await ImageEditorService.saveEditedImageAsNew(
      imageBuffer,
      imageId,
      maskBuffer
    );

    return res.json({
      success: true,
      data: {
        tempId: result.tempId,
        tempImagePath: result.tempImagePath,
        tempMaskPath: result.tempMaskPath,
        expiresAt: result.expiresAt,
        width: result.width,
        height: result.height,
        message: `Image saved to: ${path.dirname(result.tempImagePath)}`
      }
    });
  } catch (error) {
    console.error('Error saving edited image:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save edited image'
    });
  }
}));

/**
 * Save edited image with the requested output format (permanent save)
 * POST /api/image-editor/:id/save-output
 * Body: { imageData: base64 string, format?: 'png' | 'jpeg' | 'webp', quality?: number }
 */
router.post('/:id/save-output', asyncHandler(async (req: Request, res: Response) => {
  const imageId = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(imageId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  const { imageData, format = 'webp', quality = 90 } = req.body;

  if (!imageData) {
    return res.status(400).json({
      success: false,
      error: 'Image data is required'
    });
  }

  if (!['png', 'jpeg', 'webp'].includes(format)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid format'
    });
  }

  try {
    const result = await ImageEditorService.saveAsFormat(
      imageData,
      imageId,
      format,
      quality
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error saving edited image with output format:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save edited image'
    });
  }
}));

/**
 * Save edited image as WebP (permanent save)
 * POST /api/image-editor/:id/save-webp
 * Body: { imageData: base64 string, quality?: number (default 90) }
 */
router.post('/:id/save-webp', asyncHandler(async (req: Request, res: Response) => {
  const imageId = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(imageId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  const { imageData, quality = 90 } = req.body;

  if (!imageData) {
    return res.status(400).json({
      success: false,
      error: 'Image data is required'
    });
  }

  try {
    const result = await ImageEditorService.saveAsWebP(
      imageData,
      imageId,
      quality
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error saving edited image as WebP:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save edited image'
    });
  }
}));

/**
 * Delete temporary file
 * DELETE /api/image-editor/temp/:tempId
 */
router.delete('/temp/:tempId', asyncHandler(async (req: Request, res: Response) => {
  const tempId = routeParam(req.params.tempId);

  try {
    await TempImageService.deleteTempFile(tempId);

    return res.json({
      success: true,
      message: 'Temporary file deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting temp file:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete temporary file'
    });
  }
}));

/**
 * Get temporary file (serve the temp image)
 * GET /api/image-editor/temp/:tempId/image
 */
router.get('/temp/:tempId/image', asyncHandler(async (req: Request, res: Response) => {
  const tempId = routeParam(req.params.tempId);

  const tempInfo = TempImageService.getTempFileInfo(tempId);

  if (!tempInfo) {
    return res.status(404).json({
      success: false,
      error: 'Temporary file not found'
    });
  }

  // Check if file exists
  if (!fs.existsSync(tempInfo.tempPath)) {
    return res.status(404).json({
      success: false,
      error: 'Temporary file no longer exists'
    });
  }

  // Check if expired
  if (new Date() > tempInfo.expiresAt) {
    await TempImageService.deleteTempFile(tempId);
    return res.status(410).json({
      success: false,
      error: 'Temporary file has expired'
    });
  }

  // Serve the file
  return res.sendFile(tempInfo.tempPath);
}));

/**
 * Get temporary mask file
 * GET /api/image-editor/temp/:tempId/mask
 */
router.get('/temp/:tempId/mask', asyncHandler(async (req: Request, res: Response) => {
  const tempId = routeParam(req.params.tempId);

  const tempInfo = TempImageService.getTempFileInfo(tempId);

  if (!tempInfo || !tempInfo.tempMaskPath) {
    return res.status(404).json({
      success: false,
      error: 'Temporary mask file not found'
    });
  }

  // Check if file exists
  if (!fs.existsSync(tempInfo.tempMaskPath)) {
    return res.status(404).json({
      success: false,
      error: 'Temporary mask file no longer exists'
    });
  }

  // Check if expired
  if (new Date() > tempInfo.expiresAt) {
    await TempImageService.deleteTempFile(tempId);
    return res.status(410).json({
      success: false,
      error: 'Temporary file has expired'
    });
  }

  // Serve the mask file
  return res.sendFile(tempInfo.tempMaskPath);
}));

/**
 * Get all temp files info (for debugging)
 * GET /api/image-editor/temp
 */
router.get('/temp', asyncHandler(async (req: Request, res: Response) => {
  const tempFiles = TempImageService.getAllTempFiles();
  const stats = TempImageService.getStats();

  return res.json({
    success: true,
    data: {
      stats,
      files: tempFiles
    }
  });
}));

/**
 * Create blank mask
 * POST /api/image-editor/mask/blank
 */
router.post('/mask/blank', asyncHandler(async (req: Request, res: Response) => {
  const { width, height } = req.body;

  if (!width || !height || width <= 0 || height <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Valid width and height are required'
    });
  }

  try {
    const maskBuffer = await ImageEditorService.createBlankMask(width, height);

    // Return as base64
    const base64 = maskBuffer.toString('base64');

    return res.json({
      success: true,
      data: {
        mask: `data:image/png;base64,${base64}`,
        width,
        height
      }
    });
  } catch (error) {
    console.error('Error creating blank mask:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create blank mask'
    });
  }
}));

/**
 * Get canvas image as WebP for editing
 * GET /api/image-editor/canvas/:filename/webp
 */
router.get('/canvas/:filename/webp', asyncHandler(async (req: Request, res: Response) => {
  const filename = routeParam(req.params.filename);

  try {
    const canvasDir = runtimePaths.canvasDir;
    const filePath = path.join(canvasDir, filename);

    // Security check: ensure the file is within canvas directory
    const resolvedPath = path.resolve(filePath);
    const resolvedCanvasDir = path.resolve(canvasDir);

    if (!resolvedPath.startsWith(resolvedCanvasDir)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const conversion = await WebPConversionService.convertFileToWebPBuffer(filePath, {
      quality: 100,
      lossless: false,
      sourcePathForMetadata: filePath,
      originalFileName: path.basename(filePath),
      mimeType: 'image/webp',
    });

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=300');
    return res.send(conversion.buffer);
  } catch (error) {
    console.error('Error converting canvas image to WebP:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to convert image'
    });
  }
}));

/**
 * Save edited canvas image (overwrite or create new)
 * POST /api/image-editor/canvas/:filename/save-webp
 * Body: { imageData: base64 string, quality?: number, createNew?: boolean }
 */
router.post('/canvas/:filename/save-webp', asyncHandler(async (req: Request, res: Response) => {
  const filename = routeParam(req.params.filename);
  const { imageData, quality = 90, createNew = false } = req.body;

  if (!imageData) {
    return res.status(400).json({
      success: false,
      error: 'Image data is required'
    });
  }

  try {
    const canvasDir = runtimePaths.canvasDir;

    // Ensure canvas directory exists
    await fs.promises.mkdir(canvasDir, { recursive: true });

    // Convert base64 to Buffer
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Determine filename
    let newFileName: string;
    if (createNew) {
      // Create new file with timestamp
      const baseName = path.basename(filename, path.extname(filename));
      const timestamp = Date.now();
      newFileName = `${baseName}_${timestamp}.webp`;
    } else {
      // Overwrite existing file
      newFileName = filename;
    }

    const filePath = path.join(canvasDir, newFileName);

    // Security check
    const resolvedPath = path.resolve(filePath);
    const resolvedCanvasDir = path.resolve(canvasDir);

    if (!resolvedPath.startsWith(resolvedCanvasDir)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const metadataSourcePath = fs.existsSync(filePath) ? filePath : undefined;

    const conversion = await WebPConversionService.convertBufferToWebPBuffer(imageBuffer, {
      quality,
      sourcePathForMetadata: metadataSourcePath,
      originalFileName: newFileName,
      mimeType: 'image/webp',
    });

    await fs.promises.writeFile(filePath, conversion.buffer);

    return res.json({
      success: true,
      data: {
        filename: newFileName,
        filePath,
        url: `/save/canvas/${newFileName}`,
        width: conversion.info.width || 0,
        height: conversion.info.height || 0,
        fileSize: conversion.buffer.length
      }
    });
  } catch (error) {
    console.error('Error saving canvas image:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save canvas image'
    });
  }
}));

/**
 * Get all canvas images (saved edited images)
 * GET /api/image-editor/canvas
 * Returns list of images in temp/canvas directory, sorted by modification time (newest first)
 */
router.get('/canvas', asyncHandler(async (req: Request, res: Response) => {
  try {
    const canvasDir = runtimePaths.canvasDir;

    // Ensure canvas directory exists
    if (!fs.existsSync(canvasDir)) {
      return res.json({
        success: true,
        data: {
          images: [],
          total: 0
        }
      });
    }

    // Read directory and get file stats
    const files = await fs.promises.readdir(canvasDir);
    const imageExtensions = ['.webp', '.png', '.jpg', '.jpeg'];

    const imageFiles = await Promise.all(
      files
        .filter(file => imageExtensions.some(ext => file.toLowerCase().endsWith(ext)))
        .map(async (file) => {
          const filePath = path.join(canvasDir, file);
          const stats = await fs.promises.stat(filePath);

          // Try to get image dimensions
          let width = 0;
          let height = 0;
          try {
            const metadata = await sharp(filePath).metadata();
            width = metadata.width || 0;
            height = metadata.height || 0;
          } catch (e) {
            // Ignore metadata errors
          }

          return {
            filename: file,
            path: filePath,
            url: `/save/canvas/${file}`,
            size: stats.size,
            width,
            height,
            createdAt: stats.birthtime.toISOString(),
            modifiedAt: stats.mtime.toISOString()
          };
        })
    );

    // Sort by modification time (newest first)
    imageFiles.sort((a, b) =>
      new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );

    return res.json({
      success: true,
      data: {
        images: imageFiles,
        total: imageFiles.length
      }
    });
  } catch (error) {
    console.error('Error listing canvas images:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list canvas images'
    });
  }
}));

/**
 * Delete a canvas image
 * DELETE /api/image-editor/canvas/:filename
 */
router.delete('/canvas/:filename', asyncHandler(async (req: Request, res: Response) => {
  const filename = routeParam(req.params.filename);

  try {
    const canvasDir = runtimePaths.canvasDir;
    const filePath = path.join(canvasDir, filename);

    // Security check: ensure the file is within canvas directory
    const resolvedPath = path.resolve(filePath);
    const resolvedCanvasDir = path.resolve(canvasDir);

    if (!resolvedPath.startsWith(resolvedCanvasDir)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    await fs.promises.unlink(filePath);

    return res.json({
      success: true,
      message: 'Canvas image deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting canvas image:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete canvas image'
    });
  }
}));

export default router;

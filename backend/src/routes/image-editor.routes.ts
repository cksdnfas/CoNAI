import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { asyncHandler } from '../middleware/errorHandler';
import { ImageEditorService } from '../services/imageEditorService';
import type { EditOptions } from '../services/tempImageService';
import path from 'path';
import fs from 'fs';
import { WebPConversionService } from '../services/webpConversionService';
import { buildImageEditorResultData, listSaveBrowserImages } from './imageEditorRouteHelpers';
import { sendRouteBadRequest } from './routeValidation';
import {
  requireAccessibleImageEditorRequest,
  requireImageData,
} from './imageEditorAccessHelpers';
import {
  handleDeleteTempImage,
  handleTempImageFile,
  handleTempImageList,
  handleTempMaskFile,
} from './imageEditorTempHandlers';
import {
  handleCanvasWebp,
  handleDeleteCanvasImage,
  handleListCanvasImages,
  handleSaveCanvasWebp,
} from './imageEditorCanvasHandlers';

const router = Router();

/**
 * List save-folder images for attachment picker UIs.
 * GET /api/image-editor/save-images
 */
router.get('/save-images', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const items = await listSaveBrowserImages();

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
  try {
    const imageRequest = await requireAccessibleImageEditorRequest(req, res);
    if (!imageRequest) {
      return;
    }

    const { imageFile } = imageRequest;
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
  const editOptions: EditOptions = req.body;

  try {
    const imageRequest = await requireAccessibleImageEditorRequest(req, res);
    if (!imageRequest) {
      return;
    }

    const result = await ImageEditorService.editImage(imageRequest.imageId, editOptions);

    return res.json({
      success: true,
      data: buildImageEditorResultData(result)
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
  const { imageData, maskData } = req.body;

  if (!requireImageData(res, imageData)) {
    return;
  }

  try {
    const imageRequest = await requireAccessibleImageEditorRequest(req, res);
    if (!imageRequest) {
      return;
    }

    // Convert base64 to Buffer
    const imageBuffer = Buffer.from(imageData.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, ''), 'base64');
    const maskBuffer = maskData ? Buffer.from(maskData.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, ''), 'base64') : undefined;

    const result = await ImageEditorService.saveEditedImageAsNew(
      imageBuffer,
      imageRequest.imageId,
      maskBuffer
    );

    return res.json({
      success: true,
      data: buildImageEditorResultData(result, {
        message: `Image saved to: ${path.dirname(result.tempImagePath)}`
      })
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
  const { imageData, format = 'webp', quality = 90 } = req.body;

  if (!requireImageData(res, imageData)) {
    return;
  }

  if (!['png', 'jpeg', 'webp'].includes(format)) {
    return sendRouteBadRequest(res, 'Invalid format');
  }

  try {
    const imageRequest = await requireAccessibleImageEditorRequest(req, res);
    if (!imageRequest) {
      return;
    }

    const result = await ImageEditorService.saveAsFormat(
      imageData,
      imageRequest.imageId,
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
  const { imageData, quality = 90 } = req.body;

  if (!requireImageData(res, imageData)) {
    return;
  }

  try {
    const imageRequest = await requireAccessibleImageEditorRequest(req, res);
    if (!imageRequest) {
      return;
    }

    const result = await ImageEditorService.saveAsWebP(
      imageData,
      imageRequest.imageId,
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
  return handleDeleteTempImage(tempId, res);
}));

/**
 * Get temporary file (serve the temp image)
 * GET /api/image-editor/temp/:tempId/image
 */
router.get('/temp/:tempId/image', asyncHandler(async (req: Request, res: Response) => {
  const tempId = routeParam(req.params.tempId);
  return handleTempImageFile(tempId, res);
}));

/**
 * Get temporary mask file
 * GET /api/image-editor/temp/:tempId/mask
 */
router.get('/temp/:tempId/mask', asyncHandler(async (req: Request, res: Response) => {
  const tempId = routeParam(req.params.tempId);
  return handleTempMaskFile(tempId, res);
}));

/**
 * Get all temp files info (for debugging)
 * GET /api/image-editor/temp
 */
router.get('/temp', asyncHandler(async (req: Request, res: Response) => {
  return handleTempImageList(res);
}));

/**
 * Create blank mask
 * POST /api/image-editor/mask/blank
 */
router.post('/mask/blank', asyncHandler(async (req: Request, res: Response) => {
  const { width, height } = req.body;

  if (!width || !height || width <= 0 || height <= 0) {
    return sendRouteBadRequest(res, 'Valid width and height are required');
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
  return handleCanvasWebp(filename, res);
}));

/**
 * Save edited canvas image (overwrite or create new)
 * POST /api/image-editor/canvas/:filename/save-webp
 * Body: { imageData: base64 string, quality?: number, createNew?: boolean }
 */
router.post('/canvas/:filename/save-webp', asyncHandler(async (req: Request, res: Response) => {
  const filename = routeParam(req.params.filename);
  return handleSaveCanvasWebp(req, res, filename);
}));

/**
 * Get all canvas images (saved edited images)
 * GET /api/image-editor/canvas
 * Returns list of images in temp/canvas directory, sorted by modification time (newest first)
 */
router.get('/canvas', asyncHandler(async (req: Request, res: Response) => {
  return handleListCanvasImages(res);
}));

/**
 * Delete a canvas image
 * DELETE /api/image-editor/canvas/:filename
 */
router.delete('/canvas/:filename', asyncHandler(async (req: Request, res: Response) => {
  const filename = routeParam(req.params.filename);
  return handleDeleteCanvasImage(filename, res);
}));

export default router;

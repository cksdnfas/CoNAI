import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ImageEditorService } from '../services/imageEditorService';
import { TempImageService, EditOptions } from '../services/tempImageService';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * Create temporary edited image (volatile - for API transmission)
 * POST /api/image-editor/:id/temp
 */
router.post('/:id/temp', asyncHandler(async (req: Request, res: Response) => {
  const imageId = parseInt(req.params.id);

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
  const imageId = parseInt(req.params.id);

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
 * Delete temporary file
 * DELETE /api/image-editor/temp/:tempId
 */
router.delete('/temp/:tempId', asyncHandler(async (req: Request, res: Response) => {
  const { tempId } = req.params;

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
  const { tempId } = req.params;

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
  const { tempId } = req.params;

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

export default router;

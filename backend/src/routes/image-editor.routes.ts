import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { allowImagesView, requireImageAction } from '../middleware/imageAccess';
import multer from 'multer';
import { AiWorkerError } from '../services/aiWorker/aiWorkerClient';
import { inpaintImage } from '../services/aiWorker/aiInpaintService';
import { listSaveBrowserImages } from './imageEditorRouteHelpers';

const router = Router();
router.use((req, res, next) => req.method === 'GET' || req.method === 'HEAD'
  ? allowImagesView(req, res, next) : requireImageAction('images.edit')(req, res, next));

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

/** Image + mask parts for AI erase; kept in memory (a crop of at most 2048px per side). */
const inpaintUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 48 * 1024 * 1024, files: 2, fields: 0 },
}).fields([{ name: 'image', maxCount: 1 }, { name: 'mask', maxCount: 1 }]);

/**
 * AI erase: fill the white part of `mask` in `image` with the anime/manga LaMa model.
 * POST /api/image-editor/inpaint (multipart: image, mask) → image/png
 */
router.post('/inpaint', inpaintUpload, asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
  const image = files?.image?.[0]?.buffer;
  const mask = files?.mask?.[0]?.buffer;
  if (!image || !mask) {
    return res.status(400).json({ success: false, error: 'image and mask are required' });
  }
  try {
    const output = await inpaintImage(image, mask);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(output);
  } catch (error) {
    const type = error instanceof AiWorkerError ? error.errorType : undefined;
    const status = type === 'InvalidInput' ? 400 : type === 'MissingDependency' ? 503 : 500;
    if (status === 500) console.error('Error running AI erase:', error);
    return res.status(status).json({
      success: false,
      error: error instanceof Error ? error.message : 'AI erase failed',
      errorType: type,
    });
  }
}));

export default router;

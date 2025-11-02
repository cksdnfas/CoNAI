import express, { Request, Response } from 'express';
import multer from 'multer';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { asyncHandler } from '../middleware/errorHandler';
import { ServiceType } from '../models/GenerationHistory';

const router = express.Router();

// Multer configuration for image upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * GET /api/generation-history
 * Get all generation history with optional filters
 * IMPORTANT: Only used in Image Generation page, not in search/general management
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      service_type,
      generation_status,
      limit = '50',
      offset = '0'
    } = req.query;

    const filters: any = {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    };

    if (service_type && (service_type === 'comfyui' || service_type === 'novelai')) {
      filters.service_type = service_type as ServiceType;
    }

    if (generation_status) {
      filters.generation_status = generation_status;
    }

    const result = await GenerationHistoryService.getAllHistory(filters);

    res.json({
      success: true,
      records: result.records,
      total: result.total,
      limit: filters.limit,
      offset: filters.offset
    });
  })
);

/**
 * GET /api/generation-history/recent
 * Get recent generation history (last 50)
 */
router.get(
  '/recent',
  asyncHandler(async (req: Request, res: Response) => {
    const { limit = '50' } = req.query;
    const records = await GenerationHistoryService.getRecentHistory(parseInt(limit as string));

    res.json({
      success: true,
      records
    });
  })
);

/**
 * GET /api/generation-history/statistics
 * Get generation statistics
 */
router.get(
  '/statistics',
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await GenerationHistoryService.getStatistics();

    res.json({
      success: true,
      statistics: stats
    });
  })
);

/**
 * GET /api/generation-history/:id
 * Get specific generation history by ID
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const record = await GenerationHistoryService.getHistory(parseInt(id));

    if (!record) {
      res.status(404).json({
        success: false,
        error: 'Generation history not found'
      });
      return;
    }

    res.json({
      success: true,
      record
    });
  })
);

/**
 * POST /api/generation-history/comfyui
 * Create ComfyUI generation history
 *
 * Body:
 * - workflow: object (substituted API workflow)
 * - workflowId: number
 * - workflowName: string
 * - promptId: string
 * - positivePrompt: string
 * - negativePrompt?: string
 * - width: number
 * - height: number
 * - metadata?: object
 */
router.post(
  '/comfyui',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      workflow,
      workflowId,
      workflowName,
      promptId,
      positivePrompt,
      negativePrompt,
      width,
      height,
      metadata
    } = req.body;

    // Validation
    if (!workflow || !workflowId || !workflowName || !promptId || !positivePrompt || !width || !height) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: workflow, workflowId, workflowName, promptId, positivePrompt, width, height'
      });
      return;
    }

    const historyId = await GenerationHistoryService.createComfyUIHistory({
      workflow,
      workflowId,
      workflowName,
      promptId,
      positivePrompt,
      negativePrompt,
      width,
      height,
      metadata
    });

    res.status(201).json({
      success: true,
      historyId,
      message: 'ComfyUI generation history created'
    });
  })
);

/**
 * POST /api/generation-history/novelai
 * Create NovelAI generation history
 *
 * Body:
 * - model: string
 * - sampler: string
 * - seed: number
 * - steps: number
 * - scale: number (CFG scale)
 * - parameters: object (full NAI parameters)
 * - positivePrompt: string
 * - negativePrompt?: string
 * - width: number
 * - height: number
 * - metadata?: object
 */
router.post(
  '/novelai',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      model,
      sampler,
      seed,
      steps,
      scale,
      parameters,
      positivePrompt,
      negativePrompt,
      width,
      height,
      metadata
    } = req.body;

    // Validation
    if (!model || !sampler || seed === undefined || !steps || !scale || !parameters || !positivePrompt || !width || !height) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: model, sampler, seed, steps, scale, parameters, positivePrompt, width, height'
      });
      return;
    }

    const historyId = await GenerationHistoryService.createNAIHistory({
      model,
      sampler,
      seed,
      steps,
      scale,
      parameters,
      positivePrompt,
      negativePrompt,
      width,
      height,
      metadata
    });

    res.status(201).json({
      success: true,
      historyId,
      message: 'NovelAI generation history created'
    });
  })
);

/**
 * POST /api/generation-history/:id/upload-image
 * Process and upload generated image
 * Expects multipart/form-data with 'image' field
 */
router.post(
  '/:id/upload-image',
  upload.single('image'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Check if image was uploaded (handled by multer middleware in main app)
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No image file uploaded'
      });
      return;
    }

    // Get history record to determine service type
    const history = await GenerationHistoryService.getHistory(parseInt(id));
    if (!history) {
      res.status(404).json({
        success: false,
        error: 'Generation history not found'
      });
      return;
    }

    // Process and upload image
    await GenerationHistoryService.processAndUploadImage(
      parseInt(id),
      req.file.buffer,
      history.service_type
    );

    res.json({
      success: true,
      message: 'Image processed and uploaded successfully'
    });
  })
);

/**
 * DELETE /api/generation-history/:id
 * Delete generation history (통합 삭제 서비스 사용)
 *
 * Query Parameter:
 * - deleteFiles: true | false (기본값: false)
 *   - false: 히스토리만 삭제 (이미지 유지)
 *   - true: 히스토리 + 연결된 이미지 파일까지 삭제
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const deleteFiles = req.query.deleteFiles === 'true';

    // Import DeletionService dynamically
    const { DeletionService } = await import('../services/deletionService');

    if (deleteFiles) {
      // 히스토리 + 파일 모두 삭제
      await DeletionService.deleteGenerationHistoryWithFiles(parseInt(id));
    } else {
      // 히스토리만 삭제
      await DeletionService.deleteGenerationHistoryOnly(parseInt(id));
    }

    res.json({
      success: true,
      message: `Generation history deleted successfully${deleteFiles ? ' (with files)' : ' (history only)'}`
    });
  })
);

/**
 * GET /api/generation-history/workflow/:workflowId
 * Get generation history for specific workflow
 * ComfyUI only - filtered by workflow_id
 */
router.get(
  '/workflow/:workflowId',
  asyncHandler(async (req: Request, res: Response) => {
    const { workflowId } = req.params;
    const {
      generation_status,
      limit = '50',
      offset = '0'
    } = req.query;

    const filters: any = {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    };

    if (generation_status) {
      filters.generation_status = generation_status;
    }

    const result = await GenerationHistoryService.getHistoryByWorkflow(
      parseInt(workflowId),
      filters
    );

    res.json({
      success: true,
      records: result.records,
      total: result.total,
      limit: filters.limit,
      offset: filters.offset,
      workflowId: parseInt(workflowId)
    });
  })
);

/**
 * GET /api/generation-history/workflow/:workflowId/statistics
 * Get statistics for specific workflow
 */
router.get(
  '/workflow/:workflowId/statistics',
  asyncHandler(async (req: Request, res: Response) => {
    const { workflowId } = req.params;
    const stats = await GenerationHistoryService.getWorkflowStatistics(parseInt(workflowId));

    res.json({
      success: true,
      statistics: stats,
      workflowId: parseInt(workflowId)
    });
  })
);

export default router;

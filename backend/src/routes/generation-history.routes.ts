import express, { Request, Response } from 'express';
import { routeParam } from './routeParam';
import multer from 'multer';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin } from '../middleware/authMiddleware';
import {
  applyHistoryAccessScope,
  buildHistoryQueryFilters,
} from './generation-history/historyRouteHelpers';
import {
  handleFailedGenerationHistoryCleanup,
  handleGenerationHistoryCleanup,
} from './generation-history/cleanupRouteHandlers';
import {
  handleHistoryBatchDownload,
  handleHistoryFile,
  handleHistoryImageUpload,
  handleHistoryThumbnail,
} from './generation-history/mediaRouteHandlers';

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
    const { filters, error } = buildHistoryQueryFilters(req.query, { includeServiceType: true });
    if (error) {
      res.status(400).json({ success: false, error });
      return;
    }

    const accessScope = applyHistoryAccessScope(req, filters, req.query.mine === 'true');
    if (accessScope.forceEmpty) {
      res.json({
        success: true,
        records: [],
        total: 0,
        limit: filters.limit,
        offset: filters.offset
      });
      return;
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
 * POST /api/generation-history/download/batch
 * Download authorized generation-history outputs without applying gallery safety hiding.
 */
router.post(
  '/download/batch',
  asyncHandler(async (req: Request, res: Response) => {
    await handleHistoryBatchDownload(req, res);
  })
);

/**
 * GET /api/generation-history/:id/file
 * Serve an authorized generation-history output without applying gallery safety hiding.
 */
router.get(
  '/:id/file',
  asyncHandler(async (req: Request, res: Response) => {
    await handleHistoryFile(req, res, routeParam(req.params.id));
  })
);

/**
 * GET /api/generation-history/:id/thumbnail
 * Serve an authorized generation-history output thumbnail without applying gallery safety hiding.
 */
router.get(
  '/:id/thumbnail',
  asyncHandler(async (req: Request, res: Response) => {
    await handleHistoryThumbnail(req, res, routeParam(req.params.id));
  })
);

/**
 * GET /api/generation-history/:id
 * Get one detail/compat generation-history record by ID.
 * This is not the primary list surface used by the image-generation UI and should not grow into a new UI contract.
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = routeParam(req.params.id);
    const record = await GenerationHistoryService.getHistoryDetail(parseInt(id));

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
 * - workflow?: object (legacy compatibility input, no longer required)
 * - workflowId: number
 * - workflowName: string
 * - promptId?: string (legacy compatibility field)
 * - positivePrompt?: string (legacy compatibility input)
 * - negativePrompt?: string (legacy compatibility input)
 * - width?: number (legacy compatibility input, no longer stored in history)
 * - height?: number (legacy compatibility input, no longer stored in history)
 * - metadata?: object (legacy compatibility input)
 */
router.post(
  '/comfyui',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      workflowId,
      workflowName,
      promptId,
    } = req.body;

    // Validation
    if (!workflowId || !workflowName) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: workflowId, workflowName'
      });
      return;
    }

    const historyId = await GenerationHistoryService.createComfyUIHistory({
      workflowId,
      workflowName,
      promptId,
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
 * - sampler?: string (legacy compatibility input)
 * - seed?: number (legacy compatibility input)
 * - steps?: number (legacy compatibility input)
 * - scale?: number (legacy compatibility input)
 * - parameters?: object (legacy compatibility input)
 * - positivePrompt?: string (legacy compatibility input)
 * - negativePrompt?: string (legacy compatibility input)
 * - width?: number (legacy compatibility input, no longer stored in history)
 * - height?: number (legacy compatibility input, no longer stored in history)
 * - metadata?: object (legacy compatibility input)
 */
router.post(
  '/novelai',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      model,
    } = req.body;

    // Validation
    if (!model) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: model'
      });
      return;
    }

    const historyId = await GenerationHistoryService.createNAIHistory({
      model,
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
    await handleHistoryImageUpload(req, res, routeParam(req.params.id));
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
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const id = routeParam(req.params.id);
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
    const workflowId = routeParam(req.params.workflowId);
    const { filters, error } = buildHistoryQueryFilters(req.query);
    if (error) {
      res.status(400).json({ success: false, error });
      return;
    }

    const accessScope = applyHistoryAccessScope(req, filters, req.query.mine === 'true');
    if (accessScope.forceEmpty) {
      res.json({
        success: true,
        records: [],
        total: 0,
        limit: filters.limit,
        offset: filters.offset,
        workflowId: parseInt(workflowId)
      });
      return;
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
    const workflowId = routeParam(req.params.workflowId);
    const stats = await GenerationHistoryService.getWorkflowListStatistics(parseInt(workflowId));

    res.json({
      success: true,
      statistics: stats,
      workflowId: parseInt(workflowId)
    });
  })
);

/**
 * POST /api/generation-history/cleanup
 * Cleanup orphaned, failed, and stale generation history records
 *
 * Query Parameters:
 * - dry_run: boolean (default: false) - Preview cleanup without deleting
 *
 * Cleanup Rules:
 * 1. Failed records >24h old → Delete
 * 2. Orphaned records (files missing) → Delete
 * 3. Completed records without hash >24h old → Delete
 * 4. Stale pending/processing records >1h old → Update to 'failed'
 */
router.post(
  '/cleanup',
  asyncHandler(async (req: Request, res: Response) => {
    await handleGenerationHistoryCleanup(req, res);
  })
);

/**
 * POST /api/generation-history/cleanup-failed
 * Cleanup only failed generation history records
 *
 * Query Parameters:
 * - dry_run: boolean (default: false) - Preview cleanup without deleting
 *
 * Cleanup Rules:
 * - All failed records (no age restriction) → Delete from database only
 */
router.post(
  '/cleanup-failed',
  asyncHandler(async (req: Request, res: Response) => {
    await handleFailedGenerationHistoryCleanup(req, res);
  })
);

/**
 * GET /api/generation-history/job/:jobId
 * Get job status and progress
 * Returns temporary job info before DB records are created
 */
router.get(
  '/job/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = routeParam(req.params.jobId);

    const { JobTracker } = await import('../services/jobTracker');
    const job = JobTracker.getJob(jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Job not found or expired'
      });
      return;
    }

    res.json({
      success: true,
      job: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        historyIds: job.historyIds,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      }
    });
  })
);

export default router;

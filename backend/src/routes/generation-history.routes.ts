import express, { Request, Response } from 'express';
import { routeParam } from './routeParam';
import multer from 'multer';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { asyncHandler } from '../middleware/errorHandler';
import { GenerationHistoryModel, ServiceType } from '../models/GenerationHistory';

const router = express.Router();

// Multer configuration for image upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

function parsePositiveIntegerQuery(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('positive-integer');
  }

  return parsed;
}

function isAdminRequest(req: Request) {
  return req.session?.accountType === 'admin';
}

function getRequesterAccountId(req: Request) {
  return typeof req.session?.accountId === 'number' ? req.session.accountId : null;
}

function applyHistoryAccessScope(req: Request, filters: Record<string, any>, mineOnly: boolean) {
  const requesterAccountId = getRequesterAccountId(req);

  if (!isAdminRequest(req)) {
    if (requesterAccountId === null) {
      return { forceEmpty: true } as const;
    }

    filters.requested_by_account_id = requesterAccountId;
    if (req.session?.accountType === 'guest') {
      filters.requested_by_account_type = 'guest';
    }

    return { forceEmpty: false } as const;
  }

  if (mineOnly) {
    if (requesterAccountId === null) {
      return { forceEmpty: true } as const;
    }

    filters.requested_by_account_id = requesterAccountId;
    filters.requested_by_account_type = 'admin';
  }

  return { forceEmpty: false } as const;
}

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
      requested_by_account_id,
      requested_by_account_type,
      server_id,
      queue_job_id,
      mine,
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

    try {
      const requestedByAccountId = parsePositiveIntegerQuery(requested_by_account_id);
      const serverId = parsePositiveIntegerQuery(server_id);
      const queueJobId = parsePositiveIntegerQuery(queue_job_id);

      if (requestedByAccountId !== undefined) {
        filters.requested_by_account_id = requestedByAccountId;
      }

      if (serverId !== undefined) {
        filters.server_id = serverId;
      }

      if (queueJobId !== undefined) {
        filters.queue_job_id = queueJobId;
      }
    } catch {
      res.status(400).json({
        success: false,
        error: 'requested_by_account_id, server_id, and queue_job_id must be positive integers'
      });
      return;
    }

    if (requested_by_account_type !== undefined) {
      if (requested_by_account_type !== 'admin' && requested_by_account_type !== 'guest') {
        res.status(400).json({
          success: false,
          error: 'requested_by_account_type must be either admin or guest'
        });
        return;
      }

      filters.requested_by_account_type = requested_by_account_type;
    }

    const accessScope = applyHistoryAccessScope(req, filters, mine === 'true');
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
    const id = routeParam(req.params.id);

    // Check if image was uploaded (handled by multer middleware in main app)
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No image file uploaded'
      });
      return;
    }

    // Get the base history record only, because upload processing needs just the service type.
    const history = GenerationHistoryModel.findById(parseInt(id));
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
    const {
      generation_status,
      requested_by_account_id,
      requested_by_account_type,
      server_id,
      queue_job_id,
      mine,
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

    try {
      const requestedByAccountId = parsePositiveIntegerQuery(requested_by_account_id);
      const serverId = parsePositiveIntegerQuery(server_id);
      const queueJobId = parsePositiveIntegerQuery(queue_job_id);

      if (requestedByAccountId !== undefined) {
        filters.requested_by_account_id = requestedByAccountId;
      }

      if (serverId !== undefined) {
        filters.server_id = serverId;
      }

      if (queueJobId !== undefined) {
        filters.queue_job_id = queueJobId;
      }
    } catch {
      res.status(400).json({
        success: false,
        error: 'requested_by_account_id, server_id, and queue_job_id must be positive integers'
      });
      return;
    }

    if (requested_by_account_type !== undefined) {
      if (requested_by_account_type !== 'admin' && requested_by_account_type !== 'guest') {
        res.status(400).json({
          success: false,
          error: 'requested_by_account_type must be either admin or guest'
        });
        return;
      }

      filters.requested_by_account_type = requested_by_account_type;
    }

    const accessScope = applyHistoryAccessScope(req, filters, mine === 'true');
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
    const stats = await GenerationHistoryService.getWorkflowStatistics(parseInt(workflowId));

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
    const dryRun = req.query.dry_run === 'true';

    // Import CleanupService dynamically
    const { CleanupService } = await import('../services/cleanupService');

    const report = await CleanupService.executeCleanup({ dryRun });

    res.json({
      success: true,
      message: dryRun ? 'Cleanup preview completed (no changes made)' : 'Cleanup completed successfully',
      dry_run: dryRun,
      deleted: report.deleted,
      updated: report.updated,
      summary: report.summary,
      details: report.details
    });
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
    const dryRun = req.query.dry_run === 'true';

    if (!isAdminRequest(req)) {
      const requesterAccountId = getRequesterAccountId(req);
      const requesterAccountType = req.session?.accountType === 'guest' ? 'guest' : null;

      if (requesterAccountId === null || requesterAccountType === null) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const failedRecords = GenerationHistoryModel.findAll({
        generation_status: 'failed',
        requested_by_account_id: requesterAccountId,
        requested_by_account_type: requesterAccountType,
      });

      const deleted = dryRun
        ? failedRecords.length
        : GenerationHistoryModel.deleteMany(
            failedRecords
              .map((record) => record.id)
              .filter((id): id is number => typeof id === 'number')
          );

      res.json({
        success: true,
        message: dryRun
          ? `Found ${deleted} failed records (preview only, no changes made)`
          : `Successfully deleted ${deleted} failed records`,
        dry_run: dryRun,
        deleted,
        summary: {
          failed_deleted: deleted,
          orphaned_deleted: 0,
          no_hash_deleted: 0,
          stale_updated: 0,
        },
        details: failedRecords.map((record) => ({
          id: record.id!,
          reason: 'failed',
          service_type: record.service_type,
          created_at: record.created_at!,
          generation_status: record.generation_status,
          error_message: record.error_message,
        }))
      });
      return;
    }

    // Import CleanupService dynamically
    const { CleanupService } = await import('../services/cleanupService');

    const report = await CleanupService.cleanupFailedOnly({ dryRun });

    res.json({
      success: true,
      message: dryRun
        ? `Found ${report.deleted} failed records (preview only, no changes made)`
        : `Successfully deleted ${report.deleted} failed records`,
      dry_run: dryRun,
      deleted: report.deleted,
      summary: report.summary,
      details: report.details
    });
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

import express, { Request, Response } from 'express';
import { routeParam } from './routeParam';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { HistoryCommandService } from '../services/historyCommandService';
import type { GenerationHistoryFilterOptions, ServiceType } from '../types/generationHistory';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAdmin } from '../middleware/authMiddleware';
import {
  applyHistoryAccessScope,
  buildHistoryQueryFilters,
  canAccessHistoryRecord,
} from './generation-history/historyRouteHelpers';
import {
  handleFailedGenerationHistoryCleanup,
  handleGenerationHistoryCleanup,
} from './generation-history/cleanupRouteHandlers';
import {
  handleHistoryBatchDownload,
  handleHistoryFile,
  handleHistoryImageDetail,
  handleHistoryThumbnail,
} from './generation-history/mediaRouteHandlers';

const router = express.Router();
const CLEARABLE_HISTORY_STATUSES = ['completed', 'failed'] as const;

function parseHistoryServiceType(value: unknown): ServiceType | null {
  return value === 'comfyui' || value === 'novelai' || value === 'codex' ? value : null;
}

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

/** POST /api/generation-history/clear - clear one page/workflow history scope while preserving media. */
router.post(
  '/clear',
  asyncHandler(async (req: Request, res: Response) => {
    const serviceType = parseHistoryServiceType(req.query.service_type);
    if (!serviceType) {
      res.status(400).json({ success: false, error: 'service_type must be comfyui, novelai, or codex' });
      return;
    }

    const workflowIdValue = req.query.workflow_id;
    const workflowId = workflowIdValue === undefined ? undefined : Number(workflowIdValue);
    if (workflowId !== undefined && (!Number.isInteger(workflowId) || workflowId <= 0 || serviceType !== 'comfyui')) {
      res.status(400).json({ success: false, error: 'workflow_id must be a positive integer for comfyui history' });
      return;
    }

    const filters: GenerationHistoryFilterOptions = {
      service_type: serviceType,
      ...(workflowId !== undefined ? { workflow_id: workflowId } : {}),
    };
    const accessScope = applyHistoryAccessScope(req, filters, req.query.mine === 'true');
    if (accessScope.forceEmpty) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const deleted = HistoryCommandService.deleteByFilters(filters, {
      generationStatuses: [...CLEARABLE_HISTORY_STATUSES],
    });
    res.json({
      success: true,
      deleted,
      message: deleted > 0
        ? `Removed ${deleted} generation history records without deleting media`
        : 'No completed or failed generation history records to remove',
    });
  }),
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
  asyncHandler(async (_req: Request, res: Response) => {
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
 * GET /api/generation-history/:id/image
 * Return authorized image detail without switching to the gallery safety scope.
 */
router.get(
  '/:id/image',
  asyncHandler(async (req: Request, res: Response) => {
    await handleHistoryImageDetail(req, res, routeParam(req.params.id));
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

    if (!canAccessHistoryRecord(req, record)) {
      res.status(403).json({
        success: false,
        error: 'Not allowed to access this generation history item'
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

export default router;

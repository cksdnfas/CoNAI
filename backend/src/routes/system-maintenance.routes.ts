import { Router, Request, Response } from 'express';
import { successResponse, errorResponse } from '@conai/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { RuntimeJobRunner } from '../services/runtimeJobs/runtimeJobRunner';
import { RuntimeJobConflictError } from '../services/runtimeJobs/runtimeJobStore';
import type { RuntimeJobKind } from '../types/runtimeJob';
import { listDatabaseBackups } from '../services/maintenance/databaseBackupService';
import { normalizeMediaOrphanCleanupOptions } from '../services/maintenance/mediaOrphanCleanupService';
import { readDatabaseBackupKeep } from '../services/maintenance/databaseMaintenanceScheduler';

/**
 * Admin maintenance: library orphan cleanup and database backups. Mounted under `/api/system` (requireAdmin).
 * Both start runtime jobs and answer 202 with the job; progress and the final counts live on `GET /api/jobs/:id`.
 */
const router = Router();

function requestedBy(req: Request): number | null {
  return typeof req.session?.accountId === 'number' ? req.session.accountId : null;
}

function startJob(req: Request, res: Response, kind: RuntimeJobKind, params: object, conflictMessage: string) {
  try {
    const job = RuntimeJobRunner.start(kind, params, { requestedByAccountId: requestedBy(req) });
    return res.status(202).json(successResponse(job));
  } catch (error) {
    if (error instanceof RuntimeJobConflictError) {
      return res.status(409).json({
        ...errorResponse(conflictMessage),
        code: 'JOB_ALREADY_RUNNING',
        data: error.liveJob,
      });
    }

    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Failed to start job'));
  }
}

/**
 * POST /api/system/maintenance/orphan-cleanup
 * body: { dryRun?: boolean (default true), missingOlderThanDays?: number, orphanOlderThanDays?: number,
 *         sweepThumbnails?: boolean, sweepTemp?: boolean }
 * Dry run is the default: only an explicit `dryRun: false` deletes anything.
 */
router.post('/maintenance/orphan-cleanup', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const options = normalizeMediaOrphanCleanupOptions({
    dryRun: body.dryRun as boolean | undefined,
    missingOlderThanDays: body.missingOlderThanDays as number | undefined,
    orphanOlderThanDays: body.orphanOlderThanDays as number | undefined,
    sweepThumbnails: body.sweepThumbnails as boolean | undefined,
    sweepTemp: body.sweepTemp as boolean | undefined,
  });

  return startJob(req, res, 'media-orphan-cleanup', options, 'Orphan cleanup is already running');
}));

/**
 * GET /api/system/database-backups
 * Stamped backups under `<databaseDir>/backups`, newest first.
 */
router.get('/database-backups', asyncHandler(async (_req: Request, res: Response) => {
  return res.json(successResponse({ keep: readDatabaseBackupKeep(), backups: listDatabaseBackups() }));
}));

/**
 * POST /api/system/database-backups
 * Start an online backup of images.db, user.db and auth.db.
 */
router.post('/database-backups', asyncHandler(async (req: Request, res: Response) => {
  return startJob(req, res, 'database-backup', { keep: readDatabaseBackupKeep() }, 'A database backup is already running');
}));

export { router as systemMaintenanceRoutes };

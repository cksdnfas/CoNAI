import { Router, Request, Response } from 'express';
import { ZipArchive } from 'archiver';
import { successResponse, errorResponse } from '@conai/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { RuntimeJobRunner } from '../services/runtimeJobs/runtimeJobRunner';
import { RuntimeJobConflictError } from '../services/runtimeJobs/runtimeJobStore';
import type { RuntimeJobKind } from '../types/runtimeJob';
import {
  DatabaseBackupBusyError,
  DatabaseBackupNotFoundError,
  deleteDatabaseBackup,
  listDatabaseBackupFiles,
  listDatabaseBackups,
} from '../services/maintenance/databaseBackupService';
import { readDatabaseStats } from '../services/maintenance/databaseStatsService';
import { RuntimeJobStore } from '../services/runtimeJobs/runtimeJobStore';
import { normalizeMediaOrphanCleanupOptions } from '../services/maintenance/mediaOrphanCleanupService';
import { readDatabaseBackupKeep } from '../services/maintenance/databaseMaintenanceScheduler';
import {
  assertDatabaseCompactionAllowed,
  DatabaseCompactionRefusedError,
} from '../services/maintenance/databaseCompactionService';

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
 * POST /api/system/maintenance/compact-database
 * VACUUM images.db. Refused (409) while any other runtime job or the maintenance lock is active; it blocks the
 * server for its duration, so it only ever runs on request.
 */
router.post('/maintenance/compact-database', asyncHandler(async (req: Request, res: Response) => {
  try {
    assertDatabaseCompactionAllowed(null);
  } catch (error) {
    if (error instanceof DatabaseCompactionRefusedError) {
      return res.status(409).json({ ...errorResponse(error.message), code: 'MAINTENANCE_BUSY' });
    }
    throw error;
  }

  return startJob(req, res, 'database-compaction', {}, 'Database compaction is already running');
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

/**
 * GET /api/system/database-stats
 * File size (+ WAL), used pages and reclaimable free-list bytes per database. Cheap pragmas only.
 */
router.get('/database-stats', asyncHandler(async (_req: Request, res: Response) => {
  return res.json(successResponse(await readDatabaseStats()));
}));

/**
 * GET /api/system/database-backups/:stamp/download
 * One zip of that backup's .db files, streamed and stored without compression: deflating multi-GB SQLite files
 * would pin a core for minutes for little gain. Only finished stamp folders qualify.
 */
router.get('/database-backups/:stamp/download', asyncHandler(async (req: Request, res: Response) => {
  let files: Array<{ fileName: string; absolutePath: string }>;
  try {
    files = listDatabaseBackupFiles(req.params.stamp);
  } catch (error) {
    if (error instanceof DatabaseBackupNotFoundError) {
      return res.status(404).json(errorResponse('Backup not found'));
    }
    throw error;
  }

  const archiveName = `conai-db-backup-${req.params.stamp}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
  res.setHeader('Cache-Control', 'private, no-store');

  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ store: true });
    archive.once('error', reject);
    res.once('error', reject);
    res.once('close', () => {
      if (!res.writableFinished) {
        archive.abort();
        resolve();
      }
    });
    res.once('finish', resolve);
    archive.pipe(res);
    for (const file of files) {
      archive.file(file.absolutePath, { name: file.fileName });
    }
    void archive.finalize();
  });
  return undefined;
}));

/**
 * DELETE /api/system/database-backups/:stamp
 * Remove one finished backup. Refused (409) while a backup job is queued or running.
 */
router.delete('/database-backups/:stamp', asyncHandler(async (req: Request, res: Response) => {
  try {
    if (RuntimeJobStore.list({ kind: 'database-backup', status: ['queued', 'running'], limit: 1 }).length > 0) {
      throw new DatabaseBackupBusyError('A database backup is running');
    }
    deleteDatabaseBackup(req.params.stamp);
  } catch (error) {
    if (error instanceof DatabaseBackupNotFoundError) {
      return res.status(404).json(errorResponse('Backup not found'));
    }
    if (error instanceof DatabaseBackupBusyError) {
      return res.status(409).json({ ...errorResponse('A database backup is running'), code: 'JOB_ALREADY_RUNNING' });
    }
    throw error;
  }
  return res.json(successResponse({ deleted: req.params.stamp }));
}));

export { router as systemMaintenanceRoutes };

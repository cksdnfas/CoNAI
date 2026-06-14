import type { Request, Response } from 'express';
import { GenerationHistoryModel } from '../../models/GenerationHistory';
import { getRequesterAccountId, isAdminRequest } from '../requester-session-helpers';

export async function handleGenerationHistoryCleanup(req: Request, res: Response) {
  const dryRun = req.query.dry_run === 'true';
  const { CleanupService } = await import('../../services/cleanupService');

  const report = await CleanupService.executeCleanup({ dryRun });

  res.json({
    success: true,
    message: dryRun ? 'Cleanup preview completed (no changes made)' : 'Cleanup completed successfully',
    dry_run: dryRun,
    deleted: report.deleted,
    updated: report.updated,
    summary: report.summary,
    details: report.details,
  });
}

export async function handleFailedGenerationHistoryCleanup(req: Request, res: Response) {
  const dryRun = req.query.dry_run === 'true';

  if (!isAdminRequest(req)) {
    handleScopedFailedGenerationHistoryCleanup(req, res, dryRun);
    return;
  }

  const { CleanupService } = await import('../../services/cleanupService');
  const report = await CleanupService.cleanupFailedOnly({ dryRun });

  res.json({
    success: true,
    message: dryRun
      ? `Found ${report.deleted} failed records (preview only, no changes made)`
      : `Successfully deleted ${report.deleted} failed records`,
    dry_run: dryRun,
    deleted: report.deleted,
    summary: report.summary,
    details: report.details,
  });
}

function handleScopedFailedGenerationHistoryCleanup(req: Request, res: Response, dryRun: boolean) {
  const requesterAccountId = getRequesterAccountId(req);
  const requesterAccountType = req.session?.accountType === 'guest' ? 'guest' : null;

  if (requesterAccountId === null || requesterAccountType === null) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
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
          .filter((id): id is number => typeof id === 'number'),
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
    })),
  });
}

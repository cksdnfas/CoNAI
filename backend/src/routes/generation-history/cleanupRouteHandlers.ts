import type { Request, Response } from 'express';
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository';
import { HistoryCommandService } from '../../services/historyCommandService';
import type { GenerationHistoryFilterOptions } from '../../types/generationHistory';
import { applyHistoryAccessScope, parseHistoryPageScope } from './historyRouteHelpers';

/** Keep each DELETE well below SQLite's binding limit. */
const FAILED_CLEANUP_DELETE_CHUNK_SIZE = 400;

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
  const { filters, error } = parseHistoryPageScope(req.query);
  if (error) {
    res.status(400).json({ success: false, error });
    return;
  }

  const accessScope = applyHistoryAccessScope(req, filters, req.query.mine === 'true');
  if (accessScope.forceEmpty) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const deleted = removeDisplayFailedHistory(filters, dryRun);
  res.json({
    success: true,
    dry_run: dryRun,
    deleted,
    message: dryRun
      ? `Found ${deleted} failed generation history records (preview only, no changes made)`
      : `Removed ${deleted} failed generation history records without deleting media`,
  });
}

/** Count or delete the rows the UI shows as failed within an already access-scoped filter. */
export function removeDisplayFailedHistory(
  filters: Omit<GenerationHistoryFilterOptions, 'limit' | 'offset'>,
  dryRun: boolean,
): number {
  const failedIds = HistoryQueryRepository.findDisplayFailedIds(filters);
  if (dryRun) {
    return failedIds.length;
  }

  let deleted = 0;
  for (let start = 0; start < failedIds.length; start += FAILED_CLEANUP_DELETE_CHUNK_SIZE) {
    deleted += HistoryCommandService.deleteMany(failedIds.slice(start, start + FAILED_CLEANUP_DELETE_CHUNK_SIZE));
  }
  return deleted;
}

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import type { SearchHistoryChip } from '../services/searchHistoryService';
import { SearchHistoryService } from '../services/searchHistoryService';
import { routeParam } from './routeParam';

const router = Router();

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const entries = SearchHistoryService.listEntries();

  res.json({
    success: true,
    data: entries,
  });
  return;
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const label = typeof req.body?.label === 'string' ? req.body.label : '';
  const chips = Array.isArray(req.body?.chips) ? req.body.chips as SearchHistoryChip[] : [];

  try {
    const entry = SearchHistoryService.saveEntry({ label, chips });
    res.status(201).json({
      success: true,
      data: entry,
    });
    return;
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save search history',
    });
    return;
  }
}));

router.delete('/', asyncHandler(async (_req: Request, res: Response) => {
  SearchHistoryService.clearEntries();

  res.json({
    success: true,
    data: { cleared: true },
  });
  return;
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const entryId = routeParam(routeParam(req.params.id));
  const deleted = SearchHistoryService.deleteEntry(entryId);

  if (!deleted) {
    res.status(404).json({
      success: false,
      error: 'Search history entry not found',
    });
    return;
  }

  res.json({
    success: true,
    data: { deleted: true },
  });
  return;
}));

export default router;

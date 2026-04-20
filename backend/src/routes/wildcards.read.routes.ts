import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { asyncHandler } from '../middleware/errorHandler';
import { WildcardModel } from '../models/Wildcard';
import { requirePermission } from '../middleware/authMiddleware';

const router = Router();

router.use(requirePermission('page.wildcards.view'));

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const withItems = req.query.withItems !== 'false';
    const hierarchical = req.query.hierarchical === 'true';
    const rootsOnly = req.query.rootsOnly === 'true';

    let wildcards;
    if (hierarchical) {
      wildcards = WildcardModel.findHierarchy(null);
    } else if (rootsOnly) {
      wildcards = WildcardModel.findRoots();
    } else if (withItems) {
      wildcards = WildcardModel.findAllWithItems();
    } else {
      wildcards = WildcardModel.findAll();
    }

    return res.json({
      success: true,
      data: wildcards
    });
  } catch (error) {
    console.error('Error getting wildcards:', error);
    return res.status(500).json({ success: false, error: 'Failed to get wildcards' });
  }
}));

router.get('/last-scan-log', asyncHandler(async (req: Request, res: Response) => {
  try {
    const db = (await import('../database/userSettingsDb')).getUserSettingsDb();
    const result = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get('last_lora_scan_log') as any;

    if (!result) {
      return res.json({ success: true, data: null });
    }

    return res.json({ success: true, data: JSON.parse(result.value) });
  } catch (error) {
    console.error('Error getting last scan log:', error);
    return res.status(500).json({ success: false, error: 'Failed to get last scan log' });
  }
}));

router.get('/:id/children', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid wildcard ID' });
  }

  try {
    const children = WildcardModel.findByParentId(id);
    return res.json({ success: true, data: children });
  } catch (error) {
    console.error('Error getting wildcard children:', error);
    return res.status(500).json({ success: false, error: 'Failed to get wildcard children' });
  }
}));

router.get('/:id/path', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid wildcard ID' });
  }

  try {
    const fullPath = WildcardModel.getFullPath(id);
    return res.json({ success: true, data: fullPath });
  } catch (error) {
    console.error('Error getting wildcard path:', error);
    return res.status(500).json({ success: false, error: 'Failed to get wildcard path' });
  }
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid wildcard ID' });
  }

  try {
    const wildcard = WildcardModel.findByIdWithItems(id);

    if (!wildcard) {
      return res.status(404).json({ success: false, error: 'Wildcard not found' });
    }

    return res.json({ success: true, data: wildcard });
  } catch (error) {
    console.error('Error getting wildcard:', error);
    return res.status(500).json({ success: false, error: 'Failed to get wildcard' });
  }
}));

router.get('/stats/summary', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { WildcardService } = await import('../services/wildcardService');
    const statistics = WildcardService.getStatistics();
    return res.json({ success: true, data: statistics });
  } catch (error) {
    console.error('Error getting wildcard statistics:', error);
    return res.status(500).json({ success: false, error: 'Failed to get statistics' });
  }
}));

router.get('/:id/circular-check', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(routeParam(routeParam(req.params.id)));

  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid wildcard ID' });
  }

  try {
    const wildcard = WildcardModel.findById(id);
    if (!wildcard) {
      return res.status(404).json({ success: false, error: 'Wildcard not found' });
    }

    const { WildcardService } = await import('../services/wildcardService');
    const circularPath = WildcardService.detectCircularReference(id);

    return res.json({
      success: true,
      data: {
        hasCircularReference: circularPath !== null,
        circularPath: circularPath || []
      }
    });
  } catch (error) {
    console.error('Error checking circular reference:', error);
    return res.status(500).json({ success: false, error: 'Failed to check circular reference' });
  }
}));

export { router as wildcardReadRoutes };

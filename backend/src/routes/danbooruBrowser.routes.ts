import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { hasAdminAccess } from '../middleware/authMiddleware';
import { danbooruBrowserService } from '../services/danbooruBrowserService';
import { toPublicDanbooruDbInfo } from '../services/danbooruBrowser/dbResolver';

const router = Router();

function sendSuccess(res: Response, data: unknown): void {
  res.json({ success: true, data });
}

router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  const summary = danbooruBrowserService.getSummary();
  if (hasAdminAccess(req)) {
    sendSuccess(res, summary);
    return;
  }

  // Server file paths are admin-only; other viewers get availability, accepted names and the download link.
  const { dbPath: _dbPath, database, ...rest } = summary;
  sendSuccess(res, { ...rest, database: toPublicDanbooruDbInfo(database) });
}));

router.get('/tags', asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, danbooruBrowserService.listTags({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    taxonomyNodeId: typeof req.query.taxonomyNodeId === 'string' ? req.query.taxonomyNodeId : undefined,
    page: req.query.page,
    limit: req.query.limit,
  }));
}));

router.get('/artists', asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, danbooruBrowserService.listArtists({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    page: req.query.page,
    limit: req.query.limit,
  }));
}));

router.get('/characters', asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, danbooruBrowserService.listCharacters({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    copyrightTagId: typeof req.query.copyrightTagId === 'string' ? req.query.copyrightTagId : undefined,
    page: req.query.page,
    limit: req.query.limit,
    relatedTagCategories: req.query.relatedTagCategories,
    relatedTagScoreMin: req.query.relatedTagScoreMin,
    relatedTagScoreMax: req.query.relatedTagScoreMax,
    relatedTagLimit: req.query.relatedTagLimit,
  }));
}));

router.get('/character-images/:tagId/:fileName', asyncHandler(async (req: Request, res: Response) => {
  const fileName = typeof req.params.fileName === 'string' ? req.params.fileName : '';
  const filePath = danbooruBrowserService.getCharacterImageFilePath(req.params.tagId, fileName);
  if (!filePath) {
    res.sendStatus(404);
    return;
  }

  res.sendFile(filePath);
}));

export { router as danbooruBrowserRoutes };
export default router;

import { Router, Request, Response } from 'express';
import { errorResponse, successResponse, validateId } from '@conai/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { EMOTICON_PROMPT_BUDGET, EmoticonError, EmoticonService } from '../services/emoticonService';
import { routeParam } from './routeParam';

const router = Router();

function readItems(body: unknown): Array<{ compositeHash: string; keywords?: unknown }> | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 500) return null;
  const parsed = items.flatMap((item) => {
    const record = item as Record<string, unknown> | null;
    const compositeHash = typeof record?.composite_hash === 'string' ? record.composite_hash : typeof record?.compositeHash === 'string' ? record.compositeHash : '';
    return compositeHash ? [{ compositeHash, keywords: record && 'keywords' in record ? record.keywords : undefined }] : [];
  });
  return parsed.length === items.length ? parsed : null;
}

function sendEmoticonError(res: Response, error: unknown) {
  if (error instanceof EmoticonError) {
    res.status(400).json(errorResponse(error.message));
    return;
  }
  throw error;
}

/** GET /api/groups/:id/emoticons — the group's images with the keywords that call them up. */
router.get('/:id/emoticons', (req: Request, res: Response) => {
  const groupId = validateId(routeParam(req.params.id), 'Group ID');
  const group = EmoticonService.findGroup(groupId);
  if (!group) {
    res.status(404).json(errorResponse('Group not found'));
    return;
  }
  res.json(successResponse({ entries: EmoticonService.listEntries(groupId), promptBudget: EMOTICON_PROMPT_BUDGET }));
});

/** PUT /api/groups/:id/emoticons/keywords — `{ items: [{ composite_hash, keywords: string[] | null }] }`; null = file name. */
router.put('/:id/emoticons/keywords', (req: Request, res: Response) => {
  const groupId = validateId(routeParam(req.params.id), 'Group ID');
  const items = readItems(req.body);
  if (!items || items.some((item) => item.keywords === undefined)) {
    res.status(400).json(errorResponse('items with composite_hash and keywords are required'));
    return;
  }
  try {
    res.json(successResponse(EmoticonService.setKeywords(groupId, items.map((item) => ({ compositeHash: item.compositeHash, keywords: item.keywords })))));
  } catch (error) {
    sendEmoticonError(res, error);
  }
});

/** POST /api/groups/:id/emoticons — add images (e.g. just uploaded) with optional keywords. */
router.post('/:id/emoticons', asyncHandler(async (req: Request, res: Response) => {
  const groupId = validateId(routeParam(req.params.id), 'Group ID');
  const items = readItems(req.body);
  if (!items) {
    res.status(400).json(errorResponse('items with composite_hash are required'));
    return;
  }
  try {
    res.status(201).json(successResponse(EmoticonService.addImages(groupId, items)));
  } catch (error) {
    sendEmoticonError(res, error);
  }
}));

export { router as groupEmoticonRoutes };

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { PromptSimilarityService } from '../../services/promptSimilarityService';
import { enrichImageWithFileView } from './utils';
import { respondWithStartedJob } from '../runtimeJobRouteHelpers';

const router = Router();

router.get(
  '/by-image/:compositeHash',
  asyncHandler(async (req: Request, res: Response) => {
    const compositeHash = String(req.params.compositeHash);
    const requestedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.round(requestedLimit)))
      : undefined;

    const items = PromptSimilarityService.findSimilarByCompositeHash(compositeHash, limit).map((item) => ({
      ...item,
      image: enrichImageWithFileView(item.image),
    }));

    res.json({
      success: true,
      data: {
        items,
        total: items.length,
        settings: PromptSimilarityService.getEffectiveSettings(),
        source: {
          compositeHash,
        },
      },
    });
  }),
);

/** POST /rebuild — 202 + `prompt-similarity-rebuild` job; the counts (`PromptSimilarityRebuildResult`) are its result. */
router.post(
  '/rebuild',
  asyncHandler(async (req: Request, res: Response) => {
    return respondWithStartedJob(req, res, 'prompt-similarity-rebuild', {}, 'Prompt similarity rebuild is already running');
  }),
);

export default router;

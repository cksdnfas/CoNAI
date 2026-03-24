import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { PromptSimilarityService } from '../../services/promptSimilarityService';
import { enrichImageWithFileView } from './utils';

const router = Router();

router.get(
  '/by-image/:compositeHash',
  asyncHandler(async (req: Request, res: Response) => {
    const compositeHash = String(req.params.compositeHash);
    const items = PromptSimilarityService.findSimilarByCompositeHash(compositeHash).map((item) => ({
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

router.post(
  '/rebuild',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = PromptSimilarityService.rebuildAll();
    res.json({
      success: true,
      data: result,
      message: `Prompt similarity rebuild complete (${result.updated}/${result.processed})`,
    });
  }),
);

export default router;

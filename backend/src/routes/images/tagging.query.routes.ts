import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { imageTaggerService } from '../../services/imageTaggerService';
import { runtimePaths } from '../../config/runtimePaths';
import { AutoTagSearchService } from '../../services/autoTagSearchService';
import { AutoTagSearchParams } from '../../types/autoTag';
import { enrichImageRecord } from './utils';
import { ImageStatsModel } from '../../models/Image/ImageStatsModel';
import { ImageSearchModel } from '../../models/Image/ImageSearchModel';
import { ImageTaggingModel } from '../../models/Image/ImageTaggingModel';
import { ImageListResponse } from '../../types/image';
import { logger } from '../../utils/logger';

const router = Router();

router.get('/untagged-count', asyncHandler(async (req: Request, res: Response) => {
  try {
    const count = await ImageTaggingModel.countUntagged();
    res.json({ success: true, data: { count } });
    return;
  } catch (error) {
    console.error('[UntaggedCount] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to count untagged images'
    });
    return;
  }
}));

router.get('/tagger/check', asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await imageTaggerService.checkPythonDependencies();
    const status = await imageTaggerService.getStatus();

    res.json({
      success: true,
      data: {
        dependencies: result,
        daemon_status: status,
        models_dir: runtimePaths.modelsDir
      }
    });
    return;
  } catch (error) {
    console.error('[TaggerCheck] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check tagger status'
    });
    return;
  }
}));

router.post('/search-by-autotags', asyncHandler(async (req: Request, res: Response) => {
  try {
    const searchParams: AutoTagSearchParams = {
      rating: req.body.rating,
      rating_score: req.body.rating_score,
      general_tags: req.body.general_tags,
      character: req.body.character,
      model: req.body.model,
      has_auto_tags: req.body.has_auto_tags,
      page: parseInt(req.body.page) || 1,
      limit: parseInt(req.body.limit) || 20,
      sortBy: req.body.sortBy || 'upload_date',
      sortOrder: req.body.sortOrder || 'DESC'
    };

    const basicSearchParams = {
      search_text: req.body.search_text,
      negative_text: req.body.negative_text,
      ai_tool: req.body.ai_tool,
      model_name: req.body.model_name,
      start_date: req.body.start_date,
      end_date: req.body.end_date
    };

    const validation = AutoTagSearchService.validateSearchParams(searchParams);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid search parameters: ${validation.errors.join(', ')}`
      });
    }

    const result = await ImageSearchModel.searchByAutoTags(searchParams, basicSearchParams);
    const enrichedImages = result.images.map(enrichImageRecord);

    const response: ImageListResponse = {
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page: searchParams.page!,
        limit: searchParams.limit!,
        totalPages: Math.ceil(result.total / searchParams.limit!)
      }
    };

    return res.json(response);
  } catch (error) {
    logger.error('[AutoTagSearch] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search by auto tags'
    } as ImageListResponse);
    return;
  }
}));

router.get('/autotag-stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const stats = await ImageStatsModel.getAutoTagStats();
    res.json({ success: true, data: stats });
    return;
  } catch (error) {
    logger.error('[AutoTagStats] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get auto tag statistics'
    });
    return;
  }
}));

export { router as taggingQueryRoutes };

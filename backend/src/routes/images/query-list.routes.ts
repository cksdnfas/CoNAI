import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageSearchModel } from '../../models/Image/ImageSearchModel';
import { ImageListResponse } from '../../types/image';
import { enrichCompactImageWithFileView, enrichImageWithFileView } from './utils';
import { QueryCacheService } from '../../services/QueryCacheService';
import { logger } from '../../utils/logger';
import { routeParam } from '../routeParam';
import {
  buildBatchImageListResponse,
  buildBatchThumbnailLookupResults,
  buildEnrichedImageListResponse,
  buildImageListResponse,
  buildImageSearchParams,
} from './query-list-helpers';

const router = Router();

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const sortBy = (req.query.sortBy as 'first_seen_date' | 'width' | 'height' | 'file_size') || 'first_seen_date';
  const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';
  const cursorDate = req.query.cursor_date as string | undefined;
  const cursorHash = req.query.cursor_hash as string | undefined;

  const isCursorRequest = cursorDate !== undefined || cursorHash !== undefined;
  if (isCursorRequest) {
    logger.debug(`🔍 [QueryRoutes] Cursor request: cursorDate=${cursorDate}, cursorHash=${cursorHash?.substring(0, 8)}, limit=${limit}`);
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.removeHeader('ETag');

  try {
    if (isCursorRequest) {
      const result = MediaMetadataModel.findAllWithFilesCursor({
        limit,
        sortOrder,
        cursorDate: cursorDate || undefined,
        cursorHash: cursorHash || undefined,
      });

      return res.status(200).json(
        buildEnrichedImageListResponse(result.items, result.total, 0, limit, {
          hasMore: result.hasMore,
          totalPages: 0,
        })
      );
    }

    const cached = QueryCacheService.getGalleryCache(page, limit, sortBy, sortOrder);
    if (cached) {
      return res.json(cached);
    }

    const result = await MediaMetadataModel.findAllWithFiles({
      page,
      limit,
      sortBy,
      sortOrder
    });

    logger.debug('🔍 [QueryRoutes] Query result - first 3 records:');
    result.items.slice(0, 3).forEach((item, idx) => {
      logger.debug(`  [${idx}] file_id=${item.id}, hash=${item.composite_hash?.substring(0, 8)}, path=${item.original_file_path}`);
    });

    const enrichedImages = result.items.map(enrichCompactImageWithFileView);

    logger.debug('🔍 [QueryRoutes] Enriched result - first 3 records:');
    enrichedImages.slice(0, 3).forEach((item, idx) => {
      logger.debug(`  [${idx}] file_id=${item.id}, hash=${item.composite_hash?.substring(0, 8)}, path=${item.original_file_path}`);
    });

    if (enrichedImages.length > 0) {
      logger.debug('[QueryRoutes] Sample image rating_score:', {
        composite_hash: enrichedImages[0].composite_hash,
        rating_score: enrichedImages[0].rating_score,
        has_rating_score: 'rating_score' in enrichedImages[0],
      });
    }

    const response = buildImageListResponse(enrichedImages, result.total, page, limit, {
      hasMore: (page * limit) < result.total
    });

    QueryCacheService.setGalleryCache(page, limit, sortBy, sortOrder, response);

    return res.json(response);
  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch images'
    } as ImageListResponse);
    return;
  }
}));

router.get('/random', asyncHandler(async (req: Request, res: Response) => {
  try {
    const image = await MediaMetadataModel.getRandomImage();

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'No images found'
      });
    }

    res.json({
      success: true,
      data: enrichImageWithFileView(image)
    });
    return;
  } catch (error) {
    console.error('Get random image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get random image'
    });
    return;
  }
}));

router.post('/random-from-search', asyncHandler(async (req: Request, res: Response) => {
  const searchParams = buildImageSearchParams(req.body);

  try {
    const image = await ImageSearchModel.getRandomFromSearch(searchParams);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'No images found matching search criteria'
      });
    }

    res.json({
      success: true,
      data: enrichImageWithFileView(image)
    });
    return;
  } catch (error) {
    console.error('Get random from search error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get random image from search'
    });
    return;
  }
}));

router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const {
    search_text,
    negative_text,
    ai_tool,
    model_name,
    min_width,
    max_width,
    min_height,
    max_height,
    min_file_size,
    max_file_size,
    start_date,
    end_date,
    group_id,
    page = 1,
    limit = 20,
    sortBy = 'first_seen_date',
    sortOrder = 'DESC'
  } = req.body;

  try {
    const searchParams = buildImageSearchParams({
      search_text,
      negative_text,
      ai_tool,
      model_name,
      min_width,
      max_width,
      min_height,
      max_height,
      min_file_size,
      max_file_size,
      start_date,
      end_date,
      group_id
    });

    const result = await ImageSearchModel.advancedSearch(
      searchParams,
      parseInt(page),
      parseInt(limit),
      sortBy === 'upload_date' ? 'first_seen_date' : sortBy,
      sortOrder
    );

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);

    return res.json(
      buildEnrichedImageListResponse(result.images, result.total, pageNumber, limitNumber)
    );
  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to perform advanced search'
    } as ImageListResponse);
    return;
  }
}));

router.post('/search/ids', asyncHandler(async (req: Request, res: Response) => {
  const {
    search_text,
    negative_text,
    ai_tool,
    model_name,
    min_width,
    max_width,
    min_height,
    max_height,
    min_file_size,
    max_file_size,
    start_date,
    end_date,
    group_id
  } = req.body;

  try {
    const searchParams = buildImageSearchParams({
      search_text,
      negative_text,
      ai_tool,
      model_name,
      min_width,
      max_width,
      min_height,
      max_height,
      min_file_size,
      max_file_size,
      start_date,
      end_date,
      group_id
    });

    const ids = await ImageSearchModel.searchImageFileIds(searchParams);

    res.json({
      success: true,
      data: {
        ids: ids,
        total: ids.length
      }
    });
    return;
  } catch (error) {
    console.error('Search IDs error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get search image IDs'
    });
    return;
  }
}));

router.get('/date/:startDate/:endDate', asyncHandler(async (req: Request, res: Response) => {
  const startDate = routeParam(req.params.startDate);
  const endDate = routeParam(req.params.endDate);
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  try {
    const result = await MediaMetadataModel.findByDateRange(startDate, endDate, page, limit);

    res.json(buildEnrichedImageListResponse(result.items, result.total, page, limit));
    return;
  } catch (error) {
    console.error('Get images by date error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch images by date'
    });
    return;
  }
}));

router.post('/batch', asyncHandler(async (req: Request, res: Response) => {
  const { composite_hashes } = req.body;

  if (!composite_hashes || !Array.isArray(composite_hashes)) {
    return res.status(400).json({
      success: false,
      error: 'composite_hashes must be an array'
    });
  }

  if (composite_hashes.length === 0) {
    return res.json(buildImageListResponse([], 0, 1, 0));
  }

  if (composite_hashes.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'Too many items requested (max 500)'
    });
  }

  try {
    const images = MediaMetadataModel.findByHashesWithFiles(composite_hashes);

    return res.json(buildBatchImageListResponse(composite_hashes, images));
  } catch (error) {
    console.error('Batch fetch error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch batch images'
    });
  }
}));

router.get('/batch/thumbnails', asyncHandler(async (req: Request, res: Response) => {
  const hashesParam = req.query.hashes as string;

  if (!hashesParam) {
    return res.status(400).json({
      success: false,
      error: 'Missing hashes parameter'
    });
  }

  const hashes = hashesParam.split(',').filter(h => h.length === 48);

  if (hashes.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No valid hashes provided'
    });
  }

  if (hashes.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 100 hashes allowed per request'
    });
  }

  try {
    return res.json({
      success: true,
      data: buildBatchThumbnailLookupResults(hashes)
    });
  } catch (error) {
    console.error('Batch thumbnails error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch batch thumbnails'
    });
  }
}));

export { router as queryListRoutes };

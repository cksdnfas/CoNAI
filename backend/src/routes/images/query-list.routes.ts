import { Router, Request, Response } from 'express';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageSearchModel } from '../../models/Image/ImageSearchModel';
import { ImageListResponse } from '../../types/image';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { enrichImageWithFileView } from './utils';
import { QueryCacheService } from '../../services/QueryCacheService';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { logger } from '../../utils/logger';
import { routeParam } from '../routeParam';

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

      const enrichedImages = result.items.map(enrichImageWithFileView);

      return res.status(200).json({
        success: true,
        data: {
          images: enrichedImages,
          total: result.total,
          hasMore: result.hasMore,
          page: 0,
          limit,
          totalPages: 0,
        }
      });
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

    const enrichedImages = result.items.map(enrichImageWithFileView);

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

    const response: ImageListResponse = {
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
        hasMore: (page * limit) < result.total
      }
    };

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
  const searchParams = {
    search_text: req.body.search_text,
    negative_text: req.body.negative_text,
    ai_tool: req.body.ai_tool,
    model_name: req.body.model_name,
    min_width: req.body.min_width ? parseInt(req.body.min_width) : undefined,
    max_width: req.body.max_width ? parseInt(req.body.max_width) : undefined,
    min_height: req.body.min_height ? parseInt(req.body.min_height) : undefined,
    max_height: req.body.max_height ? parseInt(req.body.max_height) : undefined,
    min_file_size: req.body.min_file_size ? parseInt(req.body.min_file_size) : undefined,
    max_file_size: req.body.max_file_size ? parseInt(req.body.max_file_size) : undefined,
    start_date: req.body.start_date,
    end_date: req.body.end_date,
    group_id: req.body.group_id !== undefined ? parseInt(req.body.group_id) : undefined
  };

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
    const searchParams = {
      search_text,
      negative_text,
      ai_tool,
      model_name,
      min_width: min_width ? parseInt(min_width) : undefined,
      max_width: max_width ? parseInt(max_width) : undefined,
      min_height: min_height ? parseInt(min_height) : undefined,
      max_height: max_height ? parseInt(max_height) : undefined,
      min_file_size: min_file_size ? parseInt(min_file_size) : undefined,
      max_file_size: max_file_size ? parseInt(max_file_size) : undefined,
      start_date,
      end_date,
      group_id: group_id !== undefined ? parseInt(group_id) : undefined
    };

    const result = await ImageSearchModel.advancedSearch(
      searchParams,
      parseInt(page),
      parseInt(limit),
      sortBy === 'upload_date' ? 'first_seen_date' : sortBy,
      sortOrder
    );

    const enrichedImages = result.images.map(enrichImageWithFileView);

    const response: ImageListResponse = {
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(result.total / parseInt(limit))
      }
    };

    return res.json(response);
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
    const searchParams = {
      search_text,
      negative_text,
      ai_tool,
      model_name,
      min_width: min_width ? parseInt(min_width) : undefined,
      max_width: max_width ? parseInt(max_width) : undefined,
      min_height: min_height ? parseInt(min_height) : undefined,
      max_height: max_height ? parseInt(max_height) : undefined,
      min_file_size: min_file_size ? parseInt(min_file_size) : undefined,
      max_file_size: max_file_size ? parseInt(max_file_size) : undefined,
      start_date,
      end_date,
      group_id: group_id !== undefined ? parseInt(group_id) : undefined
    };

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

    const enrichedImages = result.items.map(enrichImageWithFileView);

    res.json({
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      }
    });
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
    return res.json({
      success: true,
      data: {
        images: [],
        total: 0,
        page: 1,
        limit: 0,
        totalPages: 0
      }
    });
  }

  if (composite_hashes.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'Too many items requested (max 500)'
    });
  }

  try {
    const images = MediaMetadataModel.findByHashesWithFiles(composite_hashes);
    const enrichedImages = images.map(enrichImageWithFileView);

    const sortedImages = composite_hashes
      .map(hash => enrichedImages.find(img => img.composite_hash === hash))
      .filter((img): img is any => !!img);

    return res.json({
      success: true,
      data: {
        images: sortedImages,
        total: sortedImages.length,
        page: 1,
        limit: sortedImages.length,
        totalPages: 1
      }
    });
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
    const results: Record<string, {
      success: boolean;
      thumbnailPath?: string;
      mimeType?: string;
      error?: string;
    }> = {};

    await Promise.all(
      hashes.map(async (hash) => {
        try {
          const cached = QueryCacheService.getMetadataCache(hash);
          let metadata = cached;

          if (!metadata) {
            metadata = await MediaMetadataModel.findByHash(hash);
            if (metadata) {
              QueryCacheService.setMetadataCache(hash, metadata);
            }
          }

          if (!metadata) {
            results[hash] = { success: false, error: 'Not found' };
            return;
          }

          if (ImageSafetyService.isHidden(metadata.rating_score)) {
            results[hash] = { success: false, error: 'Hidden by safety policy' };
            return;
          }

          const files = await ImageFileModel.findActiveByHash(hash);
          if (files.length === 0) {
            results[hash] = { success: false, error: 'File not found' };
            return;
          }

          const mimeType = files[0].mime_type;

          if (mimeType && mimeType.startsWith('video/')) {
            results[hash] = {
              success: true,
              thumbnailPath: files[0].original_file_path,
              mimeType
            };
            return;
          }

          const thumbnailPath = (metadata.thumbnail_path && fs.existsSync(resolveUploadsPath(metadata.thumbnail_path)))
            ? metadata.thumbnail_path
            : files[0].original_file_path;
          results[hash] = {
            success: true,
            thumbnailPath,
            mimeType: 'image/webp'
          };
        } catch (error) {
          results[hash] = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    return res.json({
      success: true,
      data: results
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

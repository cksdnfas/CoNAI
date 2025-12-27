import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageSearchModel } from '../../models/Image/ImageSearchModel';
import { ImageListResponse } from '../../types/image';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { enrichImageWithFileView } from './utils';
import { QueryCacheService } from '../../services/QueryCacheService';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import { logger } from '../../utils/logger';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * Generate ETag from file stats (mtime + size)
 */
function generateETag(stats: fs.Stats): string {
  const hash = crypto.createHash('md5');
  hash.update(`${stats.mtime.getTime()}-${stats.size}`);
  return `"${hash.digest('hex')}"`;
}

/**
 * 이미지 목록 조회 (composite_hash 기반, 새 구조)
 * GET /api/images
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const sortBy = (req.query.sortBy as 'first_seen_date' | 'width' | 'height' | 'file_size') || 'first_seen_date';
  const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

  try {
    // 캐시 확인
    const cached = QueryCacheService.getGalleryCache(page, limit, sortBy, sortOrder);
    if (cached) {
      return res.json(cached);
    }

    // MediaMetadataModel로 조회 (파일 경로 포함)
    const result = await MediaMetadataModel.findAllWithFiles({
      page,
      limit,
      sortBy,
      sortOrder
    });

    // 🔍 Debug: Log query result
    logger.debug('🔍 [QueryRoutes] Query result - first 3 records:');
    result.items.slice(0, 3).forEach((item, idx) => {
      logger.debug(`  [${idx}] file_id=${item.id}, hash=${item.composite_hash?.substring(0, 8)}, path=${item.original_file_path}`);
    });

    // URL 추가
    const enrichedImages = result.items.map(enrichImageWithFileView);

    // 🔍 Debug: Log enriched result
    logger.debug('🔍 [QueryRoutes] Enriched result - first 3 records:');
    enrichedImages.slice(0, 3).forEach((item, idx) => {
      logger.debug(`  [${idx}] file_id=${item.id}, hash=${item.composite_hash?.substring(0, 8)}, path=${item.original_file_path}`);
    });

    // Debug: Log first image's rating_score
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
        totalPages: Math.ceil(result.total / limit)
      }
    };

    // 캐시 저장
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

/**
 * 랜덤 이미지 조회 (composite_hash 기반)
 * GET /api/images/random
 */
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

/**
 * 검색 조건에 맞는 랜덤 이미지 조회
 * POST /api/images/random-from-search
 */
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

/**
 * 고급 이미지 검색 (프롬프트 중심, composite_hash 기반)
 * POST /api/images/search
 */
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

    // URL 추가
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

/**
 * 검색 조건에 맞는 image_files.id만 조회 (선택 기능용)
 * POST /api/images/search/ids
 */
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

/**
 * 특정 이미지 조회 (composite_hash 기반)
 * GET /api/images/:compositeHash
 */
router.get('/:compositeHash', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.compositeHash;

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    // 파일 정보 먼저 조회
    const files = await ImageFileModel.findActiveByHash(compositeHash);

    if (!files || files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // 통합 media_metadata 테이블에서 조회
    const metadata = await MediaMetadataModel.findByHash(compositeHash);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Metadata not found'
      });
    }

    const imageWithFile = {
      ...metadata,
      file_id: files[0].id,
      original_file_path: files[0].original_file_path,
      file_size: files[0].file_size,
      mime_type: files[0].mime_type || 'image/jpeg',
      file_type: files[0].file_type  // 파일 타입 명시적 포함
    };

    res.json({
      success: true,
      data: enrichImageWithFileView(imageWithFile)
    });
    return;
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch image'
    });
    return;
  }
}));

/**
 * 날짜 범위로 이미지 조회 (composite_hash 기반)
 * GET /api/images/date/:startDate/:endDate
 */
router.get('/date/:startDate/:endDate', asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.params;
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

/**
 * 배치 썸네일 조회 (여러 이미지의 썸네일을 한 번에 조회)
 * GET /api/images/batch/thumbnails?hashes=hash1,hash2,hash3
 */
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

    // 병렬 처리로 모든 썸네일 정보 조회
    await Promise.all(
      hashes.map(async (hash) => {
        try {
          // 캐시 확인
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

          const files = await ImageFileModel.findActiveByHash(hash);
          if (files.length === 0) {
            results[hash] = { success: false, error: 'File not found' };
            return;
          }

          const mimeType = files[0].mime_type;

          // 비디오인 경우 원본 경로 반환
          if (mimeType && mimeType.startsWith('video/')) {
            results[hash] = {
              success: true,
              thumbnailPath: files[0].original_file_path,
              mimeType
            };
            return;
          }

          // 이미지인 경우 썸네일 경로 반환 (썸네일이 없으면 원본 사용)
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

/**
 * 원본 파일 조회 (GIF/비디오용, composite_hash 기반)
 * GET /api/images/:compositeHash/file
 * GIF와 비디오는 썸네일을 생성하지 않고 원본 파일을 직접 제공
 */
router.get('/:compositeHash/file', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.compositeHash;

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const files = await ImageFileModel.findActiveByHash(compositeHash);

    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const originalPath = resolveUploadsPath(files[0].original_file_path);

    if (!fs.existsSync(originalPath)) {
      console.warn(`[ImageServe] File missing on disk during raw file access: ${originalPath}`);
      // DB 상태 업데이트: missing
      ImageFileModel.updateStatus(files[0].id, 'missing');

      return res.status(404).json({
        success: false,
        error: 'File not found on disk'
      });
    }

    const mimeType = files[0].mime_type;

    // 비디오인 경우 Range 요청 지원
    if (mimeType && mimeType.startsWith('video/')) {
      const stat = fs.statSync(originalPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // Range 요청 처리 (비디오 시킹 지원)
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        const fileStream = fs.createReadStream(originalPath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        fileStream.pipe(res);
        return;
      } else {
        // 전체 비디오 스트리밍
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        const fileStream = fs.createReadStream(originalPath);
        fileStream.pipe(res);
        return;
      }
    }

    // GIF 또는 기타 파일인 경우 일반 스트리밍
    const stats = await fs.promises.stat(originalPath);
    const etag = generateETag(stats);

    // Check If-None-Match header
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);

    const fileStream = fs.createReadStream(originalPath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('File serve error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve file'
    });
    return;
  }
}));

/**
 * 썸네일 이미지/비디오 조회 (스트림 방식, composite_hash 기반)
 * GET /api/images/:compositeHash/thumbnail
 */
router.get('/:compositeHash/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.compositeHash;

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const metadata = await MediaMetadataModel.findByHash(compositeHash);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    const files = await ImageFileModel.findActiveByHash(compositeHash);
    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found'
      });
    }

    const mimeType = files[0].mime_type;

    // 비디오인 경우 원본 비디오를 스트리밍으로 제공
    if (mimeType && mimeType.startsWith('video/')) {
      const originalPath = resolveUploadsPath(files[0].original_file_path);

      if (!fs.existsSync(originalPath)) {
        console.warn(`[ImageServe] Video file missing on disk: ${originalPath}`);
        // DB 상태 업데이트: missing
        ImageFileModel.updateStatus(files[0].id, 'missing');

        return res.status(404).json({
          success: false,
          error: 'Video file not found'
        });
      }

      // 비디오 스트리밍 헤더 설정
      const stat = fs.statSync(originalPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // Range 요청 처리 (비디오 시킹 지원)
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        const fileStream = fs.createReadStream(originalPath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        fileStream.pipe(res);
      } else {
        // 전체 비디오 스트리밍
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        const fileStream = fs.createReadStream(originalPath);
        fileStream.pipe(res);
      }
      return;
    }

    // 이미지인 경우 썸네일 제공
    // thumbnail_path가 없거나 파일이 존재하지 않으면 원본 이미지 사용
    // 썸네일은 tempDir에 저장됨 (thumbnails/{date}/{hash}.webp)
    let thumbnailPath = metadata.thumbnail_path
      ? path.join(runtimePaths.tempDir, metadata.thumbnail_path)
      : null;

    let serveOriginal = false;

    if (!thumbnailPath || !fs.existsSync(thumbnailPath)) {
      // 썸네일이 없으면 원본 확인 및 썸네일 재생성 시도
      const originalPath = resolveUploadsPath(files[0].original_file_path);

      if (!fs.existsSync(originalPath)) {
        console.warn(`[ImageServe] Both thumbnail and original missing: ${files[0].original_file_path}`);
        // DB 상태 업데이트: missing
        ImageFileModel.updateStatus(files[0].id, 'missing');

        return res.status(404).json({
          success: false,
          error: 'Thumbnail and original file not found'
        });
      }

      // 썸네일은 없지만 원본은 있는 경우 -> 썸네일 재생성 시도
      try {
        console.log(`[ImageServe] Regenerating missing thumbnail for ${compositeHash}`);
        const relativeThumbPath = await ThumbnailGenerator.generateThumbnail(originalPath, compositeHash);

        // DB 업데이트
        MediaMetadataModel.update(compositeHash, { thumbnail_path: relativeThumbPath });

        thumbnailPath = path.join(runtimePaths.tempDir, relativeThumbPath);

        // 재생성된 썸네일이 실제로 존재하는지 확인
        if (!fs.existsSync(thumbnailPath)) {
          // 재생성했으나 파일이 안보이는 특이 케이스 -> 원본 제공으로 폴백
          serveOriginal = true;
        }
      } catch (err) {
        console.error(`[ImageServe] Failed to regenerate thumbnail: ${err}`);
        // 재생성 실패 시 원본 제공 시도
        serveOriginal = true;
      }
    }

    if (serveOriginal) {
      const originalPath = resolveUploadsPath(files[0].original_file_path);
      // 위에서 이미 존재 확인 했지만, 안전을 위해 더블 체크
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Original file not found'
        });
      }

      // 원본 이미지 제공 with ETag
      const stats = await fs.promises.stat(originalPath);
      const etag = generateETag(stats);

      // Check If-None-Match header
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', etag);
      const fileStream = fs.createReadStream(originalPath);
      fileStream.pipe(res);
      return;
    }

    // 썸네일 제공 with ETag (thumbnailPath는 여기서 반드시 유효한 경로여야 함)
    // TypeScript check
    if (!thumbnailPath) {
      // Fallback (Should typically not reach here due to logic above)
      return res.status(404).json({ success: false, error: "Thumbnail path error" });
    }

    const stats = await fs.promises.stat(thumbnailPath);
    const etag = generateETag(stats);

    // Check If-None-Match header
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    const fileStream = fs.createReadStream(thumbnailPath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Thumbnail error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve thumbnail'
    });
    return;
  }
}));

/**
 * 원본 이미지 다운로드 (composite_hash 기반)
 * GET /api/images/:compositeHash/download/original
 */
router.get('/:compositeHash/download/original', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.compositeHash;

  if (!compositeHash || (compositeHash.length !== 48 && compositeHash.length !== 32)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const files = await ImageFileModel.findActiveByHash(compositeHash);

    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found'
      });
    }

    const filePath = resolveUploadsPath(files[0].original_file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // 파일 다운로드 헤더 설정 (RFC 2231 - Unicode 파일명 지원)
    const filename = path.basename(files[0].original_file_path);
    const encodedFilename = encodeURIComponent(filename);

    // RFC 2231 형식: filename*=UTF-8''encoded-filename
    // 이전 브라우저 호환성을 위해 filename도 함께 제공
    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Type', files[0].mime_type);

    // 파일 스트림으로 전송
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Original download error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download original image'
    });
    return;
  }
}));

/**
 * 경로 기반 이미지 조회 (Phase 1 지원)
 * GET /api/images/by-path/:encodedPath
 * Phase 1에서 composite_hash가 없는 이미지를 위한 엔드포인트
 */
router.get('/by-path/:encodedPath', asyncHandler(async (req: Request, res: Response) => {
  const encodedPath = req.params.encodedPath;

  try {
    // URL 디코딩
    const filePath = decodeURIComponent(encodedPath);

    // 파일 존재 확인
    const resolvedPath = resolveUploadsPath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // MIME 타입 감지
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska'
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // 캐시 헤더 설정 (짧은 캐시 - Phase 2 완료 후 썸네일로 전환될 수 있음)
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1시간 캐시

    // 파일 스트리밍
    const fileStream = fs.createReadStream(resolvedPath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Path-based image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve image'
    });
    return;
  }
}));

/**
 * 플레이스홀더 이미지 제공
 * GET /api/images/placeholder
 * 이미지 로드 실패 시 표시할 대체 이미지
 */
router.get('/placeholder', asyncHandler(async (req: Request, res: Response) => {
  try {
    const placeholderPath = resolveUploadsPath('placeholder-image.svg');

    if (!fs.existsSync(placeholderPath)) {
      return res.status(404).json({
        success: false,
        error: 'Placeholder image not found'
      });
    }

    // SVG 파일 제공
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1년 캐시

    const fileStream = fs.createReadStream(placeholderPath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Placeholder image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve placeholder image'
    });
    return;
  }
}));

export { router as queryRoutes };

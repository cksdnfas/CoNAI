import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageMetadataModel } from '../../models/Image/ImageMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageSearchModel } from '../../models/Image/ImageSearchModel';
import { ImageListResponse } from '../../types/image';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { enrichImageWithFileView } from './utils';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 이미지 목록 조회 (composite_hash 기반, 새 구조)
 * GET /api/images
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const sortBy = (req.query.sortBy as 'first_seen_date' | 'width' | 'height') || 'first_seen_date';
  const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

  try {
    // ImageMetadataModel로 조회 (파일 경로 포함)
    const result = await ImageMetadataModel.findAllWithFiles({
      page,
      limit,
      sortBy,
      sortOrder
    });

    // URL 추가
    const enrichedImages = result.items.map(enrichImageWithFileView);

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
    const image = await ImageMetadataModel.getRandomImage();

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
 * 검색 조건에 맞는 composite_hash만 조회 (랜덤 선택용)
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

    const compositeHashes = await ImageSearchModel.searchCompositeHashes(searchParams);

    res.json({
      success: true,
      data: {
        composite_hashes: compositeHashes,
        total: compositeHashes.length
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

  if (!compositeHash || compositeHash.length !== 48) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const metadata = await ImageMetadataModel.findByHash(compositeHash);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    // 파일 경로 조회
    const files = await ImageFileModel.findActiveByHash(compositeHash);
    const imageWithFile = {
      ...metadata,
      file_id: files.length > 0 ? files[0].id : null,
      original_file_path: files.length > 0 ? files[0].original_file_path : null,
      file_size: files.length > 0 ? files[0].file_size : null,
      mime_type: files.length > 0 ? files[0].mime_type : 'image/jpeg'
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
    const result = await ImageMetadataModel.findByDateRange(startDate, endDate, page, limit);

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
 * 썸네일 이미지/비디오 조회 (스트림 방식, composite_hash 기반)
 * GET /api/images/:compositeHash/thumbnail
 */
router.get('/:compositeHash/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.compositeHash;

  if (!compositeHash || compositeHash.length !== 48) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const metadata = await ImageMetadataModel.findByHash(compositeHash);

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
    if (!metadata.thumbnail_path) {
      return res.status(404).json({
        success: false,
        error: 'Thumbnail not found'
      });
    }

    const thumbnailPath = resolveUploadsPath(metadata.thumbnail_path);

    if (!fs.existsSync(thumbnailPath)) {
      // 썸네일이 없으면 원본 이미지로 폴백
      const originalPath = resolveUploadsPath(files[0].original_file_path);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Thumbnail and original file not found'
        });
      }

      // 원본 이미지 제공
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const fileStream = fs.createReadStream(originalPath);
      fileStream.pipe(res);
      return;
    }

    // 썸네일 제공
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

  if (!compositeHash || compositeHash.length !== 48) {
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

    // 파일 다운로드 헤더 설정
    const filename = path.basename(files[0].original_file_path);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
 * 최적화 이미지 조회 (스트림 방식, composite_hash 기반)
 * GET /api/images/:compositeHash/optimized
 */
router.get('/:compositeHash/optimized', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.compositeHash;

  if (!compositeHash || compositeHash.length !== 48) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const metadata = await ImageMetadataModel.findByHash(compositeHash);

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

    if (!metadata.optimized_path) {
      // 최적화 버전이 없으면 원본으로 폴백
      const originalPath = resolveUploadsPath(files[0].original_file_path);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Optimized and original file not found'
        });
      }

      res.setHeader('Content-Type', files[0].mime_type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const fileStream = fs.createReadStream(originalPath);
      fileStream.pipe(res);
      return;
    }

    const optimizedPath = resolveUploadsPath(metadata.optimized_path);

    if (!fs.existsSync(optimizedPath)) {
      // 최적화 파일이 없으면 원본으로 폴백
      const originalPath = resolveUploadsPath(files[0].original_file_path);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Optimized and original file not found'
        });
      }

      res.setHeader('Content-Type', files[0].mime_type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const fileStream = fs.createReadStream(originalPath);
      fileStream.pipe(res);
      return;
    }

    // 최적화 이미지 제공
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const fileStream = fs.createReadStream(optimizedPath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Optimized image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to serve optimized image'
    });
    return;
  }
}));

/**
 * 저용량 이미지 다운로드 (composite_hash 기반)
 * GET /api/images/:compositeHash/download/optimized
 */
router.get('/:compositeHash/download/optimized', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.compositeHash;

  if (!compositeHash || compositeHash.length !== 48) {
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    const metadata = await ImageMetadataModel.findByHash(compositeHash);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    if (!metadata.optimized_path) {
      return res.status(404).json({
        success: false,
        error: 'Optimized version not available'
      });
    }

    const filePath = resolveUploadsPath(metadata.optimized_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Optimized file not found'
      });
    }

    // 파일 다운로드 헤더 설정
    res.setHeader('Content-Disposition', `attachment; filename="${compositeHash}_optimized.webp"`);
    res.setHeader('Content-Type', 'image/webp');

    // 파일 스트림으로 전송
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Optimized download error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download optimized image'
    });
    return;
  }
}));

export { router as queryRoutes };

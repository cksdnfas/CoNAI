import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageModel } from '../../models/Image';
import { ImageListResponse } from '../../types/image';
import { runtimePaths } from '../../config/runtimePaths';
import { enrichImageRecord } from './utils';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 이미지 목록 조회 (그룹 정보 포함)
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const sortBy = (req.query.sortBy as 'upload_date' | 'filename' | 'file_size') || 'upload_date';
  const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

  try {
    // 기본적으로 그룹 정보 포함하여 조회
    const result = await ImageModel.findWithGroups(page, limit, sortBy, sortOrder);

    // URL과 구조화된 메타데이터 추가
    const enrichedImages = result.images.map(enrichImageRecord);

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
    return;
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
 * 랜덤 이미지 조회
 * GET /api/images/random
 */
router.get('/random', asyncHandler(async (req: Request, res: Response) => {
  try {
    const image = await ImageModel.getRandomImage();

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'No images found'
      });
    }

    res.json({
      success: true,
      data: enrichImageRecord(image)
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
    const image = await ImageModel.getRandomFromSearch(searchParams);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'No images found matching search criteria'
      });
    }

    res.json({
      success: true,
      data: enrichImageRecord(image)
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
 * 고급 이미지 검색 (프롬프트 중심)
 * POST /api/images/search
 */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const {
    search_text,         // 긍정 프롬프트 검색 키워드
    negative_text,       // 네거티브 프롬프트 검색 키워드 (필터)
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
    sortBy = 'upload_date',
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

    const result = await ImageModel.advancedSearch(
      searchParams,
      parseInt(page),
      parseInt(limit),
      sortBy,
      sortOrder
    );

    // URL과 구조화된 메타데이터 추가 (그룹 정보 이미 포함됨)
    const enrichedImages = result.images.map(enrichImageRecord);

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
    return;
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
 * 검색 조건에 맞는 이미지 ID만 조회 (랜덤 선택용)
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

    const ids = await ImageModel.searchImageIds(searchParams);

    res.json({
      success: true,
      data: {
        ids,
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
 * 특정 이미지 조회
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    res.json({
      success: true,
      data: enrichImageRecord(image)
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
 * 날짜 범위로 이미지 조회
 */
router.get('/date/:startDate/:endDate', asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  try {
    const result = await ImageModel.findByDateRange(startDate, endDate, page, limit);

    const enrichedImages = result.images.map(enrichImageRecord);

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
 * 썸네일 이미지/비디오 조회 (스트림 방식)
 * 비디오의 경우 원본 비디오를 스트리밍으로 제공
 */
router.get('/:id/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    // 비디오인 경우 원본 비디오를 스트리밍으로 제공
    if (image.mime_type && image.mime_type.startsWith('video/')) {
      const originalPath = path.join(UPLOAD_BASE_PATH, image.file_path);

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
          'Content-Type': image.mime_type,
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        fileStream.pipe(res);
      } else {
        // 전체 비디오 스트리밍
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': image.mime_type,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        });

        const fileStream = fs.createReadStream(originalPath);
        fileStream.pipe(res);
      }
      return;
    }

    // 이미지인 경우 기존 로직
    const thumbnailPath = path.join(UPLOAD_BASE_PATH, image.thumbnail_path);

    if (!fs.existsSync(thumbnailPath)) {
      // 썸네일이 없으면 원본 이미지로 폴백
      const originalPath = path.join(UPLOAD_BASE_PATH, image.file_path);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Thumbnail and original file not found'
        });
      }

      // 원본 이미지 제공
      res.setHeader('Content-Type', image.mime_type);
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
 * 원본 이미지 다운로드
 */
router.get('/:id/download/original', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    const filePath = path.join(UPLOAD_BASE_PATH, image.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // 파일 다운로드 헤더 설정
    res.setHeader('Content-Disposition', `attachment; filename="${image.original_name}"`);
    res.setHeader('Content-Type', image.mime_type);

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
 * 최적화 이미지 조회 (스트림 방식)
 */
router.get('/:id/optimized', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    if (!image.optimized_path) {
      // 최적화 버전이 없으면 원본으로 폴백
      const originalPath = path.join(UPLOAD_BASE_PATH, image.file_path);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Optimized and original file not found'
        });
      }

      res.setHeader('Content-Type', image.mime_type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const fileStream = fs.createReadStream(originalPath);
      fileStream.pipe(res);
      return;
    }

    const optimizedPath = path.join(UPLOAD_BASE_PATH, image.optimized_path);

    if (!fs.existsSync(optimizedPath)) {
      // 최적화 파일이 없으면 원본으로 폴백
      const originalPath = path.join(UPLOAD_BASE_PATH, image.file_path);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Optimized and original file not found'
        });
      }

      res.setHeader('Content-Type', image.mime_type);
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
 * 저용량 이미지 다운로드
 */
router.get('/:id/download/optimized', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    if (!image.optimized_path) {
      return res.status(404).json({
        success: false,
        error: 'Optimized version not available'
      });
    }

    const filePath = path.join(UPLOAD_BASE_PATH, image.optimized_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Optimized file not found'
      });
    }

    // 파일 다운로드 헤더 설정
    const originalName = path.parse(image.original_name).name;
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}_optimized.webp"`);
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

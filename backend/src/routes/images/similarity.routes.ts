import { Router, Request, Response } from 'express';
import path from 'path';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageModel } from '../../models/Image';
import { ImageSimilarityModel } from '../../models/Image/ImageSimilarityModel';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import {
  SimilaritySearchResponse,
  DuplicateSearchResponse,
  SIMILARITY_THRESHOLDS
} from '../../types/similarity';
import { runtimePaths } from '../../config/runtimePaths';
import { validateId, successResponse, errorResponse, PAGINATION } from '@comfyui-image-manager/shared';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * GET /api/images/:id/duplicates
 * 특정 이미지의 중복 이미지 검색
 */
router.get('/:id/duplicates', asyncHandler(async (req: Request, res: Response) => {
  try {
    const imageId = validateId(req.params.id, 'Image ID');
    const threshold = parseInt(req.query.threshold as string) || SIMILARITY_THRESHOLDS.NEAR_DUPLICATE;
    const includeMetadata = req.query.includeMetadata !== 'false';

    // 이미지 존재 확인
    const image = await ImageModel.findById(imageId);
    if (!image) {
      return res.status(404).json(errorResponse('Image not found'));
    }

    if (!image.perceptual_hash) {
      return res.status(400).json(errorResponse('Image does not have perceptual hash. Please rebuild hashes.'));
    }

    const duplicates = await ImageSimilarityModel.findDuplicates(imageId, {
      threshold,
      includeMetadata
    });

    return res.json(successResponse({
      similar: duplicates,
      total: duplicates.length,
      query: {
        imageId,
        threshold,
        limit: duplicates.length
      }
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to find duplicates';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/:id/similar
 * 특정 이미지와 유사한 이미지 검색
 */
router.get('/:id/similar', asyncHandler(async (req: Request, res: Response) => {
  try {
    const imageId = validateId(req.params.id, 'Image ID');
    const threshold = parseInt(req.query.threshold as string) || SIMILARITY_THRESHOLDS.SIMILAR;
    const limit = parseInt(req.query.limit as string) || PAGINATION.GROUP_IMAGES_LIMIT;
    const includeColorSimilarity = req.query.includeColorSimilarity === 'true';
    const sortBy = (req.query.sortBy as 'similarity' | 'upload_date' | 'file_size') || 'similarity';
    const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

    // 이미지 존재 확인
    const image = await ImageModel.findById(imageId);
    if (!image) {
      return res.status(404).json(errorResponse('Image not found'));
    }

    if (!image.perceptual_hash) {
      return res.status(400).json(errorResponse('Image does not have perceptual hash. Please rebuild hashes.'));
    }

    const similar = await ImageSimilarityModel.findSimilar(imageId, {
      threshold,
      limit,
      includeColorSimilarity,
      sortBy,
      sortOrder
    });

    return res.json(successResponse({
      similar,
      total: similar.length,
      query: {
        imageId,
        threshold,
        limit
      }
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to find similar images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/:id/similar-color
 * 특정 이미지와 색감이 유사한 이미지 검색
 */
router.get('/:id/similar-color', asyncHandler(async (req: Request, res: Response) => {
  try {
    const imageId = validateId(req.params.id, 'Image ID');
    const threshold = parseFloat(req.query.threshold as string) || (SIMILARITY_THRESHOLDS.COLOR_SIMILAR * 100);
    const limit = parseInt(req.query.limit as string) || PAGINATION.GROUP_IMAGES_LIMIT;

    // 이미지 존재 확인
    const image = await ImageModel.findById(imageId);
    if (!image) {
      return res.status(404).json(errorResponse('Image not found'));
    }

    if (!image.color_histogram) {
      return res.status(400).json(errorResponse('Image does not have color histogram. Please rebuild hashes.'));
    }

    const similar = await ImageSimilarityModel.findSimilarByColor(imageId, threshold, limit);

    return res.json(successResponse({
      similar,
      total: similar.length,
      query: {
        imageId,
        threshold,
        limit
      }
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to find similar images by color';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/duplicates/all
 * 전체 중복 이미지 그룹 검색
 */
router.get('/duplicates/all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const threshold = parseInt(req.query.threshold as string) || SIMILARITY_THRESHOLDS.NEAR_DUPLICATE;
    const minGroupSize = parseInt(req.query.minGroupSize as string) || 2;

    const groups = await ImageSimilarityModel.findAllDuplicateGroups({
      threshold,
      minGroupSize
    });

    const totalImages = groups.reduce((sum, group) => sum + group.images.length, 0);

    return res.json(successResponse({
      groups,
      totalGroups: groups.length,
      totalImages,
      query: {
        threshold,
        minGroupSize
      }
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to find duplicate groups';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

/**
 * POST /api/images/similarity/rebuild
 * 기존 이미지들의 해시 재생성 (배치 처리)
 * - limit 파라미터: 한 번에 처리할 이미지 개수 (기본값: 50)
 */
router.post('/similarity/rebuild', asyncHandler(async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    // 해시가 없는 이미지 개수 조회
    const totalWithoutHash = await ImageSimilarityModel.countImagesWithoutHash();

    if (totalWithoutHash === 0) {
      return res.json(successResponse({
        message: 'All images already have hashes',
        processed: 0,
        failed: 0,
        total: 0,
        remaining: 0
      }));
    }

    // 배치 크기만큼 이미지 조회
    const imagesToProcess = await ImageSimilarityModel.getImagesWithoutHash(limit);
    let processed = 0;
    let failed = 0;
    const errors: Array<{ imageId: number; error: string }> = [];

    for (const image of imagesToProcess) {
      try {
        const fullPath = path.join(UPLOAD_BASE_PATH, image.file_path);

        // 해시 생성
        const perceptualHash = await ImageSimilarityService.generatePerceptualHash(fullPath);
        const histogram = await ImageSimilarityService.generateColorHistogram(fullPath);
        const colorHistogram = ImageSimilarityService.serializeHistogram(histogram);

        // 데이터베이스 업데이트
        await ImageSimilarityModel.updateHash(image.id, perceptualHash, colorHistogram);
        processed++;
      } catch (error) {
        failed++;
        errors.push({
          imageId: image.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        console.error(`Failed to process image ${image.id}:`, error);
      }
    }

    return res.json(successResponse({
      message: `Processed ${processed} images`,
      processed,
      failed,
      total: totalWithoutHash,
      remaining: totalWithoutHash - processed,
      errors: errors.length > 0 ? errors : undefined
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to rebuild hashes';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/similarity/stats
 * 유사도 검색 통계
 */
router.get('/similarity/stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const totalImages = await ImageSimilarityModel.countImagesWithoutHash();
    const totalWithHash = await ImageModel.findAll(1, 1);

    return res.json(successResponse({
      totalImages: totalWithHash.total,
      imagesWithoutHash: totalImages,
      imagesWithHash: totalWithHash.total - totalImages,
      completionPercentage: totalWithHash.total > 0
        ? Math.round(((totalWithHash.total - totalImages) / totalWithHash.total) * 100)
        : 0
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get similarity stats';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

export { router as similarityRoutes };

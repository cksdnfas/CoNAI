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

    const duplicates = await ImageSimilarityModel.findDuplicatesByImageId(imageId, {
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

    const similar = await ImageSimilarityModel.findSimilarByImageId(imageId, {
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

    const similar = await ImageSimilarityModel.findSimilarByColorByImageId(imageId, threshold, limit);

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
 * @deprecated 레거시 엔드포인트 - 새 구조에서는 이미지 업로드/스캔 시 자동으로 해시 생성됨
 *
 * 기존 images 테이블 기반 해시 재생성 기능
 * 새 구조(image_metadata)에서는 폴더 스캔 시 자동 처리되므로 불필요
 */
router.post('/similarity/rebuild', asyncHandler(async (req: Request, res: Response) => {
  return res.status(410).json(errorResponse(
    'This endpoint is deprecated. In the new architecture, hashes are automatically generated during image upload/scan. ' +
    'Please use the folder scan system (/api/folders/:id/scan) to process images.'
  ));
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

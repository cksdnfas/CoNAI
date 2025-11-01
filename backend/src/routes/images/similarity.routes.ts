import { Router, Request, Response } from 'express';
import path from 'path';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageModel } from '../../models/Image';
import { ImageMetadataModel } from '../../models/Image/ImageMetadataModel';
import { ImageSimilarityModel } from '../../models/Image/ImageSimilarityModel';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import {
  SimilaritySearchResponse,
  DuplicateSearchResponse,
  SIMILARITY_THRESHOLDS
} from '../../types/similarity';
import { runtimePaths } from '../../config/runtimePaths';
import { validateId, successResponse, errorResponse, PAGINATION } from '@comfyui-image-manager/shared';
import { db } from '../../database/init';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * ID 파라미터가 composite_hash인지 numeric ID인지 판별
 * @param id - URL 파라미터 값
 * @returns { isHash: boolean, value: string | number }
 */
function parseImageIdentifier(id: string): { isHash: boolean; value: string | number } {
  // composite_hash는 일반적으로 64자 16진수 문자열 (SHA256)
  // 숫자만 있으면 imageId로 간주
  const numericId = parseInt(id, 10);
  if (!isNaN(numericId) && id === numericId.toString()) {
    return { isHash: false, value: numericId };
  }
  return { isHash: true, value: id };
}

/**
 * GET /api/images/:id/duplicates
 * 특정 이미지의 중복 이미지 검색
 * @param id - composite_hash (string) 또는 legacy imageId (number)
 */
router.get('/:id/duplicates', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { isHash, value } = parseImageIdentifier(req.params.id);
    const threshold = parseInt(req.query.threshold as string) || SIMILARITY_THRESHOLDS.NEAR_DUPLICATE;
    const includeMetadata = req.query.includeMetadata !== 'false';

    let image;
    let duplicates;

    if (isHash) {
      // 새 구조: composite_hash 기반
      const compositeHash = value as string;
      image = ImageMetadataModel.findByHash(compositeHash);
      if (!image) {
        return res.status(404).json(errorResponse('Image metadata not found'));
      }

      if (!image.perceptual_hash) {
        return res.status(400).json(errorResponse('Image does not have perceptual hash. Please rebuild hashes.'));
      }

      duplicates = await ImageSimilarityModel.findDuplicates(compositeHash, {
        threshold,
        includeMetadata
      });
    } else {
      // 레거시: imageId 기반
      const imageId = value as number;
      image = await ImageModel.findById(imageId);
      if (!image) {
        return res.status(404).json(errorResponse('Image not found'));
      }

      if (!image.perceptual_hash) {
        return res.status(400).json(errorResponse('Image does not have perceptual hash. Please rebuild hashes.'));
      }

      duplicates = await ImageSimilarityModel.findDuplicatesByImageId(imageId, {
        threshold,
        includeMetadata
      });
    }

    return res.json(successResponse({
      similar: duplicates,
      total: duplicates.length,
      query: {
        imageId: value,
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
 * @param id - composite_hash (string) 또는 legacy imageId (number)
 */
router.get('/:id/similar', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { isHash, value } = parseImageIdentifier(req.params.id);
    const threshold = parseInt(req.query.threshold as string) || SIMILARITY_THRESHOLDS.SIMILAR;
    const limit = parseInt(req.query.limit as string) || PAGINATION.GROUP_IMAGES_LIMIT;
    const includeColorSimilarity = req.query.includeColorSimilarity === 'true';
    const sortBy = (req.query.sortBy as 'similarity' | 'upload_date' | 'file_size') || 'similarity';
    const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

    let image;
    let similar;

    if (isHash) {
      // 새 구조: composite_hash 기반
      const compositeHash = value as string;
      image = ImageMetadataModel.findByHash(compositeHash);
      if (!image) {
        return res.status(404).json(errorResponse('Image metadata not found'));
      }

      if (!image.perceptual_hash) {
        return res.status(400).json(errorResponse('Image does not have perceptual hash. Please rebuild hashes.'));
      }

      similar = await ImageSimilarityModel.findSimilar(compositeHash, {
        threshold,
        limit,
        includeColorSimilarity,
        sortBy,
        sortOrder
      });
    } else {
      // 레거시: imageId 기반
      const imageId = value as number;
      image = await ImageModel.findById(imageId);
      if (!image) {
        return res.status(404).json(errorResponse('Image not found'));
      }

      if (!image.perceptual_hash) {
        return res.status(400).json(errorResponse('Image does not have perceptual hash. Please rebuild hashes.'));
      }

      similar = await ImageSimilarityModel.findSimilarByImageId(imageId, {
        threshold,
        limit,
        includeColorSimilarity,
        sortBy,
        sortOrder
      });
    }

    return res.json(successResponse({
      similar,
      total: similar.length,
      query: {
        imageId: value,
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
 * @param id - composite_hash (string) 또는 legacy imageId (number)
 */
router.get('/:id/similar-color', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { isHash, value } = parseImageIdentifier(req.params.id);
    const threshold = parseFloat(req.query.threshold as string) || (SIMILARITY_THRESHOLDS.COLOR_SIMILAR * 100);
    const limit = parseInt(req.query.limit as string) || PAGINATION.GROUP_IMAGES_LIMIT;

    let image;
    let similar;

    if (isHash) {
      // 새 구조: composite_hash 기반
      const compositeHash = value as string;
      image = ImageMetadataModel.findByHash(compositeHash);
      if (!image) {
        return res.status(404).json(errorResponse('Image metadata not found'));
      }

      if (!image.color_histogram) {
        return res.status(400).json(errorResponse('Image does not have color histogram. Please rebuild hashes.'));
      }

      similar = await ImageSimilarityModel.findSimilarByColor(compositeHash, threshold, limit);
    } else {
      // 레거시: imageId 기반
      const imageId = value as number;
      image = await ImageModel.findById(imageId);
      if (!image) {
        return res.status(404).json(errorResponse('Image not found'));
      }

      if (!image.color_histogram) {
        return res.status(400).json(errorResponse('Image does not have color histogram. Please rebuild hashes.'));
      }

      similar = await ImageSimilarityModel.findSimilarByColorByImageId(imageId, threshold, limit);
    }

    return res.json(successResponse({
      similar,
      total: similar.length,
      query: {
        imageId: value,
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
 * 이미지 메타데이터의 해시를 재생성
 *
 * image_metadata 테이블에서 perceptual_hash, dhash, ahash, color_histogram이 없는 이미지를
 * 찾아서 해시를 생성합니다.
 */
router.post('/similarity/rebuild', asyncHandler(async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    // 해시가 없는 이미지 메타데이터 조회
    const imagesWithoutHash = db.prepare(`
      SELECT im.composite_hash, if.file_path
      FROM image_metadata im
      JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE if.file_type = 'original'
        AND (im.perceptual_hash IS NULL OR im.color_histogram IS NULL)
      LIMIT ?
    `).all(limit) as Array<{ composite_hash: string; file_path: string }>;

    if (imagesWithoutHash.length === 0) {
      return res.json(successResponse({
        message: 'All images already have hashes',
        processed: 0,
        failed: 0,
        total: 0,
        remaining: 0
      }));
    }

    let processed = 0;
    let failed = 0;
    const errors: Array<{ compositeHash: string; error: string }> = [];

    for (const imageData of imagesWithoutHash) {
      try {
        const fullPath = path.join(UPLOAD_BASE_PATH, imageData.file_path);

        // 파일 존재 확인
        const fs = await import('fs/promises');
        await fs.access(fullPath);

        // 해시 생성
        const result = await ImageSimilarityService.generateHashAndHistogram(fullPath);

        // 메타데이터 업데이트
        const success = await ImageSimilarityModel.updateHash(
          imageData.composite_hash,
          result.hashes.perceptualHash,
          ImageSimilarityService.serializeHistogram(result.colorHistogram)
        );

        if (success) {
          processed++;
        } else {
          failed++;
          errors.push({
            compositeHash: imageData.composite_hash,
            error: 'Failed to update database'
          });
        }
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          compositeHash: imageData.composite_hash,
          error: errorMessage
        });
      }
    }

    // 남은 이미지 수 계산
    const remainingCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_metadata
      WHERE perceptual_hash IS NULL OR color_histogram IS NULL
    `).get() as { count: number };

    return res.json(successResponse({
      message: `Processed ${processed} images, ${failed} failed`,
      processed,
      failed,
      total: imagesWithoutHash.length,
      remaining: remainingCount.count,
      errors: errors.length > 0 ? errors : undefined
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to rebuild hashes';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/similarity/stats
 * 유사도 검색 통계 (image_metadata 기반)
 */
router.get('/similarity/stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    // 전체 이미지 수
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM image_metadata').get() as { count: number };

    // 해시가 없는 이미지 수
    const withoutHashCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_metadata
      WHERE perceptual_hash IS NULL OR color_histogram IS NULL
    `).get() as { count: number };

    const totalImages = totalCount.count;
    const imagesWithoutHash = withoutHashCount.count;
    const imagesWithHash = totalImages - imagesWithoutHash;

    return res.json(successResponse({
      totalImages,
      imagesWithoutHash,
      imagesWithHash,
      completionPercentage: totalImages > 0
        ? Math.round((imagesWithHash / totalImages) * 100)
        : 0
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get similarity stats';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

export { router as similarityRoutes };

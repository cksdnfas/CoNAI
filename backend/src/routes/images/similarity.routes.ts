import { Router, Request, Response } from 'express';
import path from 'path';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageSimilarityModel } from '../../models/Image/ImageSimilarityModel';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import { SIMILARITY_THRESHOLDS } from '../../types/similarity';
import { runtimePaths } from '../../config/runtimePaths';
import { successResponse, errorResponse, PAGINATION } from '@conai/shared';
import { db } from '../../database/init';
import { sendRouteBadRequest } from '../routeValidation';
import {
  ensureImageFieldOrBlock,
  enrichDuplicateGroups,
  enrichSimilarityMatches,
  getSimilarityErrorStatusCode,
  getSimilarityRouteIdentifier,
  parseIntegerWithFallback,
  parseNumberWithFallback,
} from './similarity-route-helpers';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * GET /api/images/:id/duplicates
 * 특정 이미지의 중복 이미지 검색
 * @param id - composite_hash (string) 또는 legacy imageId (number)
 */
router.get('/:id/duplicates', asyncHandler(async (req: Request, res: Response) => {
  try {
    const identifier = getSimilarityRouteIdentifier(req);
    const { value } = identifier;
    const threshold = parseIntegerWithFallback(req.query.threshold, SIMILARITY_THRESHOLDS.NEAR_DUPLICATE);
    const includeMetadata = req.query.includeMetadata !== 'false';

    if (!ensureImageFieldOrBlock(res, identifier, {
      field: 'perceptual_hash',
      missingFieldMessage: 'Image does not have perceptual hash. Please rebuild hashes.'
    })) {
      return;
    }

    const duplicates = identifier.isHash
      ? await ImageSimilarityModel.findDuplicates(identifier.value, {
        threshold,
        includeMetadata
      })
      : await ImageSimilarityModel.findDuplicatesByImageId(identifier.value, {
        threshold,
        includeMetadata
      });

    const enrichedDuplicates = enrichSimilarityMatches(duplicates);

    return res.json(successResponse({
      similar: enrichedDuplicates,
      total: enrichedDuplicates.length,
      query: {
        imageId: value,
        threshold,
        limit: enrichedDuplicates.length
      }
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to find duplicates';
    return res.status(getSimilarityErrorStatusCode(error)).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/:id/similar
 * 특정 이미지와 유사한 이미지 검색
 * @param id - composite_hash (string) 또는 legacy imageId (number)
 */
router.get('/:id/similar', asyncHandler(async (req: Request, res: Response) => {
  try {
    const identifier = getSimilarityRouteIdentifier(req);
    const { value } = identifier;

    const threshold = parseIntegerWithFallback(req.query.threshold, SIMILARITY_THRESHOLDS.SIMILAR);
    const limit = parseIntegerWithFallback(req.query.limit, PAGINATION.GROUP_IMAGES_LIMIT);
    const includeColorSimilarity = req.query.includeColorSimilarity === 'true';
    const useMetadataFilter = req.query.useMetadataFilter === 'true';
    const sortBy = (req.query.sortBy as 'similarity' | 'upload_date' | 'file_size') || 'similarity';
    const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';
    const weights = {
      perceptualHash: parseNumberWithFallback(req.query.perceptualWeight, 50),
      dHash: parseNumberWithFallback(req.query.dHashWeight, 30),
      aHash: parseNumberWithFallback(req.query.aHashWeight, 20),
      color: parseNumberWithFallback(req.query.colorWeight, includeColorSimilarity ? 15 : 0),
    };
    const thresholds = {
      perceptualHash: parseIntegerWithFallback(req.query.perceptualThreshold, threshold),
      dHash: parseIntegerWithFallback(req.query.dHashThreshold, Math.min(64, threshold + 3)),
      aHash: parseIntegerWithFallback(req.query.aHashThreshold, Math.min(64, threshold + 5)),
      color: parseNumberWithFallback(req.query.colorThreshold, 0),
    };

    if (!ensureImageFieldOrBlock(res, identifier, {
      field: 'perceptual_hash',
      missingFieldMessage: 'Image does not have perceptual hash. Please rebuild hashes.'
    })) {
      return;
    }

    const similar = identifier.isHash
      ? await ImageSimilarityModel.findSimilar(identifier.value, {
        threshold,
        limit,
        includeColorSimilarity,
        weights,
        thresholds,
        useMetadataFilter,
        sortBy,
        sortOrder
      })
      : await ImageSimilarityModel.findSimilarByImageId(identifier.value, {
        threshold,
        limit,
        includeColorSimilarity,
        weights,
        thresholds,
        useMetadataFilter,
        sortBy,
        sortOrder
      });

    const enrichedSimilar = enrichSimilarityMatches(similar);

    return res.json(successResponse({
      similar: enrichedSimilar,
      total: enrichedSimilar.length,
      query: {
        imageId: value,
        threshold,
        limit
      }
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to find similar images';
    return res.status(getSimilarityErrorStatusCode(error)).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/:id/similar-color
 * 특정 이미지와 색감이 유사한 이미지 검색
 * @param id - composite_hash (string) 또는 legacy imageId (number)
 */
router.get('/:id/similar-color', asyncHandler(async (req: Request, res: Response) => {
  try {
    const identifier = getSimilarityRouteIdentifier(req);
    const { value } = identifier;
    const threshold = parseNumberWithFallback(req.query.threshold, SIMILARITY_THRESHOLDS.COLOR_SIMILAR * 100);
    const limit = parseIntegerWithFallback(req.query.limit, PAGINATION.GROUP_IMAGES_LIMIT);

    if (!ensureImageFieldOrBlock(res, identifier, {
      field: 'color_histogram',
      missingFieldMessage: 'Image does not have color histogram. Please rebuild hashes.'
    })) {
      return;
    }

    const similar = identifier.isHash
      ? await ImageSimilarityModel.findSimilarByColor(identifier.value, threshold, limit)
      : await ImageSimilarityModel.findSimilarByColorByImageId(identifier.value, threshold, limit);

    const enrichedSimilar = enrichSimilarityMatches(similar);

    return res.json(successResponse({
      similar: enrichedSimilar,
      total: enrichedSimilar.length,
      query: {
        imageId: value,
        threshold,
        limit
      }
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to find similar images by color';
    return res.status(getSimilarityErrorStatusCode(error)).json(errorResponse(errorMessage));
  }
}));

/**
 * GET /api/images/duplicates/all
 * 전체 중복 이미지 그룹 검색
 */
router.get('/duplicates/all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const threshold = parseIntegerWithFallback(req.query.threshold, SIMILARITY_THRESHOLDS.NEAR_DUPLICATE);
    const minGroupSize = parseIntegerWithFallback(req.query.minGroupSize, 2);

    const groups = await ImageSimilarityModel.findAllDuplicateGroups({
      threshold,
      minGroupSize
    });

    const enrichedGroups = enrichDuplicateGroups(groups);

    const totalImages = enrichedGroups.reduce((sum, group) => sum + group.images.length, 0);

    return res.json(successResponse({
      groups: enrichedGroups,
      totalGroups: enrichedGroups.length,
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
 * media_metadata 테이블에서 perceptual_hash, dhash, ahash, color_histogram이 없는 이미지를
 * 찾아서 해시를 생성합니다.
 */
router.post('/similarity/rebuild', asyncHandler(async (req: Request, res: Response) => {
  try {
    const limit = parseIntegerWithFallback(req.query.limit, 50);

    // 해시가 없는 이미지 메타데이터 조회
    const imagesWithoutHash = db.prepare(`
      SELECT im.composite_hash, if.file_path
      FROM media_metadata im
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
          result.hashes.dHash,
          result.hashes.aHash,
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

    // 남은 파일 수 계산 (composite_hash가 NULL인 파일)
    const remainingCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_files
      WHERE composite_hash IS NULL
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
 * POST /api/images/similarity/rebuild-hashes
 * composite_hash가 NULL인 파일들을 처리하여 해시 생성
 */
router.post('/similarity/rebuild-hashes', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { BackgroundProcessorService } = await import('../../services/backgroundProcessorService');

    // 백그라운드 프로세서 실행
    const result = await BackgroundProcessorService.processUnhashedImages();

    // 남은 파일 수 계산
    const remainingCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_files
      WHERE composite_hash IS NULL
    `).get() as { count: number };

    return res.json(successResponse({
      message: `Processed ${result.processed} files, ${result.errors} failed`,
      processed: result.processed,
      failed: result.errors,
      total: result.processed + result.errors,
      remaining: remainingCount.count
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to rebuild hashes';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

/**
 * DELETE /api/images/files/bulk
 * 개별 파일 삭제 (file_id 기반)
 * 중복 이미지에서 특정 파일만 선택적으로 삭제할 때 사용
 *
 * RecycleBin 설정을 준수하며, 물리적 파일과 DB 레코드를 모두 삭제합니다.
 */
router.delete('/files/bulk', asyncHandler(async (req: Request, res: Response) => {
  const { fileIds } = req.body;

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    sendRouteBadRequest(res, 'fileIds must be a non-empty array');
    return;
  }

  // Validate all fileIds are numbers
  const validFileIds = fileIds.filter(id => typeof id === 'number' && !isNaN(id));
  if (validFileIds.length !== fileIds.length) {
    sendRouteBadRequest(res, 'All fileIds must be valid numbers');
    return;
  }

  const { DeletionService } = await import('../../services/deletionService');

  const deletedFiles: number[] = [];
  const failedFiles: Array<{ fileId: number; error: string }> = [];

  console.log(`🗑️ Starting bulk file deletion: ${validFileIds.length} files`);

  for (const fileId of validFileIds) {
    try {
      const success = await DeletionService.deleteImageFile(fileId);

      if (success) {
        deletedFiles.push(fileId);
      } else {
        failedFiles.push({ fileId, error: 'File not found' });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error deleting file_id ${fileId}:`, error);
      failedFiles.push({ fileId, error: errorMessage });
    }
  }

  console.log(`✅ Bulk deletion completed: ${deletedFiles.length} success, ${failedFiles.length} failed`);

  return res.json(successResponse({
    message: `Deleted ${deletedFiles.length} files${failedFiles.length > 0 ? `, ${failedFiles.length} failed` : ''}`,
    deletedFiles,
    failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
    total: fileIds.length
  }));
}));

/**
 * GET /api/images/similarity/stats
 * 유사도 검색 통계 (image_files 테이블 기반)
 */
router.get('/similarity/stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    // 전체 파일 수 (image_files 테이블)
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM image_files').get() as { count: number };

    // composite_hash가 NULL인 파일 수
    const withoutHashCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_files
      WHERE composite_hash IS NULL
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

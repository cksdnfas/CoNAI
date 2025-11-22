import { Router, Request, Response } from 'express';
import path from 'path';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
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
import { enrichImageWithFileView } from './utils';

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
      image = MediaMetadataModel.findByHash(compositeHash);
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
      const legacyImage = db.prepare('SELECT perceptual_hash FROM images WHERE id = ?').get(imageId) as { perceptual_hash: string | null } | undefined;
      if (!legacyImage) {
        return res.status(404).json(errorResponse('Image not found'));
      }

      if (!legacyImage.perceptual_hash) {
        return res.status(400).json(errorResponse('Image does not have perceptual hash. Please rebuild hashes.'));
      }

      duplicates = await ImageSimilarityModel.findDuplicatesByImageId(imageId, {
        threshold,
        includeMetadata
      });
    }

    // Enrich results with URLs
    const enrichedDuplicates = duplicates.map(item => ({
      ...item,
      image: enrichImageWithFileView(item.image)
    }));

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
      image = MediaMetadataModel.findByHash(compositeHash);
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
      const legacyImage = db.prepare('SELECT perceptual_hash FROM images WHERE id = ?').get(imageId) as { perceptual_hash: string | null } | undefined;
      if (!legacyImage) {
        return res.status(404).json(errorResponse('Image not found'));
      }

      if (!legacyImage.perceptual_hash) {
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

    // Enrich results with URLs
    const enrichedSimilar = similar.map(item => ({
      ...item,
      image: enrichImageWithFileView(item.image)
    }));

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
      image = MediaMetadataModel.findByHash(compositeHash);
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
      const legacyImage = db.prepare('SELECT color_histogram FROM images WHERE id = ?').get(imageId) as { color_histogram: string | null } | undefined;
      if (!legacyImage) {
        return res.status(404).json(errorResponse('Image not found'));
      }

      if (!legacyImage.color_histogram) {
        return res.status(400).json(errorResponse('Image does not have color histogram. Please rebuild hashes.'));
      }

      similar = await ImageSimilarityModel.findSimilarByColorByImageId(imageId, threshold, limit);
    }

    // Enrich results with URLs
    const enrichedSimilar = similar.map(item => ({
      ...item,
      image: enrichImageWithFileView(item.image)
    }));

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

    // Enrich all images in all groups with URLs
    const enrichedGroups = groups.map(group => ({
      ...group,
      images: group.images.map(image => enrichImageWithFileView(image))
    }));

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
    const limit = parseInt(req.query.limit as string) || 50;

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
    return res.status(400).json(errorResponse('fileIds must be a non-empty array'));
  }

  // Validate all fileIds are numbers
  const validFileIds = fileIds.filter(id => typeof id === 'number' && !isNaN(id));
  if (validFileIds.length !== fileIds.length) {
    return res.status(400).json(errorResponse('All fileIds must be valid numbers'));
  }

  const { settingsService } = await import('../../services/settingsService');
  const { deleteFile: recycleBinDeleteFile } = await import('../../utils/recycleBin');
  const { ImageFileModel } = await import('../../models/Image/ImageFileModel');
  const { MediaMetadataModel } = await import('../../models/Image/MediaMetadataModel');
  const fs = await import('fs');

  const settings = settingsService.loadSettings();
  const useRecycleBin = settings.general.deleteProtection.enabled;

  const deletedFiles: number[] = [];
  const failedFiles: Array<{ fileId: number; error: string }> = [];
  const orphanedHashes: string[] = [];

  console.log(`🗑️ Starting bulk file deletion: ${validFileIds.length} files, RecycleBin: ${useRecycleBin}`);

  for (const fileId of validFileIds) {
    try {
      // Get file info
      const fileRecord = ImageFileModel.findById(fileId);

      if (!fileRecord) {
        failedFiles.push({ fileId, error: 'File not found' });
        continue;
      }

      const filePath = path.join(UPLOAD_BASE_PATH, fileRecord.original_file_path);
      const compositeHash = fileRecord.composite_hash;

      // Delete physical file with RecycleBin support
      if (fs.existsSync(filePath)) {
        try {
          await recycleBinDeleteFile(filePath, useRecycleBin);
          console.log(`✅ Physical file deleted: ${filePath}`);
        } catch (fsError) {
          const errorMessage = fsError instanceof Error ? fsError.message : 'File deletion failed';
          console.error(`❌ Failed to delete physical file: ${filePath}`, fsError);
          failedFiles.push({ fileId, error: errorMessage });
          continue;
        }
      } else {
        console.warn(`⚠️ Physical file not found (continuing): ${filePath}`);
      }

      // Delete from database
      const deleted = ImageFileModel.delete(fileId);

      if (deleted) {
        deletedFiles.push(fileId);
        console.log(`✅ DB record deleted: file_id ${fileId}`);

        // Check if this was the last file with this composite_hash
        if (compositeHash) {
          const remainingFiles = ImageFileModel.findActiveByHash(compositeHash);

          if (remainingFiles.length === 0) {
            // Delete orphaned metadata and thumbnail
            const metadata = MediaMetadataModel.findByHash(compositeHash);

            if (metadata) {
              // Delete thumbnail if exists
              if (metadata.thumbnail_path) {
                const thumbnailPath = path.join(UPLOAD_BASE_PATH, metadata.thumbnail_path);
                if (fs.existsSync(thumbnailPath)) {
                  try {
                    // Thumbnails are always deleted immediately (can be regenerated)
                    await recycleBinDeleteFile(thumbnailPath, false);
                    console.log(`✅ Thumbnail deleted: ${thumbnailPath}`);
                  } catch (error) {
                    console.warn(`⚠️ Failed to delete thumbnail: ${thumbnailPath}`, error);
                  }
                }
              }

              // Delete metadata record
              MediaMetadataModel.delete(compositeHash);
              orphanedHashes.push(compositeHash);
              console.log(`✅ Orphaned metadata cleaned up: ${compositeHash}`);
            }
          }
        }
      } else {
        failedFiles.push({ fileId, error: 'Failed to delete from database' });
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
    orphanedMetadataRemoved: orphanedHashes.length,
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

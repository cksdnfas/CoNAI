import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { DeletionService } from '../../services/deletionService';
import { successResponse, errorResponse } from '@comfyui-image-manager/shared';
import { QueryCacheService } from '../../services/QueryCacheService';

const router = Router();

/**
 * 이미지 삭제 (composite_hash 기반, 통합 삭제 서비스 사용)
 * DELETE /api/images/:compositeHash
 *
 * 삭제 전략:
 * - composite_hash 중복 시: image_files 테이블에서만 삭제
 * - composite_hash 단일 시: 파일 + 메타데이터 모두 삭제
 * - RecycleBin 설정에 따라 파일 보호 또는 완전 삭제
 */
router.delete('/:compositeHash', asyncHandler(async (req: Request, res: Response) => {
  const { compositeHash } = req.params;

  // 통합 삭제 서비스 호출
  await DeletionService.deleteImage(compositeHash);

  // 캐시 완전 무효화 (삭제는 모든 페이지에 영향)
  QueryCacheService.invalidateImageCache(compositeHash, true);
  console.log('🗑️ All caches invalidated for deleted image');

  res.json(successResponse({ message: 'Image deleted successfully' }));
}));

/**
 * 개별 파일 일괄 삭제 (file_id 기반)
 * DELETE /api/images/files/bulk
 *
 * Body: { fileIds: number[] }
 *
 * 중복 파일 개별 삭제 지원:
 * - 각 file_id의 물리 파일을 RecycleBin으로 이동
 * - 마지막 파일이면 메타데이터도 정리
 */
router.delete('/files/bulk', asyncHandler(async (req: Request, res: Response) => {
  const { fileIds } = req.body as { fileIds: number[] };

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json(errorResponse('fileIds array is required'));
  }

  console.log(`🗑️ Bulk file deletion requested: ${fileIds.length} files`);

  const results = {
    deleted: 0,
    failed: 0,
    errors: [] as string[]
  };

  // 각 file_id를 순차적으로 삭제
  for (const fileId of fileIds) {
    try {
      const success = await DeletionService.deleteImageFile(fileId);
      if (success) {
        results.deleted++;
      } else {
        results.failed++;
        results.errors.push(`File ${fileId} not found`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(`File ${fileId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`❌ Failed to delete file ${fileId}:`, error);
    }
  }

  // 캐시 완전 무효화
  QueryCacheService.invalidateImageCache(undefined, true);
  console.log('🗑️ All caches invalidated after bulk deletion');

  return res.json(successResponse({
    message: `Deleted ${results.deleted} file(s)`,
    details: results
  }));
}));

export { router as managementRoutes };

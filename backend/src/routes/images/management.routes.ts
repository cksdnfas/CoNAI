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

  // 캐시 무효화
  QueryCacheService.invalidateImageCache(compositeHash);
  console.log('🗑️ Cache invalidated for deleted image');

  res.json(successResponse({ message: 'Image deleted successfully' }));
}));

export { router as managementRoutes };

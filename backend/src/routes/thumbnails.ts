import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ThumbnailRegenerationService } from '../services/thumbnailRegenerationService';

const router = Router();

/**
 * POST /api/thumbnails/regenerate
 * 모든 썸네일 재생성
 */
router.post(
  '/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    // 이미 실행 중인지 확인
    if (ThumbnailRegenerationService.isRegenerationRunning()) {
      res.status(409).json({
        success: false,
        error: '썸네일 재생성이 이미 실행 중입니다',
      });
      return;
    }

    // 백그라운드에서 실행
    ThumbnailRegenerationService.regenerateAllThumbnails()
      .then((result) => {
        console.log('✅ 썸네일 재생성 완료:', result);
      })
      .catch((error) => {
        console.error('❌ 썸네일 재생성 실패:', error);
      });

    res.json({
      success: true,
      message: '썸네일 재생성이 시작되었습니다',
    });
    return;
  })
);

/**
 * GET /api/thumbnails/progress
 * 썸네일 재생성 진행 상황 조회
 */
router.get(
  '/progress',
  asyncHandler(async (req: Request, res: Response) => {
    const progress = ThumbnailRegenerationService.getProgress();
    const isRunning = ThumbnailRegenerationService.isRegenerationRunning();

    res.json({
      success: true,
      data: {
        ...progress,
        isRunning,
      },
    });
    return;
  })
);

/**
 * GET /api/thumbnails/stats
 * 썸네일 통계 조회
 */
router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const { db } = await import('../database/init');

    // 전체 파일 수
    const totalFilesResult = db
      .prepare(`
        SELECT COUNT(DISTINCT composite_hash) as count
        FROM image_files
        WHERE composite_hash IS NOT NULL
        AND file_status = 'active'
      `)
      .get() as { count: number };

    // 썸네일이 있는 파일 수
    const withThumbnailsResult = db
      .prepare(`
        SELECT COUNT(*) as count
        FROM media_metadata
        WHERE thumbnail_path IS NOT NULL
      `)
      .get() as { count: number };

    // 썸네일이 없는 파일 수
    const withoutThumbnails = totalFilesResult.count - withThumbnailsResult.count;

    res.json({
      success: true,
      data: {
        totalFiles: totalFilesResult.count,
        withThumbnails: withThumbnailsResult.count,
        withoutThumbnails: withoutThumbnails > 0 ? withoutThumbnails : 0,
      },
    });
    return;
  })
);

export const thumbnailRoutes = router;

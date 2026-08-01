import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { RuntimeJobRunner } from '../services/runtimeJobs/runtimeJobRunner';
import { RuntimeJobConflictError, RuntimeJobStore } from '../services/runtimeJobs/runtimeJobStore';
import type { RuntimeJobRecord } from '../types/runtimeJob';

const router = Router();

/**
 * POST /api/thumbnails/regenerate
 * 모든 썸네일 재생성 — 202 + 잡 레코드
 *
 * 이관 전에는 promise 를 버리고 200 을 돌려줘 실패조차 클라이언트에 도달하지 않았고,
 * 중복 실행 차단도 라우트의 플래그 조회와 서비스의 플래그 세팅 사이에 TOCTOU 창이 있었다.
 * 지금은 `runtime_jobs` 의 부분 유니크 인덱스가 그 창을 닫는다.
 */
router.post(
  '/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const job = RuntimeJobRunner.start('thumbnail-regenerate', {}, {
        requestedByAccountId: typeof req.session?.accountId === 'number' ? req.session.accountId : null,
      });

      res.status(202).json({ success: true, data: job });
      return;
    } catch (error) {
      if (error instanceof RuntimeJobConflictError) {
        res.status(409).json({
          success: false,
          error: '썸네일 재생성이 이미 실행 중입니다',
          code: 'JOB_ALREADY_RUNNING',
          data: error.liveJob,
        });
        return;
      }

      throw error;
    }
  })
);

/**
 * GET /api/thumbnails/progress
 * 썸네일 재생성 진행 상황 조회
 *
 * 정본 계약은 `GET /api/jobs/:jobId` 다. 이 라우트는 최신 잡을 레거시 진행률 형태로 어댑트해
 * 남긴다(기존 응답 필드가 그대로 유지되므로 외부 호출자가 깨지지 않는다).
 */
router.get(
  '/progress',
  asyncHandler(async (req: Request, res: Response) => {
    const latestJob = RuntimeJobStore.findLatestByKind('thumbnail-regenerate');

    res.json({
      success: true,
      data: adaptThumbnailJobToLegacyProgress(latestJob),
    });
    return;
  })
);

/** Map one runtime job record onto the legacy thumbnail progress payload. */
function adaptThumbnailJobToLegacyProgress(job: RuntimeJobRecord | null) {
  if (!job) {
    return {
      totalFiles: 0,
      processedFiles: 0,
      deletedThumbnails: 0,
      generatedThumbnails: 0,
      currentPhase: 'idle' as const,
      startTime: 0,
      isRunning: false,
      jobId: null,
    };
  }

  const isRunning = job.status === 'queued' || job.status === 'running';
  // 삭제 카운터는 잡 진행률 모델에 슬롯이 없으므로 완료 결과에서만 복원된다.
  const completedResult = job.result as { thumbnailsDeleted?: number } | null;

  return {
    totalFiles: job.progress.total,
    processedFiles: job.progress.processed,
    deletedThumbnails: completedResult?.thumbnailsDeleted ?? 0,
    generatedThumbnails: job.progress.succeeded,
    currentPhase: (job.phase ?? (isRunning ? 'verification' : 'completed')) as string,
    startTime: job.startedAt ? Date.parse(job.startedAt) || 0 : 0,
    isRunning,
    jobId: job.jobId,
  };
}

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

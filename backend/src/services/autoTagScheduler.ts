import { db } from '../database/init';
import { taggerDaemon } from './taggerDaemon';
import { settingsService } from './settingsService';
import { imageTaggerService, ImageTaggerService } from './imageTaggerService';
import { SystemSettingsService } from './systemSettingsService';
import { RatingScoreService } from './ratingScoreService';
import { PromptCollectionService } from './promptCollectionService';
import path from 'path';

/**
 * 자동 태깅 스케줄러
 * - media_metadata 테이블에서 auto_tags가 NULL인 항목 검색
 * - 발견된 이미지들을 순차적으로 태깅 처리
 * - 주기적으로 반복 실행
 */
export class AutoTagScheduler {
  private isRunning = false; // Overall scheduler status
  private isProcessing = false; // Flag to prevent concurrent processing
  private pollingTimer: NodeJS.Timeout | null = null;
  private readonly PROCESSING_DELAY_MS = 1000; // 이미지 간 처리 간격 (1초)

  /**
   * 폴링 간격 조회 (밀리초) - 1초 고정
   */
  private getPollingIntervalMs(): number {
    return 1000;
  }

  /**
   * 배치 크기 조회
   */
  private getBatchSize(): number {
    return SystemSettingsService.getAutoTagBatchSize();
  }

  /**
   * 스케줄러 시작
   */
  start(): void {
    if (this.isRunning) {
      console.log('[AutoTagScheduler] Already running');
      return;
    }

    const settings = settingsService.loadSettings();
    if (!settings.tagger.enabled) {
      console.log('[AutoTagScheduler] Auto-tagging is disabled in settings');
      return;
    }

    const pollingIntervalMs = this.getPollingIntervalMs();
    const batchSize = this.getBatchSize();

    console.log('[AutoTagScheduler] Starting auto-tag scheduler...');
    console.log(`[AutoTagScheduler] Polling interval: ${pollingIntervalMs / 1000}s`);
    // console.log(`[AutoTagScheduler] Batch size: ${batchSize}`); // Removed this log

    this.isRunning = true;

    // 즉시 한 번 실행
    this.processUntaggedImages();

    // 주기적 실행 시작 (기존 타이머 제거 후 새로 설정)
    if (this.pollingTimer) clearInterval(this.pollingTimer);

    this.pollingTimer = setInterval(() => {
      this.processUntaggedImages();
    }, pollingIntervalMs);
  }

  /**
   * 스케줄러 중지
   */
  stop(): void {
    console.log('[AutoTagScheduler] Stopping auto-tag scheduler...');

    this.isRunning = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    // processingTimer 제거됨

    console.log('[AutoTagScheduler] Stopped');
  }

  /**
   * 태깅되지 않은 이미지 처리
   */
  private async processUntaggedImages(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    // 설정 재확인 (실행 중 설정 변경 가능)
    const settings = settingsService.loadSettings();
    if (!settings.tagger.enabled) {
      return;
    }

    this.isProcessing = true;

    try {
      // 배치 크기만큼 반복 처리 (한 번에 다 가져오지 않고, 하나씩 처리하거나 배치로 가져와서 순차 처리)
      // 여기서는 배치로 가져와서 처리
      const batchSize = this.getBatchSize();

      // 태깅되지 않은 이미지/비디오 조회 (image_files에서 active한 파일 경로 가져오기)
      // file_type은 태깅 방식 결정
      const untaggedImages = db.prepare(`
        SELECT
          mm.composite_hash,
          if_.original_file_path,
          if_.file_type as media_type
        FROM media_metadata mm
        LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash
        WHERE mm.auto_tags IS NULL
          AND if_.original_file_path IS NOT NULL
          AND if_.file_status = 'active'
        LIMIT ?
      `).all(batchSize) as Array<{ composite_hash: string; original_file_path: string; media_type: string }>;

      // 총 미태깅 개수도 확인 (Removed this part)
      // const totalUntagged = db.prepare(`
      //   SELECT COUNT(*) as count
      //   FROM media_metadata mm
      //   LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash
      //   WHERE mm.auto_tags IS NULL
      //     AND if_.original_file_path IS NOT NULL
      //     AND if_.file_status = 'active'
      // `).get() as { count: number };

      if (untaggedImages.length === 0) {
        // 처리할 항목 없음 (조용히 대기)
        return;
      }

      // 로그 레벨 조정: 매번 발견했다는 로그는 불필요할 수 있음. 정말 필요하면 debug 레벨로.
      // console.log(`[AutoTagScheduler] Found ${untaggedImages.length} untagged images (total: ${totalUntagged.count})`);

      // 순차적으로 처리
      for (let i = 0; i < untaggedImages.length; i++) {
        // 중간에 중지 요청이 들어오면 중단
        if (!this.isRunning) break;

        const image = untaggedImages[i];

        try {
          await this.tagSingleImage(image.composite_hash, image.original_file_path, image.media_type);

          // 마지막 이미지가 아니면 대기
          if (i < untaggedImages.length - 1) {
            await this.delay(this.PROCESSING_DELAY_MS);
          }
        } catch (error) {
          console.error(
            `[AutoTagScheduler] Failed to tag image: ${path.basename(image.original_file_path)}`,
            error instanceof Error ? error.message : error
          );
          // 에러가 발생해도 다음 이미지 계속 처리
        }
      }

      console.log(`[AutoTagScheduler] Batch processing completed (${untaggedImages.length} images)`);

      // 재귀 호출 제거 -> setInterval에 의존
      // this.processingTimer = setTimeout(() => {
      //   this.processUntaggedImages();
      // }, 2000); // 2초 후 재확인

    } catch (error) {
      console.error('[AutoTagScheduler] Error in processUntaggedImages:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 단일 이미지/비디오 태깅
   */
  private async tagSingleImage(
    compositeHash: string,
    filePath: string,
    mediaType: string
  ): Promise<void> {
    console.log(`[AutoTagScheduler] Tagging (${mediaType}): ${path.basename(filePath)}`);

    // file_type='video'만 비디오 태깅 사용, 'image'와 'animated'는 이미지 태깅 사용
    const isVideo = mediaType === 'video';

    // 이미지 또는 비디오 태깅 실행
    const result = isVideo
      ? await imageTaggerService.tagVideo(filePath)
      : await taggerDaemon.tagImage(filePath);

    if (!result.success) {
      throw new Error(result.error || 'Unknown tagging error');
    }

    // 태깅 결과를 JSON으로 직렬화
    const autoTags = JSON.stringify({
      caption: result.caption,
      taglist: result.taglist,
      rating: result.rating,
      general: result.general,
      character: result.character,
      model: result.model,
      thresholds: result.thresholds
    });

    // Calculate rating_score if rating data is available
    let ratingScore = 0;
    if (result.rating) {
      try {
        const scoreResult = await RatingScoreService.calculateScore(result.rating as any);
        ratingScore = scoreResult.score;
      } catch (error) {
        console.error('[AutoTagScheduler] Failed to calculate rating_score:', error);
      }
    }

    // media_metadata 테이블 업데이트
    db.prepare(`
      UPDATE media_metadata
      SET auto_tags = ?, rating_score = ?
      WHERE composite_hash = ?
    `).run(autoTags, ratingScore, compositeHash);

    // Auto Prompt 수집
    if (result.taglist) {
      try {
        const tags = result.taglist.split(',').map(t => t.trim()).filter(t => t.length > 0);
        if (tags.length > 0) {
          const autoPrompts = tags.map(tag => ({ prompt: tag }));
          await PromptCollectionService.batchAddOrIncrementAuto(autoPrompts);
        }
      } catch (error) {
        console.error('[AutoTagScheduler] Failed to collect auto prompts:', error);
      }
    }

    // 성공 로그는 남김 (사용자가 진행상황을 알 수 있도록)
    // console.log(`[AutoTagScheduler] ✅ Tagged (${mediaType}): ${path.basename(filePath)}`);
  }

  /**
   * 대기 헬퍼
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 현재 상태 조회
   */
  getStatus(): {
    isRunning: boolean;
    pollingIntervalSeconds: number;
    batchSize: number;
    untaggedCount: number;
  } {
    let untaggedCount = 0;

    try {
      const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM media_metadata mm
        LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash
        WHERE mm.auto_tags IS NULL
          AND if_.original_file_path IS NOT NULL
          AND if_.file_status = 'active'
      `).get() as { count: number };

      untaggedCount = result.count;
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to get untagged count:', error);
    }

    return {
      isRunning: this.isRunning,
      pollingIntervalSeconds: this.getPollingIntervalMs() / 1000,
      batchSize: this.getBatchSize(),
      untaggedCount
    };
  }

  /**
   * 스케줄러 재시작 (설정 변경 시)
   */
  restart(): void {
    if (this.isRunning) {
      this.stop();
    }
    // 약간의 지연 후 재시작 (또는 시작)
    setTimeout(() => this.start(), 100);
  }

  /**
   * 수동으로 미태깅 이미지 처리 트리거
   */
  async triggerManualProcessing(): Promise<void> {
    console.log('[AutoTagScheduler] Manual processing triggered');
    await this.processUntaggedImages();
  }
}

// Export singleton instance
export const autoTagScheduler = new AutoTagScheduler();

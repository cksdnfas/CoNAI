import { db } from '../database/init';
import { taggerDaemon } from './taggerDaemon';
import { settingsService } from './settingsService';
import { imageTaggerService, ImageTaggerService } from './imageTaggerService';
import path from 'path';

/**
 * 자동 태깅 스케줄러
 * - image_metadata 테이블에서 auto_tags가 NULL인 항목 검색
 * - 발견된 이미지들을 순차적으로 태깅 처리
 * - 주기적으로 반복 실행
 */
export class AutoTagScheduler {
  private isRunning = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  private processingTimer: NodeJS.Timeout | null = null;
  private readonly POLLING_INTERVAL_MS = 30000; // 30초마다 확인
  private readonly BATCH_SIZE = 10; // 한 번에 처리할 최대 이미지 수
  private readonly PROCESSING_DELAY_MS = 1000; // 이미지 간 처리 간격 (1초)

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

    console.log('[AutoTagScheduler] Starting auto-tag scheduler...');
    console.log(`[AutoTagScheduler] Polling interval: ${this.POLLING_INTERVAL_MS / 1000}s`);
    console.log(`[AutoTagScheduler] Batch size: ${this.BATCH_SIZE}`);

    this.isRunning = true;

    // 즉시 한 번 실행
    this.processUntaggedImages();

    // 주기적 실행 시작
    this.pollingTimer = setInterval(() => {
      this.processUntaggedImages();
    }, this.POLLING_INTERVAL_MS);
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

    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }

    console.log('[AutoTagScheduler] Stopped');
  }

  /**
   * 태깅되지 않은 이미지 처리
   */
  private async processUntaggedImages(): Promise<void> {
    // 설정 재확인 (실행 중 설정 변경 가능)
    const settings = settingsService.loadSettings();
    if (!settings.tagger.enabled) {
      // 설정 꺼짐 (로그 줄임)
      return;
    }

    try {
      // 태깅되지 않은 이미지/비디오 조회 (image_files에서 active한 파일 경로 가져오기)
      // file_type은 태깅 방식 결정, metadata_table은 업데이트할 테이블 결정
      const untaggedImages = db.prepare(`
        SELECT
          im.composite_hash,
          if_.original_file_path,
          if_.file_type as media_type,
          'image' as metadata_table
        FROM image_metadata im
        LEFT JOIN image_files if_ ON im.composite_hash = if_.composite_hash
        WHERE im.auto_tags IS NULL
          AND if_.original_file_path IS NOT NULL
          AND if_.file_status = 'active'
        UNION
        SELECT
          vm.composite_hash,
          if_.original_file_path,
          if_.file_type as media_type,
          'video' as metadata_table
        FROM video_metadata vm
        LEFT JOIN image_files if_ ON vm.composite_hash = if_.composite_hash
        WHERE vm.auto_tags IS NULL
          AND if_.original_file_path IS NOT NULL
          AND if_.file_status = 'active'
        LIMIT ?
      `).all(this.BATCH_SIZE) as Array<{ composite_hash: string; original_file_path: string; media_type: string; metadata_table: 'image' | 'video' }>;

      // 총 미태깅 개수도 확인
      const totalUntagged = db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT im.composite_hash
          FROM image_metadata im
          LEFT JOIN image_files if_ ON im.composite_hash = if_.composite_hash
          WHERE im.auto_tags IS NULL
            AND if_.original_file_path IS NOT NULL
            AND if_.file_status = 'active'
          UNION
          SELECT vm.composite_hash
          FROM video_metadata vm
          LEFT JOIN image_files if_ ON vm.composite_hash = if_.composite_hash
          WHERE vm.auto_tags IS NULL
            AND if_.original_file_path IS NOT NULL
            AND if_.file_status = 'active'
        )
      `).get() as { count: number };

      if (untaggedImages.length === 0) {
        // 처리할 항목 없음 (조용히 대기)
        return;
      }

      console.log(`[AutoTagScheduler] Found ${untaggedImages.length} untagged images (total: ${totalUntagged.count})`);

      // 순차적으로 처리
      for (let i = 0; i < untaggedImages.length; i++) {
        const image = untaggedImages[i];

        try {
          await this.tagSingleImage(image.composite_hash, image.original_file_path, image.media_type, image.metadata_table);

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

      // 처리 완료 후 즉시 다시 확인 (남은 항목이 있을 수 있음)
      this.processingTimer = setTimeout(() => {
        this.processUntaggedImages();
      }, 2000); // 2초 후 재확인

    } catch (error) {
      console.error('[AutoTagScheduler] Error in processUntaggedImages:', error);
    }
  }

  /**
   * 단일 이미지/비디오 태깅
   */
  private async tagSingleImage(
    compositeHash: string,
    filePath: string,
    mediaType: string,
    metadataTable: 'image' | 'video'
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

    // metadata_table에 따라 적절한 테이블 업데이트
    // image_metadata 또는 video_metadata (file_type과 무관)
    if (metadataTable === 'image') {
      db.prepare(`
        UPDATE image_metadata
        SET auto_tags = ?
        WHERE composite_hash = ?
      `).run(autoTags, compositeHash);
    } else {
      db.prepare(`
        UPDATE video_metadata
        SET auto_tags = ?
        WHERE composite_hash = ?
      `).run(autoTags, compositeHash);
    }

    console.log(`[AutoTagScheduler] ✅ Tagged (${mediaType}): ${path.basename(filePath)}`);
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
        FROM image_metadata im
        LEFT JOIN image_files if_ ON im.composite_hash = if_.composite_hash
        WHERE im.auto_tags IS NULL
          AND if_.original_file_path IS NOT NULL
          AND if_.file_status = 'active'
      `).get() as { count: number };

      untaggedCount = result.count;
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to get untagged count:', error);
    }

    return {
      isRunning: this.isRunning,
      pollingIntervalSeconds: this.POLLING_INTERVAL_MS / 1000,
      batchSize: this.BATCH_SIZE,
      untaggedCount
    };
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

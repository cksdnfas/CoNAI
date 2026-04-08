import path from 'path';
import { db } from '../database/init';
import { taggerDaemon } from './taggerDaemon';
import { settingsService } from './settingsService';
import { imageTaggerService } from './imageTaggerService';
import { SystemSettingsService } from './systemSettingsService';
import { RatingScoreService } from './ratingScoreService';
import { PromptCollectionService } from './promptCollectionService';
import { AutoTagsComposeService } from './autoTagsComposeService';
import { kaloscopeTaggerService } from './kaloscopeTaggerService';
import { RatingData } from '../types/autoTag';

interface PendingAutoTagMedia {
  composite_hash: string;
  auto_tags: string | null;
  original_file_path: string;
  media_type: string;
}

interface AutoTagCapabilities {
  taggerAutoEnabled: boolean;
  kaloscopeAutoEnabled: boolean;
}

/**
 * 자동 태깅 스케줄러
 * - media_metadata 테이블에서 auto_tags가 NULL이거나 일부 결과가 비어있는 항목 검색
 * - 발견된 이미지들을 순차적으로 태깅 처리
 * - 주기적으로 반복 실행
 */
export class AutoTagScheduler {
  private isRunning = false;
  private isProcessing = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  private readonly PROCESSING_DELAY_MS = 1000;

  private getPollingIntervalMs(): number {
    return SystemSettingsService.getAutoTagPollingInterval() * 1000;
  }

  private getBatchSize(): number {
    return SystemSettingsService.getAutoTagBatchSize();
  }

  private getCapabilities(): AutoTagCapabilities {
    const settings = settingsService.loadSettings();
    return {
      taggerAutoEnabled: settings.tagger.enabled,
      kaloscopeAutoEnabled: settings.kaloscope.enabled && settings.kaloscope.autoTagOnUpload,
    };
  }

  private hasEnabledProcessor(capabilities: AutoTagCapabilities): boolean {
    return capabilities.taggerAutoEnabled || capabilities.kaloscopeAutoEnabled;
  }

  start(): boolean {
    if (this.isRunning) {
      return true;
    }

    const capabilities = this.getCapabilities();
    if (!this.hasEnabledProcessor(capabilities)) {
      return false;
    }

    const pollingIntervalMs = this.getPollingIntervalMs();
    const batchSize = this.getBatchSize();

    console.log(`[AutoTagScheduler] Ready (${pollingIntervalMs / 1000}s interval, batch ${batchSize})`);

    this.isRunning = true;
    void this.processPendingMedia();

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }

    this.pollingTimer = setInterval(() => {
      void this.processPendingMedia();
    }, pollingIntervalMs);

    return true;
  }

  stop(): void {
    this.isRunning = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private extractRatingData(raw: unknown): RatingData | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const rating = raw as Record<string, unknown>;
    const general = rating.general;
    const sensitive = rating.sensitive;
    const questionable = rating.questionable;
    const explicit = rating.explicit;

    if (
      typeof general !== 'number' ||
      typeof sensitive !== 'number' ||
      typeof questionable !== 'number' ||
      typeof explicit !== 'number'
    ) {
      return null;
    }

    return { general, sensitive, questionable, explicit };
  }

  private getPendingMedia(capabilities: AutoTagCapabilities, batchSize: number): PendingAutoTagMedia[] {
    return db.prepare(`
      SELECT
        mm.composite_hash,
        mm.auto_tags,
        if_.original_file_path,
        if_.file_type as media_type
      FROM media_metadata mm
      LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash
      WHERE (
        mm.auto_tags IS NULL
        OR (? = 1 AND json_extract(mm.auto_tags, '$.tagger') IS NULL)
        OR (? = 1 AND json_extract(mm.auto_tags, '$.kaloscope') IS NULL)
      )
        AND if_.original_file_path IS NOT NULL
        AND if_.file_status = 'active'
      LIMIT ?
    `).all(capabilities.taggerAutoEnabled ? 1 : 0, capabilities.kaloscopeAutoEnabled ? 1 : 0, batchSize) as PendingAutoTagMedia[];
  }

  private countPendingMedia(capabilities: AutoTagCapabilities): number {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM media_metadata mm
      LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash
      WHERE (
        mm.auto_tags IS NULL
        OR (? = 1 AND json_extract(mm.auto_tags, '$.tagger') IS NULL)
        OR (? = 1 AND json_extract(mm.auto_tags, '$.kaloscope') IS NULL)
      )
        AND if_.original_file_path IS NOT NULL
        AND if_.file_status = 'active'
    `).get(capabilities.taggerAutoEnabled ? 1 : 0, capabilities.kaloscopeAutoEnabled ? 1 : 0) as { count: number };

    return result.count;
  }

  private async processPendingMedia(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    const capabilities = this.getCapabilities();
    if (!this.hasEnabledProcessor(capabilities)) {
      return;
    }

    this.isProcessing = true;

    try {
      const pendingMedia = this.getPendingMedia(capabilities, this.getBatchSize());
      if (pendingMedia.length === 0) {
        return;
      }

      for (let index = 0; index < pendingMedia.length; index += 1) {
        if (!this.isRunning) {
          break;
        }

        const media = pendingMedia[index];

        try {
          await this.tagSingleMedia(media, capabilities);

          if (index < pendingMedia.length - 1) {
            await this.delay(this.PROCESSING_DELAY_MS);
          }
        } catch (error) {
          console.error(
            `[AutoTagScheduler] Failed to tag media: ${path.basename(media.original_file_path)}`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      console.log(`[AutoTagScheduler] Batch processing completed (${pendingMedia.length} items)`);
    } catch (error) {
      console.error('[AutoTagScheduler] Error in processPendingMedia:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async tagSingleMedia(media: PendingAutoTagMedia, capabilities: AutoTagCapabilities): Promise<void> {
    const { composite_hash: compositeHash, original_file_path: filePath, media_type: mediaType, auto_tags: existingAutoTags } = media;
    const isVideo = mediaType === 'video';

    console.log(`[AutoTagScheduler] Tagging (${mediaType}): ${path.basename(filePath)}`);

    const needsTagger = capabilities.taggerAutoEnabled && !AutoTagsComposeService.hasTagger(existingAutoTags);
    const needsKaloscope = capabilities.kaloscopeAutoEnabled && !AutoTagsComposeService.hasKaloscope(existingAutoTags);

    if (!needsTagger && !needsKaloscope) {
      return;
    }

    let autoTags = existingAutoTags;
    let taggerTaglist = '';
    let ratingData: RatingData | null = null;

    if (needsTagger) {
      const taggerResult = isVideo
        ? await imageTaggerService.tagVideo(filePath)
        : await taggerDaemon.tagImage(filePath);

      if (!taggerResult.success) {
        throw new Error(taggerResult.error || 'Unknown tagging error');
      }

      autoTags = AutoTagsComposeService.mergeTagger(autoTags, taggerResult);
      taggerTaglist = taggerResult.taglist || '';
      ratingData = this.extractRatingData(taggerResult.rating);
    }

    if (needsKaloscope) {
      const kaloscopeResult = isVideo
        ? await kaloscopeTaggerService.tagVideo(filePath)
        : await kaloscopeTaggerService.tagImage(filePath);

      if (kaloscopeResult.success) {
        autoTags = AutoTagsComposeService.mergeKaloscope(autoTags, kaloscopeResult);
      } else {
        console.warn('[AutoTagScheduler] Kaloscope tagging failed:', kaloscopeResult.error || kaloscopeResult.error_type || 'unknown');
      }
    }

    if (!autoTags) {
      return;
    }

    const ratingScore = await this.calculateRatingScore(ratingData);
    this.persistAutoTags(compositeHash, autoTags, ratingScore);
    await this.collectAutoPrompts(taggerTaglist);
  }

  private async calculateRatingScore(ratingData: RatingData | null): Promise<number> {
    if (!ratingData) {
      return 0;
    }

    try {
      const scoreResult = await RatingScoreService.calculateScore(ratingData);
      return scoreResult.score;
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to calculate rating_score:', error);
      return 0;
    }
  }

  private persistAutoTags(compositeHash: string, autoTags: string, ratingScore: number): void {
    db.prepare(`
      UPDATE media_metadata
      SET auto_tags = ?, rating_score = ?
      WHERE composite_hash = ?
    `).run(autoTags, ratingScore, compositeHash);
  }

  private async collectAutoPrompts(taggerTaglist: string): Promise<void> {
    if (!taggerTaglist) {
      return;
    }

    try {
      const tags = taggerTaglist
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      if (tags.length === 0) {
        return;
      }

      await PromptCollectionService.batchAddOrIncrementAuto(tags.map((tag) => ({ prompt: tag })));
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to collect auto prompts:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStatus(): {
    isRunning: boolean;
    pollingIntervalSeconds: number;
    batchSize: number;
    untaggedCount: number;
  } {
    let untaggedCount = 0;

    try {
      untaggedCount = this.countPendingMedia(this.getCapabilities());
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to get untagged count:', error);
    }

    return {
      isRunning: this.isRunning,
      pollingIntervalSeconds: this.getPollingIntervalMs() / 1000,
      batchSize: this.getBatchSize(),
      untaggedCount,
    };
  }

  restart(): void {
    if (this.isRunning) {
      this.stop();
    }

    setTimeout(() => this.start(), 100);
  }

  async triggerManualProcessing(): Promise<void> {
    console.log('[AutoTagScheduler] Manual processing triggered');
    await this.processPendingMedia();
  }
}

export const autoTagScheduler = new AutoTagScheduler();

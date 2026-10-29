import { db } from '../database/init';
import { logger } from '../utils/logger';
import { MetadataExtractor } from './metadata';
import { settingsService } from './settingsService';
import path from 'path';
import { QueryCacheService } from './QueryCacheService';
import { PromptCollectionService } from './promptCollectionService';
import { AutoCollectionService } from './autoCollectionService';
import { MetadataExtractionError } from '../types/errors';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { MediaPostprocessVisibilityService } from './mediaPostprocessVisibilityService';
import type { AIMetadata } from './metadata/types';
import { SystemMaintenanceLockService } from './systemMaintenanceLockService';

function resolveBackgroundQueueBatchSize(): number {
  const configured = Number.parseInt(process.env.CONAI_BACKGROUND_QUEUE_BATCH_SIZE ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, 8);
  }

  // Metadata extraction can involve Sharp and DB writes. Keep a small default so
  // background work does not monopolize the process while users browse media.
  return 2;
}

function serializeMetadataArray<T>(value: T[] | undefined): string | null {
  return Array.isArray(value) && value.length > 0 ? JSON.stringify(value) : null;
}

function metadataPersistenceFields(aiInfo: AIMetadata) {
  const prompt = aiInfo.prompt || aiInfo.positive_prompt || null;
  const negativePrompt = aiInfo.negative_prompt || aiInfo.uc || null;
  const modelReferences = aiInfo.model_references ?? [];

  return {
    prompt,
    hasCollectablePrompt: Boolean(prompt || aiInfo.character_prompt_text),
    modelReferences,
    updates: {
      ai_tool: aiInfo.ai_tool || null,
      model_name: aiInfo.model || aiInfo.model_name || null,
      lora_models: serializeMetadataArray(aiInfo.lora_models),
      steps: aiInfo.steps ?? null,
      cfg_scale: aiInfo.cfg_scale ?? aiInfo.scale ?? null,
      sampler: aiInfo.sampler || null,
      seed: aiInfo.seed ?? null,
      scheduler: aiInfo.scheduler || null,
      prompt,
      negative_prompt: negativePrompt,
      denoise_strength: aiInfo.denoise_strength ?? aiInfo.denoising_strength ?? null,
      generation_time: aiInfo.generation_time ?? null,
      batch_size: aiInfo.batch_size ?? null,
      batch_index: aiInfo.batch_index ?? null,
      model_references: serializeMetadataArray(modelReferences),
      character_prompt_text: aiInfo.character_prompt_text || null,
      raw_nai_parameters: aiInfo.raw_nai_parameters || null,
    },
  };
}

/**
 * 백그라운드 작업 타입
 */
export enum TaskType {
  METADATA_EXTRACTION = 'metadata_extraction',
  PROMPT_COLLECTION = 'prompt_collection'
}

/**
 * 백그라운드 작업 인터페이스
 */
export interface BackgroundTask {
  id: string;
  type: TaskType;
  filePath: string;
  compositeHash: string;
  priority: number;
  retries: number;
  maxRetries: number;
  createdAt: Date;
  completion?: { promise: Promise<boolean>; resolve: (success: boolean) => void };
}

interface TaskBucket {
  tasks: Array<BackgroundTask | undefined>;
  head: number;
}

/**
 * 백그라운드 작업 큐 서비스
 * - 메타데이터 추출, 프롬프트 수집 등의 비동기 작업 처리
 * - 실패 시 재시도 메커니즘
 * - 스캔 성공에 영향을 주지 않음
 *
 * 참고: 자동 태깅은 AutoTagScheduler로 분리되어 처리됨
 */
export class BackgroundQueueService {
  private static recoveryTimer: ReturnType<typeof setInterval> | undefined;
  private static readonly metadataQueue: TaskBucket = { tasks: [], head: 0 };
  private static readonly promptQueue: TaskBucket = { tasks: [], head: 0 };
  private static queueLength = 0;
  private static activeTasks: BackgroundTask[] = [];
  private static readonly metadataTasks = new Map<string, BackgroundTask>();
  private static readonly queueChangeListeners = new Set<() => void>();
  private static processing = false;
  private static processScheduled = false;
  private static lockRetryScheduled = false;
  private static readonly MAX_RETRIES = 3;
  private static readonly BATCH_SIZE = resolveBackgroundQueueBatchSize(); // 동시 처리 작업 수

  /** Pending metadata survives a restart; failed extraction stays private instead of becoming public. */
  static startMetadataRecovery(): void {
    if (this.recoveryTimer) return;
    const recover = () => {
      try {
        const rows = db.prepare(`SELECT mm.composite_hash, (
          SELECT original_file_path FROM image_files f WHERE f.composite_hash = mm.composite_hash
            AND f.file_status = 'active' LIMIT 1
        ) AS file_path FROM media_metadata mm
          WHERE metadata_extraction_status = 'pending' AND EXISTS (
            SELECT 1 FROM image_files f WHERE f.composite_hash = mm.composite_hash AND f.file_status = 'active'
          ) LIMIT 50`).all() as Array<{ composite_hash: string; file_path: string | null }>;
        for (const row of rows) {
          if (row.file_path) this.addMetadataExtractionTask(row.file_path, row.composite_hash);
        }
      } catch (error) {
        logger.warn('Pending metadata recovery failed', error);
      }
    };
    this.recoveryTimer = setInterval(recover, 30_000);
    this.recoveryTimer.unref();
    recover();
  }

  private static getMetadataExtractionTaskKey(filePath: string, compositeHash: string): string {
    return `${compositeHash}\u0000${path.resolve(filePath)}`;
  }

  private static enqueue(task: BackgroundTask): void {
    const bucket = task.priority === 1 ? this.metadataQueue : this.promptQueue;
    bucket.tasks.push(task);
    this.queueLength++;
  }

  private static takeBatch(): BackgroundTask[] {
    const batch: BackgroundTask[] = [];
    for (const bucket of [this.metadataQueue, this.promptQueue]) {
      while (batch.length < this.BATCH_SIZE && bucket.head < bucket.tasks.length) {
        batch.push(bucket.tasks[bucket.head]!);
        bucket.tasks[bucket.head++] = undefined;
        this.queueLength--;
      }
      if (bucket.head >= 1024 && bucket.head * 2 >= bucket.tasks.length) {
        bucket.tasks = bucket.tasks.slice(bucket.head);
        bucket.head = 0;
      }
    }
    return batch;
  }

  /**
   * 메타데이터 추출 작업 추가
   */
  static addMetadataExtractionTask(filePath: string, compositeHash: string): void {
    this.getOrAddMetadataExtractionTask(filePath, compositeHash);
  }

  /** Share the existing queued or active extraction and observe its final outcome, including retries. */
  static trackMetadataExtractionTask(filePath: string, compositeHash: string): Promise<boolean> {
    const task = this.getOrAddMetadataExtractionTask(filePath, compositeHash);
    if (!task.completion) {
      let resolve!: (success: boolean) => void;
      const promise = new Promise<boolean>((done) => { resolve = done; });
      task.completion = { promise, resolve };
    }
    return task.completion.promise;
  }

  /** Notify a backpressured producer when queued or active work settles. */
  static onQueueChange(listener: () => void): () => void {
    this.queueChangeListeners.add(listener);
    return () => { this.queueChangeListeners.delete(listener); };
  }

  private static getOrAddMetadataExtractionTask(filePath: string, compositeHash: string): BackgroundTask {
    const resolvedFilePath = path.resolve(filePath);
    const key = this.getMetadataExtractionTaskKey(resolvedFilePath, compositeHash);
    const existing = this.metadataTasks.get(key);
    if (existing) {
      logger.debug(`  ⏭️  백그라운드 메타데이터 작업 이미 대기 중: ${path.basename(resolvedFilePath)}`);
      return existing;
    }

    const task: BackgroundTask = {
      id: `${compositeHash}_metadata_${Date.now()}`,
      type: TaskType.METADATA_EXTRACTION,
      filePath: resolvedFilePath,
      compositeHash,
      priority: 1,
      retries: 0,
      maxRetries: this.MAX_RETRIES,
      createdAt: new Date()
    };

    this.metadataTasks.set(key, task);
    this.enqueue(task);
    logger.debug(`  📋 백그라운드 작업 추가: 메타데이터 추출 - ${path.basename(filePath)}`);

    // 큐 처리 시작
    if (!this.processing && !this.processScheduled) {
      this.processScheduled = true;
      setImmediate(() => {
        this.processScheduled = false;
        void this.processQueue();
      });
    }
    return task;
  }


  /**
   * 프롬프트 수집 작업 추가
   */
  static addPromptCollectionTask(filePath: string, compositeHash: string): void {
    const task: BackgroundTask = {
      id: `${compositeHash}_prompt_${Date.now()}`,
      type: TaskType.PROMPT_COLLECTION,
      filePath,
      compositeHash,
      priority: 3,
      retries: 0,
      maxRetries: this.MAX_RETRIES,
      createdAt: new Date()
    };

    this.enqueue(task);
    logger.debug(`  📋 백그라운드 작업 추가: 프롬프트 수집 - ${path.basename(filePath)}`);

    // 큐 처리 시작
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * 큐 처리 (배치 병렬 처리)
   */
  private static async processQueue(): Promise<void> {
    if (this.processing || this.queueLength === 0) {
      return;
    }

    if (SystemMaintenanceLockService.isExclusiveActive()) {
      this.scheduleProcessQueueAfterMaintenanceLock();
      return;
    }

    this.processing = true;
    logger.info(`\n🔄 백그라운드 큐 처리 시작: ${this.queueLength}개 작업`);

    while (this.queueLength > 0) {
      if (SystemMaintenanceLockService.isExclusiveActive()) {
        break;
      }

      // Priority buckets retain FIFO ordering without sorting the remaining queue.
      const batch = this.takeBatch();
      this.activeTasks.push(...batch);

      // 배치 병렬 처리
      const results = await Promise.allSettled(
        batch.map(task => this.processTask(task))
      );

      // 실패한 작업 재시도
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const task = batch[index];
          task.retries++;

          if (task.retries < task.maxRetries) {
            logger.warn(`  ⚠️  작업 재시도 (${task.retries}/${task.maxRetries}): ${task.id}`);
            this.enqueue(task);
            return;
          } else {
            logger.error(`  ❌ 작업 최종 실패: ${task.id}`, result.reason);
            if (task.type === TaskType.METADATA_EXTRACTION) {
              MediaPostprocessVisibilityService.finishMetadataExtraction(task.compositeHash, 'failed');
              QueryCacheService.scheduleGalleryCacheInvalidation();
            }
          }
        }
        const task = batch[index];
        if (task.type === TaskType.METADATA_EXTRACTION) {
          this.metadataTasks.delete(this.getMetadataExtractionTaskKey(task.filePath, task.compositeHash));
          task.completion?.resolve(result.status === 'fulfilled' && result.value);
        }
      });
      this.activeTasks = this.activeTasks.filter((task) => !batch.includes(task));
      this.queueChangeListeners.forEach((listener) => listener());

      // 짧은 대기 (CPU 부하 방지)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;

    if (this.queueLength > 0 && SystemMaintenanceLockService.isExclusiveActive()) {
      this.scheduleProcessQueueAfterMaintenanceLock();
      logger.info('⏸️  백그라운드 큐 처리 대기: 시스템 유지보수 잠금 활성\n');
      return;
    }

    logger.info('✅ 백그라운드 큐 처리 완료\n');
  }

  private static scheduleProcessQueueAfterMaintenanceLock(): void {
    if (this.lockRetryScheduled) {
      return;
    }

    this.lockRetryScheduled = true;
    setTimeout(() => {
      this.lockRetryScheduled = false;
      void this.processQueue();
    }, 5000);
  }

  /**
   * 개별 작업 처리
   */
  private static async processTask(task: BackgroundTask): Promise<boolean> {
    try {
      switch (task.type) {
        case TaskType.METADATA_EXTRACTION:
          return await this.processMetadataExtraction(task);

        case TaskType.PROMPT_COLLECTION:
          await this.processPromptCollection(task);
          return true;

        default:
          logger.warn(`  ⚠️  알 수 없는 작업 타입: ${task.type}`);
          return true;
      }
    } catch (error) {
      // MetadataExtractionError인 경우 재시도 여부 판단
      if (error instanceof MetadataExtractionError) {
        if (!error.retryable) {
          logger.debug(`  ⏭️  재시도 불필요한 오류: ${error.type} - ${error.message}`);
          if (task.type === TaskType.METADATA_EXTRACTION) {
            MediaPostprocessVisibilityService.finishMetadataExtraction(task.compositeHash, 'failed');
            QueryCacheService.scheduleGalleryCacheInvalidation();
          }
          return false; // 재시도하지 않음
        }
        logger.error(`  ❌ 재시도 가능한 오류: ${error.type} - ${error.message}`);
      } else {
        logger.error(`  ❌ 작업 처리 실패: ${task.id}`, error);
      }
      throw error; // 재시도를 위해 throw
    }
  }

  /**
   * Extract AI metadata and persist it to media_metadata.
   *
   * This is shared by the background queue and the saved-media/folder-scan
   * pipeline so every path uses the exact same parser and persistence logic.
   */
  static async extractAndPersistMetadata(filePath: string, compositeHash: string): Promise<boolean> {
    const file = db.prepare(`SELECT file_type FROM image_files WHERE composite_hash = ?
      AND original_file_path = ? AND file_status = 'active' LIMIT 1`).get(compositeHash, filePath) as { file_type: string } | undefined;
    if (file?.file_type === 'video') {
      const stream = db.prepare('SELECT width, height FROM media_metadata WHERE composite_hash = ?').get(compositeHash) as { width: number; height: number } | undefined;
      if (!stream?.width || !stream.height) {
        const { VideoProcessor } = await import('./videoProcessor');
        const metadata = await VideoProcessor.extractMetadata(filePath);
        db.prepare(`UPDATE media_metadata SET width = ?, height = ?, duration = ?, fps = ?, video_codec = ?, audio_codec = ?, bitrate = ?
          WHERE composite_hash = ?`).run(metadata.width, metadata.height, metadata.duration, metadata.fps,
          metadata.video_codec, metadata.audio_codec, metadata.bitrate, compositeHash);
      }
    }
    // Video registration already probes stream metadata; don't read a whole video through the image parser.
    const aiMetadata = file?.file_type === 'video' ? { ai_info: {} } : await MetadataExtractor.extractMetadata(filePath);
    const aiInfo = aiMetadata.ai_info || {};
    const persistence = metadataPersistenceFields(aiInfo);

    // media_metadata 업데이트
    try {
      if (file?.file_type !== 'video') MediaMetadataModel.update(compositeHash, persistence.updates);
    } catch (error) {
      if (error instanceof RangeError) {
        logger.error(`  ❌ RangeError during metadata update (skipping): ${path.basename(filePath)}`);
        // RangeError는 재시도해도 해결되지 않으므로 throw하지 않고 스킵
        MediaPostprocessVisibilityService.finishMetadataExtraction(compositeHash, 'failed');
        QueryCacheService.scheduleGalleryCacheInvalidation();
        return false;
      }
      throw error;
    }

    MediaPostprocessVisibilityService.finishMetadataExtraction(compositeHash, 'completed');

    logger.debug(`  ✅ 메타데이터 추출 완료: ${path.basename(filePath)}`);

    // Run auto-collection after metadata extraction (Option B)
    // This allows conditions based on AI metadata (prompts, model, sampler, etc.)
    try {
      logger.debug(`  🔍 Running auto-collection (after metadata extraction)...`);
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(
        compositeHash
      );
      if (autoCollectResults.length > 0) {
        logger.debug(`  ✅ Auto-assigned to ${autoCollectResults.length} additional group(s) based on AI metadata`);
      }
    } catch (autoCollectError) {
      // Non-critical error - continue processing
      logger.warn(
        `  ⚠️  Auto-collection failed (non-critical) for ${path.basename(filePath)}:`,
        autoCollectError instanceof Error ? autoCollectError.message : autoCollectError
      );
    }

    // 프롬프트가 있으면 프롬프트 수집 작업 추가
    if (persistence.hasCollectablePrompt) {
      try {
        this.addPromptCollectionTask(filePath, compositeHash);
      } catch (error) {
        logger.warn(`  ⚠️  프롬프트 수집 작업 추가 실패: ${path.basename(filePath)}`, error);
      }
    }

    const releasedForVisibility = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(compositeHash);
    if (!releasedForVisibility) {
      logger.debug(`  ⏳ Waiting for optional auto post-processing before gallery visibility: ${path.basename(filePath)}`);
    }

    // 새 이미지가 추가되었으므로 갤러리 캐시 무효화
    QueryCacheService.scheduleGalleryCacheInvalidation();
    return true;
  }

  /**
   * 메타데이터 추출 처리
   */
  private static async processMetadataExtraction(task: BackgroundTask): Promise<boolean> {
    return await this.extractAndPersistMetadata(task.filePath, task.compositeHash);
  }


  /**
   * 프롬프트 수집 처리
   */
  private static async processPromptCollection(task: BackgroundTask): Promise<void> {
    // 메타데이터에서 프롬프트 조회
    const metadata = db.prepare(
      'SELECT prompt, negative_prompt, character_prompt_text FROM media_metadata WHERE composite_hash = ?'
    ).get(task.compositeHash) as any;

    if (!metadata || (!metadata.prompt && !metadata.character_prompt_text)) {
      logger.debug(`  ⏭️  프롬프트 없음: ${path.basename(task.filePath)}`);
      return;
    }

    // PromptCollectionService를 사용하여 프롬프트 수집
    await PromptCollectionService.collectFromImage(
      metadata.prompt,
      metadata.negative_prompt,
      metadata.character_prompt_text
    );

    logger.debug(`  ✅ 프롬프트 수집 완료: ${path.basename(task.filePath)}`);
  }

  /**
   * 큐 상태 조회 (대기/처리 중 여부)
   */
  static getQueueStatus(): { queueLength: number; activeCount: number; processing: boolean } {
    return {
      queueLength: this.queueLength,
      activeCount: this.activeTasks.length,
      processing: this.processing
    };
  }
}

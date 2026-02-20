import { db } from '../database/init';
import { logger } from '../utils/logger';
import { MetadataExtractor } from './metadata';
import { settingsService } from './settingsService';
import path from 'path';
import { QueryCacheService } from './QueryCacheService';
import { PromptCollectionService } from './promptCollectionService';
import { AutoCollectionService } from './autoCollectionService';
import { MetadataExtractionError } from '../types/errors';
import { CivitaiService } from './civitaiService';
import { ImageModel, ModelRole } from '../models/ImageModel';
import { CivitaiSettings } from '../models/CivitaiSettings';
import type { ModelReference } from './metadata/types';

/**
 * 백그라운드 작업 타입
 */
export enum TaskType {
  METADATA_EXTRACTION = 'metadata_extraction',
  PROMPT_COLLECTION = 'prompt_collection',
  CIVITAI_MODEL_LOOKUP = 'civitai_model_lookup'
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
  modelReferences?: ModelReference[];  // For Civitai lookup
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
  private static queue: BackgroundTask[] = [];
  private static processing = false;
  private static readonly MAX_RETRIES = 3;
  private static readonly BATCH_SIZE = 5; // 동시 처리 작업 수

  /**
   * 메타데이터 추출 작업 추가
   */
  static addMetadataExtractionTask(filePath: string, compositeHash: string): void {
    const task: BackgroundTask = {
      id: `${compositeHash}_metadata_${Date.now()}`,
      type: TaskType.METADATA_EXTRACTION,
      filePath,
      compositeHash,
      priority: 1,
      retries: 0,
      maxRetries: this.MAX_RETRIES,
      createdAt: new Date()
    };

    this.queue.push(task);
    logger.debug(`  📋 백그라운드 작업 추가: 메타데이터 추출 - ${path.basename(filePath)}`);

    // 큐 처리 시작
    if (!this.processing) {
      this.processQueue();
    }
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

    this.queue.push(task);
    logger.debug(`  📋 백그라운드 작업 추가: 프롬프트 수집 - ${path.basename(filePath)}`);

    // 큐 처리 시작
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Civitai 모델 조회 작업 추가
   */
  static addCivitaiModelLookupTask(compositeHash: string, modelReferences: ModelReference[]): void {
    // Skip if no references with hashes
    const refsWithHash = modelReferences.filter(ref => ref.hash);
    if (refsWithHash.length === 0) return;

    const task: BackgroundTask = {
      id: `${compositeHash}_civitai_${Date.now()}`,
      type: TaskType.CIVITAI_MODEL_LOOKUP,
      filePath: '',
      compositeHash,
      priority: 5, // 낮은 우선순위
      retries: 0,
      maxRetries: 1, // 1번만 시도
      createdAt: new Date(),
      modelReferences: refsWithHash
    };

    this.queue.push(task);
    logger.debug(`  📋 백그라운드 작업 추가: Civitai 모델 조회 (${refsWithHash.length}개)`);

    // 큐 처리 시작
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * 큐 처리 (배치 병렬 처리)
   */
  private static async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    logger.info(`\n🔄 백그라운드 큐 처리 시작: ${this.queue.length}개 작업`);

    while (this.queue.length > 0) {
      // 우선순위 정렬
      this.queue.sort((a, b) => a.priority - b.priority);

      // 배치 추출
      const batch = this.queue.splice(0, this.BATCH_SIZE);

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
            this.queue.push(task);
          } else {
            logger.error(`  ❌ 작업 최종 실패: ${task.id}`, result.reason);
          }
        }
      });

      // 짧은 대기 (CPU 부하 방지)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
    logger.info('✅ 백그라운드 큐 처리 완료\n');
  }

  /**
   * 개별 작업 처리
   */
  private static async processTask(task: BackgroundTask): Promise<void> {
    try {
      switch (task.type) {
        case TaskType.METADATA_EXTRACTION:
          await this.processMetadataExtraction(task);
          break;

        case TaskType.PROMPT_COLLECTION:
          await this.processPromptCollection(task);
          break;

        case TaskType.CIVITAI_MODEL_LOOKUP:
          await this.processCivitaiModelLookup(task);
          break;

        default:
          logger.warn(`  ⚠️  알 수 없는 작업 타입: ${task.type}`);
      }
    } catch (error) {
      // MetadataExtractionError인 경우 재시도 여부 판단
      if (error instanceof MetadataExtractionError) {
        if (!error.retryable) {
          logger.debug(`  ⏭️  재시도 불필요한 오류: ${error.type} - ${error.message}`);
          return; // 재시도하지 않음 (성공으로 간주)
        }
        logger.error(`  ❌ 재시도 가능한 오류: ${error.type} - ${error.message}`);
      } else {
        logger.error(`  ❌ 작업 처리 실패: ${task.id}`, error);
      }
      throw error; // 재시도를 위해 throw
    }
  }

  /**
   * 메타데이터 추출 처리
   */
  private static async processMetadataExtraction(task: BackgroundTask): Promise<void> {
    const aiMetadata = await MetadataExtractor.extractMetadata(task.filePath);
    const aiInfo = aiMetadata.ai_info || {};

    // model_references를 JSON으로 직렬화
    const modelReferencesJson = aiInfo.model_references && aiInfo.model_references.length > 0
      ? JSON.stringify(aiInfo.model_references)
      : null;

    // media_metadata 업데이트
    try {
      db.prepare(`
        UPDATE media_metadata
        SET
          ai_tool = ?,
          model_name = ?,
          steps = ?,
          cfg_scale = ?,
          sampler = ?,
          seed = ?,
          scheduler = ?,
          prompt = ?,
          negative_prompt = ?,
          denoise_strength = ?,
          generation_time = ?,
          batch_size = ?,
          batch_index = ?,
          model_references = ?,
          character_prompt_text = ?,
          raw_nai_parameters = ?
        WHERE composite_hash = ?
      `).run(
        aiInfo.ai_tool || null,
        aiInfo.model || null,
        aiInfo.steps || null,
        aiInfo.cfg_scale || null,
        aiInfo.sampler || null,
        aiInfo.seed || null,
        aiInfo.scheduler || null,
        aiInfo.prompt || null,
        aiInfo.negative_prompt || null,
        aiInfo.denoise_strength || null,
        aiInfo.generation_time || null,
        aiInfo.batch_size || null,
        aiInfo.batch_index || null,
        modelReferencesJson,
        aiInfo.character_prompt_text || null,
        aiInfo.raw_nai_parameters || null,
        task.compositeHash
      );
    } catch (error) {
      if (error instanceof RangeError) {
        logger.error(`  ❌ RangeError during metadata update (skipping): ${path.basename(task.filePath)}`);
        // RangeError는 재시도해도 해결되지 않으므로 throw하지 않고 스킵
        return;
      }
      throw error;
    }

    logger.debug(`  ✅ 메타데이터 추출 완료: ${path.basename(task.filePath)}`);

    // Run auto-collection after metadata extraction (Option B)
    // This allows conditions based on AI metadata (prompts, model, sampler, etc.)
    try {
      logger.debug(`  🔍 Running auto-collection (after metadata extraction)...`);
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(
        task.compositeHash
      );
      if (autoCollectResults.length > 0) {
        logger.debug(`  ✅ Auto-assigned to ${autoCollectResults.length} additional group(s) based on AI metadata`);
      }
    } catch (autoCollectError) {
      // Non-critical error - continue processing
      logger.warn(
        `  ⚠️  Auto-collection failed (non-critical) for ${path.basename(task.filePath)}:`,
        autoCollectError instanceof Error ? autoCollectError.message : autoCollectError
      );
    }

    // 프롬프트가 있으면 프롬프트 수집 작업 추가
    if (aiInfo.prompt || aiInfo.character_prompt_text) {
      try {
        this.addPromptCollectionTask(task.filePath, task.compositeHash);
      } catch (error) {
        logger.warn(`  ⚠️  프롬프트 수집 작업 추가 실패: ${path.basename(task.filePath)}`, error);
      }
    }

    // 모델 참조가 있으면 Civitai 조회 작업 추가
    if (aiInfo.model_references && aiInfo.model_references.length > 0) {
      try {
        this.addCivitaiModelLookupTask(task.compositeHash, aiInfo.model_references);
      } catch (error) {
        logger.warn(`  ⚠️  Civitai 조회 작업 추가 실패: ${path.basename(task.filePath)}`, error);
      }
    }

    // 새 이미지가 추가되었으므로 갤러리 캐시 무효화
    QueryCacheService.invalidateGalleryCache();
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
   * Civitai 모델 조회 처리
   */
  private static async processCivitaiModelLookup(task: BackgroundTask): Promise<void> {
    const settings = CivitaiSettings.get();
    if (!settings.enabled) {
      logger.debug(`  ⏭️  Civitai 기능 비활성화`);
      return;
    }

    if (!task.modelReferences || task.modelReferences.length === 0) {
      return;
    }

    // 1. image_models 테이블에 레코드 저장
    for (const ref of task.modelReferences) {
      ImageModel.create({
        composite_hash: task.compositeHash,
        model_hash: ref.hash,
        model_role: ref.type as ModelRole,
        weight: ref.weight
      });
    }

    // 2. 각 해시에 대해 Civitai API 조회
    for (const ref of task.modelReferences) {
      try {
        // Rate limiting
        await CivitaiService.waitForRateLimit();

        // 조회 및 캐싱
        const success = await CivitaiService.lookupAndCacheModel(ref.hash);

        if (success) {
          logger.debug(`  ✅ Civitai 모델 정보 캐싱: ${ref.name} (${ref.hash})`);
        } else {
          logger.debug(`  ⏭️  Civitai에서 모델 찾지 못함: ${ref.name} (${ref.hash})`);
        }
      } catch (error) {
        logger.error(`  ❌ Civitai 조회 실패: ${ref.hash}`, error);
        // 개별 모델 실패는 전체 작업 실패로 처리하지 않음
      }
    }
  }

  /**
   * 큐 상태 조회
   */
  static getQueueStatus(): {
    queueLength: number;
    processing: boolean;
    tasksByType: Record<TaskType, number>;
  } {
    const tasksByType: Record<TaskType, number> = {
      [TaskType.METADATA_EXTRACTION]: 0,
      [TaskType.PROMPT_COLLECTION]: 0,
      [TaskType.CIVITAI_MODEL_LOOKUP]: 0
    };

    this.queue.forEach(task => {
      tasksByType[task.type]++;
    });

    return {
      queueLength: this.queue.length,
      processing: this.processing,
      tasksByType
    };
  }

  /**
   * 큐 초기화
   */
  static clearQueue(): void {
    this.queue = [];
    logger.info('🗑️  백그라운드 큐 초기화');
  }
}

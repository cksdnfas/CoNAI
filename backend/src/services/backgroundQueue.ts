import { db } from '../database/init';
import { MetadataExtractor } from './metadata';
import { settingsService } from './settingsService';
import path from 'path';
import { QueryCacheService } from './QueryCacheService';
import { PromptCollectionService } from './promptCollectionService';
import { AutoCollectionService } from './autoCollectionService';

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
    console.log(`  📋 백그라운드 작업 추가: 메타데이터 추출 - ${path.basename(filePath)}`);

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
    console.log(`  📋 백그라운드 작업 추가: 프롬프트 수집 - ${path.basename(filePath)}`);

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
    console.log(`\n🔄 백그라운드 큐 처리 시작: ${this.queue.length}개 작업`);

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
            console.log(`  ⚠️  작업 재시도 (${task.retries}/${task.maxRetries}): ${task.id}`);
            this.queue.push(task);
          } else {
            console.error(`  ❌ 작업 최종 실패: ${task.id}`, result.reason);
          }
        }
      });

      // 짧은 대기 (CPU 부하 방지)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
    console.log('✅ 백그라운드 큐 처리 완료\n');
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

        default:
          console.warn(`  ⚠️  알 수 없는 작업 타입: ${task.type}`);
      }
    } catch (error) {
      console.error(`  ❌ 작업 처리 실패: ${task.id}`, error);
      throw error;
    }
  }

  /**
   * 메타데이터 추출 처리
   */
  private static async processMetadataExtraction(task: BackgroundTask): Promise<void> {
    const aiMetadata = await MetadataExtractor.extractMetadata(task.filePath);
    const aiInfo = aiMetadata.ai_info || {};

    // media_metadata 업데이트
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
        batch_index = ?
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
      task.compositeHash
    );

    console.log(`  ✅ 메타데이터 추출 완료: ${path.basename(task.filePath)}`);

    // Run auto-collection after metadata extraction (Option B)
    // This allows conditions based on AI metadata (prompts, model, sampler, etc.)
    try {
      console.log(`  🔍 Running auto-collection (after metadata extraction)...`);
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(
        task.compositeHash
      );
      if (autoCollectResults.length > 0) {
        console.log(`  ✅ Auto-assigned to ${autoCollectResults.length} additional group(s) based on AI metadata`);
      }
    } catch (autoCollectError) {
      // Non-critical error - continue processing
      console.warn(
        `  ⚠️  Auto-collection failed (non-critical) for ${path.basename(task.filePath)}:`,
        autoCollectError instanceof Error ? autoCollectError.message : autoCollectError
      );
    }

    // 프롬프트가 있으면 프롬프트 수집 작업 추가
    if (aiInfo.prompt) {
      try {
        this.addPromptCollectionTask(task.filePath, task.compositeHash);
      } catch (error) {
        console.warn(`  ⚠️  프롬프트 수집 작업 추가 실패: ${path.basename(task.filePath)}`, error);
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
      'SELECT prompt, negative_prompt FROM media_metadata WHERE composite_hash = ?'
    ).get(task.compositeHash) as any;

    if (!metadata || !metadata.prompt) {
      console.log(`  ⏭️  프롬프트 없음: ${path.basename(task.filePath)}`);
      return;
    }

    // PromptCollectionService를 사용하여 프롬프트 수집
    await PromptCollectionService.collectFromImage(
      metadata.prompt,
      metadata.negative_prompt
    );

    console.log(`  ✅ 프롬프트 수집 완료: ${path.basename(task.filePath)}`);
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
      [TaskType.PROMPT_COLLECTION]: 0
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
    console.log('🗑️  백그라운드 큐 초기화');
  }
}

import { GenerationHistoryModel, GenerationHistoryRecord, GenerationHistoryListRecord, GenerationHistoryDetailRecord, ServiceType } from '../models/GenerationHistory';
import type { AuthAccountType } from '../models/AuthAccount';
import { APIImageProcessor } from './APIImageProcessor';
import { BackgroundProcessorService } from './backgroundProcessorService';
import { pruneGenerationResultRetention } from './generationResultRetentionService';
import type { GeneratedImageSaveOptions } from '../utils/fileSaver';

const SLOW_GENERATION_POSTPROCESS_MS = 3000;

function logSlowGenerationPostprocessStep(params: {
  stage: string;
  historyId: number;
  serviceType: ServiceType;
  startedAt: number;
  extra?: string;
}): void {
  const elapsedMs = Date.now() - params.startedAt;
  if (elapsedMs < SLOW_GENERATION_POSTPROCESS_MS) {
    return;
  }

  console.warn(
    `⚠️ Slow generation postprocess: ${params.stage} took ${elapsedMs}ms for ${params.serviceType} history ${params.historyId}${params.extra ? ` (${params.extra})` : ''}`,
  );
}

/**
 * GenerationHistoryService
 * Manages dual storage:
 * 1. user.db/api_generation_history - lightweight generation result index
 * 2. images.db - source of truth for searchable image metadata and file-backed rendering
 * Uses media_metadata table for unified metadata storage
 */
export class GenerationHistoryService {
  /**
   * Create one lightweight ComfyUI history row.
   */
  static async createComfyUIHistory(data: {
    workflowId: number;
    workflowName: string;
    promptId?: string;
    groupId?: number;
    queueJobId?: number;
    requestedByAccountId?: number;
    requestedByAccountType?: AuthAccountType;
    serverId?: number;
  }): Promise<number> {
    const historyRecord: Omit<GenerationHistoryRecord, 'id'> = {
      service_type: 'comfyui',
      generation_status: 'pending',
      comfyui_prompt_id: data.promptId?.trim() ? data.promptId : undefined,
      workflow_id: data.workflowId,
      workflow_name: data.workflowName,
      assigned_group_id: data.groupId,
      queue_job_id: data.queueJobId,
      requested_by_account_id: data.requestedByAccountId,
      requested_by_account_type: data.requestedByAccountType,
      server_id: data.serverId,
    };

    // Model calls are now synchronous
    return GenerationHistoryModel.create(historyRecord);
  }

  /**
   * Create one lightweight NovelAI history row.
   */
  static async createNAIHistory(data: {
    model: string;
    groupId?: number;
    queueJobId?: number;
    requestedByAccountId?: number;
    requestedByAccountType?: AuthAccountType;
    serverId?: number;
  }): Promise<number> {
    const historyRecord: Omit<GenerationHistoryRecord, 'id'> = {
      service_type: 'novelai',
      generation_status: 'pending',
      nai_model: data.model,
      assigned_group_id: data.groupId,
      queue_job_id: data.queueJobId,
      requested_by_account_id: data.requestedByAccountId,
      requested_by_account_type: data.requestedByAccountType,
      server_id: data.serverId,
    };

    // Model calls are now synchronous
    return GenerationHistoryModel.create(historyRecord);
  }

  /**
   * Create one lightweight Codex history row.
   */
  static async createCodexHistory(data: {
    model?: string;
    prompt: string;
    negativePrompt?: string;
    groupId?: number;
    queueJobId?: number;
    requestedByAccountId?: number;
    requestedByAccountType?: AuthAccountType;
    metadata?: Record<string, unknown>;
  }): Promise<number> {
    const historyRecord: Omit<GenerationHistoryRecord, 'id'> = {
      service_type: 'codex',
      generation_status: 'pending',
      nai_model: data.model?.trim() || 'codex',
      positive_prompt: data.prompt,
      negative_prompt: data.negativePrompt,
      assigned_group_id: data.groupId,
      queue_job_id: data.queueJobId,
      requested_by_account_id: data.requestedByAccountId,
      requested_by_account_type: data.requestedByAccountType,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    };

    return GenerationHistoryModel.create(historyRecord);
  }

  /**
   * Process generated image - Simple file save only
   * 1. Saves original file to uploads/API/images/YYYY-MM-DD/
   * 2. Main system will auto-detect and process (thumbnails, metadata, etc.)
   */
  static async processAndUploadImage(
    historyId: number,
    imageBuffer: Buffer,
    serviceType: ServiceType,
    saveOptions?: GeneratedImageSaveOptions,
  ): Promise<void> {
    try {
      const totalStartedAt = Date.now();
      // Step 1: Update status to processing
      GenerationHistoryModel.updateStatus(historyId, 'processing');

      // Step 2: Save original file only to uploads/API/images/YYYY-MM-DD/
      const mediaPipelineStartedAt = Date.now();
      const processedPaths = await APIImageProcessor.processGeneratedImage(imageBuffer, serviceType, saveOptions);
      logSlowGenerationPostprocessStep({
        stage: 'media pipeline',
        historyId,
        serviceType,
        startedAt: mediaPipelineStartedAt,
        extra: processedPaths.originalPath,
      });

      // Step 3: Update API history with the main-DB linkage key only.
      GenerationHistoryModel.updateImagePaths(historyId, {
        compositeHash: processedPaths.compositeHash
      });

      // The file is already registered by APIImageProcessor; run the generation
      // group handoff after history linking so requested groups are not missed.
      const groupAssignmentStartedAt = Date.now();
      await BackgroundProcessorService.processApiGenerationGroupAssignmentForHash(processedPaths.compositeHash);
      logSlowGenerationPostprocessStep({
        stage: 'group assignment',
        historyId,
        serviceType,
        startedAt: groupAssignmentStartedAt,
        extra: processedPaths.compositeHash,
      });

      // Step 4: Update status to completed (file save complete)
      GenerationHistoryModel.updateStatus(historyId, 'completed');
      pruneGenerationResultRetention();

      console.log(`✅ ${serviceType.toUpperCase()} image saved: ${processedPaths.originalPath} (${Math.round(processedPaths.fileSize / 1024)}KB)`);
      console.log(`✅ Composite hash: ${processedPaths.compositeHash}`);
      console.log(`   → Main system will auto-detect and process (thumbnails, metadata, prompts, tags, groups)`);
      logSlowGenerationPostprocessStep({
        stage: 'total',
        historyId,
        serviceType,
        startedAt: totalStartedAt,
        extra: processedPaths.compositeHash,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      GenerationHistoryModel.recordError(historyId, errorMessage);
      console.error(`✗ Failed to process generation history ${historyId}:`, errorMessage);
      throw error;
    }
  }

  /**
   * Process a generated output file that already exists on disk.
   */
  static async processAndUploadGeneratedFile(
    historyId: number,
    sourceFilePath: string,
    serviceType: ServiceType,
    saveOptions?: GeneratedImageSaveOptions,
  ): Promise<void> {
    try {
      const totalStartedAt = Date.now();
      GenerationHistoryModel.updateStatus(historyId, 'processing');

      const mediaPipelineStartedAt = Date.now();
      const processedPaths = await APIImageProcessor.processGeneratedFile(sourceFilePath, serviceType, saveOptions);
      logSlowGenerationPostprocessStep({
        stage: 'media pipeline',
        historyId,
        serviceType,
        startedAt: mediaPipelineStartedAt,
        extra: processedPaths.originalPath,
      });

      GenerationHistoryModel.updateImagePaths(historyId, {
        compositeHash: processedPaths.compositeHash
      });

      const groupAssignmentStartedAt = Date.now();
      await BackgroundProcessorService.processApiGenerationGroupAssignmentForHash(processedPaths.compositeHash);
      logSlowGenerationPostprocessStep({
        stage: 'group assignment',
        historyId,
        serviceType,
        startedAt: groupAssignmentStartedAt,
        extra: processedPaths.compositeHash,
      });

      GenerationHistoryModel.updateStatus(historyId, 'completed');
      pruneGenerationResultRetention();

      console.log(`✅ ${serviceType.toUpperCase()} file saved: ${processedPaths.originalPath} (${Math.round(processedPaths.fileSize / 1024)}KB)`);
      console.log(`✅ Composite hash: ${processedPaths.compositeHash}`);
      console.log('   → Main system will auto-detect and process (thumbnails, metadata, prompts, tags, groups)');
      logSlowGenerationPostprocessStep({
        stage: 'total',
        historyId,
        serviceType,
        startedAt: totalStartedAt,
        extra: processedPaths.compositeHash,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      GenerationHistoryModel.recordError(historyId, errorMessage);
      console.error(`✗ Failed to process generated file history ${historyId}:`, errorMessage);
      throw error;
    }
  }

  /**
   * Get one generation-history detail/compat record by ID.
   * This is broader than the main list surface and exists mainly for internal or compatibility consumers.
   */
  static async getHistoryDetail(id: number): Promise<GenerationHistoryDetailRecord | null> {
    return GenerationHistoryModel.findByIdWithMetadata(id);
  }

  /**
   * Get compact generation-history list records with filters.
   * List responses stay hash-first and result-index focused for the image-generation UI.
   */
  static async getAllHistory(filters?: {
    service_type?: ServiceType;
    generation_status?: 'pending' | 'processing' | 'completed' | 'failed';
    queue_job_id?: number;
    requested_by_account_id?: number;
    requested_by_account_type?: AuthAccountType;
    server_id?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ records: GenerationHistoryListRecord[]; total: number }> {
    // Use JOIN query to get actual thumbnails and metadata
    const records = GenerationHistoryModel.findAllWithMetadata(filters);
    const total = GenerationHistoryModel.countListRecords({
      service_type: filters?.service_type,
      generation_status: filters?.generation_status,
      queue_job_id: filters?.queue_job_id,
      requested_by_account_id: filters?.requested_by_account_id,
      requested_by_account_type: filters?.requested_by_account_type,
      server_id: filters?.server_id,
    });

    return { records, total };
  }

  /**
   * Get recent compact generation-history list records.
   * Recent reads should stay aligned with the main hash-first list contract.
   */
  static async getRecentHistory(limit: number = 50): Promise<GenerationHistoryListRecord[]> {
    return GenerationHistoryModel.getRecent(limit);
  }

  /**
   * Delete generation history.
   * When image deletion is needed, resolve it from the main DB via composite_hash.
   */
  static async deleteHistory(id: number): Promise<void> {
    const history = GenerationHistoryModel.findById(id);
    if (!history) {
      throw new Error(`Generation history ${id} not found`);
    }

    if (history.composite_hash) {
      const { DeletionService } = await import('./deletionService');
      await DeletionService.deleteImage(history.composite_hash);
    }

    GenerationHistoryModel.delete(id);

    console.log(`✓ Generation history ${id} deleted`);
  }

  /**
   * Get statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    comfyui: number;
    novelai: number;
    codex: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  }> {
    // All model calls are now synchronous
    const total = GenerationHistoryModel.count();
    const comfyui = GenerationHistoryModel.count({ service_type: 'comfyui' });
    const novelai = GenerationHistoryModel.count({ service_type: 'novelai' });
    const codex = GenerationHistoryModel.count({ service_type: 'codex' });
    const completed = GenerationHistoryModel.count({ generation_status: 'completed' });
    const failed = GenerationHistoryModel.count({ generation_status: 'failed' });
    const pending = GenerationHistoryModel.count({ generation_status: 'pending' });
    const processing = GenerationHistoryModel.count({ generation_status: 'processing' });

    return { total, comfyui, novelai, codex, completed, failed, pending, processing };
  }

  /**
   * Get compact generation-history list records by workflow ID.
   * List responses stay hash-first and result-index focused for the image-generation UI.
   */
  static async getHistoryByWorkflow(
    workflowId: number,
    filters?: {
      generation_status?: 'pending' | 'processing' | 'completed' | 'failed';
      queue_job_id?: number;
      requested_by_account_id?: number;
      requested_by_account_type?: AuthAccountType;
      server_id?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ records: GenerationHistoryListRecord[]; total: number }> {
    // Use JOIN query to get actual thumbnails and metadata
    const records = GenerationHistoryModel.findAllWithMetadata({ ...filters, workflow_id: workflowId });
    const total = GenerationHistoryModel.countListRecords({
      workflow_id: workflowId,
      generation_status: filters?.generation_status,
      queue_job_id: filters?.queue_job_id,
      requested_by_account_id: filters?.requested_by_account_id,
      requested_by_account_type: filters?.requested_by_account_type,
      server_id: filters?.server_id,
    });

    return { records, total };
  }

  /**
   * Get workflow statistics
   */
  static async getWorkflowStatistics(workflowId: number): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  }> {
    return GenerationHistoryModel.getWorkflowStatistics(workflowId);
  }
}

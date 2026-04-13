import { GenerationHistoryModel, GenerationHistoryRecord, GenerationHistoryListRecord, GenerationHistoryDetailRecord, ServiceType } from '../models/GenerationHistory';
import type { AuthAccountType } from '../models/AuthAccount';
import { APIImageProcessor } from './APIImageProcessor';
import type { GeneratedImageSaveOptions } from '../utils/fileSaver';
import axios from 'axios';
import FormData from 'form-data';
import path from 'path';
import { PORTS } from '@conai/shared';

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
      // Step 1: Update status to processing
      GenerationHistoryModel.updateStatus(historyId, 'processing');

      // Step 2: Save original file only to uploads/API/images/YYYY-MM-DD/
      const processedPaths = await APIImageProcessor.processGeneratedImage(imageBuffer, serviceType, saveOptions);

      // Step 3: Update API history with the main-DB linkage key only.
      GenerationHistoryModel.updateImagePaths(historyId, {
        compositeHash: processedPaths.compositeHash
      });

      // Note: Group assignment is handled by BackgroundProcessorService after hash generation
      // (due to foreign key constraint on image_groups table)

      // Step 4: Update status to completed (file save complete)
      GenerationHistoryModel.updateStatus(historyId, 'completed');

      console.log(`✅ ${serviceType.toUpperCase()} image saved: ${processedPaths.originalPath} (${Math.round(processedPaths.fileSize / 1024)}KB)`);
      console.log(`✅ Composite hash: ${processedPaths.compositeHash}`);
      console.log(`   → Main system will auto-detect and process (thumbnails, metadata, prompts, tags, groups)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      GenerationHistoryModel.recordError(historyId, errorMessage);
      console.error(`✗ Failed to process generation history ${historyId}:`, errorMessage);
      throw error;
    }
  }

  /**
   * Upload image to main images API (internal call)
   * Uses existing /api/images/upload endpoint
   */
  private static async uploadToMainImageAPI(
    imageBuffer: Buffer,
    serviceType: ServiceType,
    historyId: number
  ): Promise<number> {
    try {
      // Get server port from environment
      // Get server port from environment
      const port = process.env.PORT || PORTS.BACKEND_DEFAULT;
      const uploadUrl = `http://localhost:${port}/api/images/upload`;

      // Create form data
      const formData = new FormData();
      formData.append('image', imageBuffer, {
        filename: `api_${serviceType}_${historyId}.png`,
        contentType: 'image/png'
      });

      // Upload to main API
      const response = await axios.post(uploadUrl, formData, {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // Extract uploaded image ID
      // Single upload endpoint returns: { success: true, data: { id, filename, ... } }
      if (response.data && response.data.success && response.data.data && response.data.data.id) {
        return response.data.data.id;
      }

      throw new Error('Failed to extract image ID from upload response');
    } catch (error) {
      console.error('Main image API upload failed:', error);
      throw new Error(`Failed to upload to main images API: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const total = GenerationHistoryModel.count({
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
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  }> {
    // All model calls are now synchronous
    const total = GenerationHistoryModel.count();
    const comfyui = GenerationHistoryModel.count({ service_type: 'comfyui' });
    const novelai = GenerationHistoryModel.count({ service_type: 'novelai' });
    const completed = GenerationHistoryModel.count({ generation_status: 'completed' });
    const failed = GenerationHistoryModel.count({ generation_status: 'failed' });
    const pending = GenerationHistoryModel.count({ generation_status: 'pending' });
    const processing = GenerationHistoryModel.count({ generation_status: 'processing' });

    return { total, comfyui, novelai, completed, failed, pending, processing };
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
    const total = GenerationHistoryModel.count({
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

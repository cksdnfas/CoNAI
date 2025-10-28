import { GenerationHistoryModel, GenerationHistoryRecord, ServiceType } from '../models/GenerationHistory';
import { APIImageProcessor } from './apiImageProcessor';
import { ImageGroupModel } from '../models/Group';
import axios from 'axios';
import FormData from 'form-data';

/**
 * GenerationHistoryService
 * Manages dual storage:
 * 1. api-generation-history.db - API generation history with workflow/parameters
 * 2. images.db - via existing image upload API (for search/management)
 */
export class GenerationHistoryService {
  /**
   * Create ComfyUI generation history
   * Stores workflow and generation parameters
   */
  static async createComfyUIHistory(data: {
    workflow: object;
    workflowId: number;
    workflowName: string;
    promptId: string;
    positivePrompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    metadata?: object;
    groupId?: number;
  }): Promise<number> {
    const historyRecord: Omit<GenerationHistoryRecord, 'id'> = {
      service_type: 'comfyui',
      generation_status: 'pending',
      comfyui_workflow: JSON.stringify(data.workflow),
      comfyui_prompt_id: data.promptId,
      workflow_id: data.workflowId,
      workflow_name: data.workflowName,
      positive_prompt: data.positivePrompt,
      negative_prompt: data.negativePrompt,
      width: data.width,
      height: data.height,
      assigned_group_id: data.groupId,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined
    };

    // Model calls are now synchronous
    return GenerationHistoryModel.create(historyRecord);
  }

  /**
   * Create NovelAI generation history
   * Stores all generation parameters
   */
  static async createNAIHistory(data: {
    model: string;
    sampler: string;
    seed: number;
    steps: number;
    scale: number;
    parameters: object;
    positivePrompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    metadata?: object;
    groupId?: number;
  }): Promise<number> {
    const historyRecord: Omit<GenerationHistoryRecord, 'id'> = {
      service_type: 'novelai',
      generation_status: 'pending',
      nai_model: data.model,
      nai_sampler: data.sampler,
      nai_seed: data.seed,
      nai_steps: data.steps,
      nai_scale: data.scale,
      nai_parameters: JSON.stringify(data.parameters),
      positive_prompt: data.positivePrompt,
      negative_prompt: data.negativePrompt,
      width: data.width,
      height: data.height,
      assigned_group_id: data.groupId,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined
    };

    // Model calls are now synchronous
    return GenerationHistoryModel.create(historyRecord);
  }

  /**
   * Process ComfyUI image metadata only (skip main API upload - already done in workflow)
   * ComfyUI images are already processed by ImageProcessor in workflow loop
   */
  static async processComfyUIHistoryMetadata(
    historyId: number,
    imageBuffer: Buffer,
    linkedImageId: number
  ): Promise<void> {
    try {
      // Update status to processing
      GenerationHistoryModel.updateStatus(historyId, 'processing');

      // Process image for API history storage
      const processedPaths = await APIImageProcessor.processGeneratedImage(imageBuffer, 'comfyui');

      // Update API history with image paths
      GenerationHistoryModel.updateImagePaths(historyId, {
        original: processedPaths.originalPath,
        thumbnail: processedPaths.thumbnailPath,
        optimized: processedPaths.optimizedPath,
        fileSize: processedPaths.fileSize
      });

      // Extract and update metadata
      try {
        console.log(`🔍 Extracting metadata for ComfyUI history ${historyId}...`);
        const extractedMetadata = await APIImageProcessor.extractMetadataFromBuffer(imageBuffer, 'comfyui');

        GenerationHistoryModel.updateMetadata(historyId, {
          positive_prompt: extractedMetadata.positive_prompt,
          negative_prompt: extractedMetadata.negative_prompt,
          width: extractedMetadata.width || processedPaths.width,
          height: extractedMetadata.height || processedPaths.height,
          metadata: JSON.stringify(extractedMetadata.metadata)
        });

        console.log(`✅ Metadata extracted and saved for history ${historyId}`);
      } catch (metadataError) {
        console.warn(`⚠️ Failed to extract metadata (non-critical):`, metadataError);
      }

      // Link to already processed image (from workflow loop)
      GenerationHistoryModel.linkToImage(historyId, linkedImageId);

      // Assign to group if groupId was specified (manual collection)
      const history = GenerationHistoryModel.findById(historyId);
      if (history?.assigned_group_id && linkedImageId) {
        try {
          console.log(`📁 Assigning image ${linkedImageId} to group ${history.assigned_group_id}...`);

          // linkedImageId를 composite_hash로 변환
          const { db } = await import('../database/init');
          const file = db.prepare(`
            SELECT if.composite_hash
            FROM image_files if
            JOIN images i ON if.original_file_path LIKE '%' || i.file_path
            WHERE i.id = ?
            LIMIT 1
          `).get(linkedImageId) as { composite_hash: string } | undefined;

          if (file) {
            await ImageGroupModel.addImageToGroup(
              history.assigned_group_id,
              file.composite_hash,
              'manual', // User-selected group = manual collection
              0
            );
            console.log(`✓ Image assigned to group ${history.assigned_group_id}`);
          } else {
            console.warn(`⚠️ Could not find composite_hash for image ID ${linkedImageId}`);
          }
        } catch (groupError) {
          console.warn(`⚠️ Failed to assign image to group (non-critical):`, groupError);
        }
      }

      // Update status to completed
      GenerationHistoryModel.updateStatus(historyId, 'completed');

      console.log(`✓ ComfyUI history ${historyId} processed successfully (linked to image ${linkedImageId})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      GenerationHistoryModel.recordError(historyId, errorMessage);
      console.error(`✗ Failed to process ComfyUI history ${historyId}:`, errorMessage);
      throw error;
    }
  }

  /**
   * Process generated image and upload to both systems
   * 1. Process image → save to uploads/API/images/
   * 2. Upload to main images API → save to uploads/images/
   * 3. Link both records
   */
  static async processAndUploadImage(
    historyId: number,
    imageBuffer: Buffer,
    serviceType: ServiceType
  ): Promise<void> {
    try {
      // Update status to processing (sync)
      GenerationHistoryModel.updateStatus(historyId, 'processing');

      // Step 1: Process image for API history storage
      const processedPaths = await APIImageProcessor.processGeneratedImage(imageBuffer, serviceType);

      // Step 2: Update API history with image paths (sync)
      GenerationHistoryModel.updateImagePaths(historyId, {
        original: processedPaths.originalPath,
        thumbnail: processedPaths.thumbnailPath,
        optimized: processedPaths.optimizedPath,
        fileSize: processedPaths.fileSize
      });

      // ✅ Step 2.1: Extract and update metadata (ComfyUI only - NovelAI already has metadata)
      if (serviceType === 'comfyui') {
        try {
          console.log(`🔍 Extracting metadata for ComfyUI history ${historyId}...`);
          const extractedMetadata = await APIImageProcessor.extractMetadataFromBuffer(imageBuffer, serviceType);

          GenerationHistoryModel.updateMetadata(historyId, {
            positive_prompt: extractedMetadata.positive_prompt,
            negative_prompt: extractedMetadata.negative_prompt,
            width: extractedMetadata.width || processedPaths.width,
            height: extractedMetadata.height || processedPaths.height,
            metadata: JSON.stringify(extractedMetadata.metadata)
          });

          console.log(`✅ Metadata extracted and saved for history ${historyId}`);
        } catch (metadataError) {
          console.warn(`⚠️ Failed to extract metadata (non-critical):`, metadataError);
        }
      }

      // Step 3: Upload to main images API for search/management
      const linkedImageId = await this.uploadToMainImageAPI(imageBuffer, serviceType, historyId);

      // Step 4: Link to main images record (sync)
      GenerationHistoryModel.linkToImage(historyId, linkedImageId);

      // Step 5: Assign to group if groupId was specified (manual collection)
      const history = GenerationHistoryModel.findById(historyId);
      if (history?.assigned_group_id && linkedImageId) {
        try {
          console.log(`📁 Assigning image ${linkedImageId} to group ${history.assigned_group_id}...`);

          // linkedImageId를 composite_hash로 변환
          const { db } = await import('../database/init');
          const file = db.prepare(`
            SELECT if.composite_hash
            FROM image_files if
            JOIN images i ON if.original_file_path LIKE '%' || i.file_path
            WHERE i.id = ?
            LIMIT 1
          `).get(linkedImageId) as { composite_hash: string } | undefined;

          if (file) {
            await ImageGroupModel.addImageToGroup(
              history.assigned_group_id,
              file.composite_hash,
              'manual', // User-selected group = manual collection
              0
            );
            console.log(`✓ Image assigned to group ${history.assigned_group_id}`);
          } else {
            console.warn(`⚠️ Could not find composite_hash for image ID ${linkedImageId}`);
          }
        } catch (groupError) {
          console.warn(`⚠️ Failed to assign image to group (non-critical):`, groupError);
        }
      }

      // Update status to completed (sync)
      GenerationHistoryModel.updateStatus(historyId, 'completed');

      console.log(`✓ Generation history ${historyId} processed successfully (linked to image ${linkedImageId})`);
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
      const port = process.env.PORT || 1566;
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
   * Get generation history by ID
   */
  static async getHistory(id: number): Promise<GenerationHistoryRecord | null> {
    // Model call is now synchronous, but keep async for consistency
    return GenerationHistoryModel.findById(id);
  }

  /**
   * Get all generation history with filters
   */
  static async getAllHistory(filters?: {
    service_type?: ServiceType;
    generation_status?: 'pending' | 'processing' | 'completed' | 'failed';
    limit?: number;
    offset?: number;
  }): Promise<{ records: GenerationHistoryRecord[]; total: number }> {
    // Model calls are now synchronous
    const records = GenerationHistoryModel.findAll(filters);
    const total = GenerationHistoryModel.count({
      service_type: filters?.service_type,
      generation_status: filters?.generation_status
    });

    return { records, total };
  }

  /**
   * Get recent generation history (last 50)
   */
  static async getRecentHistory(limit: number = 50): Promise<GenerationHistoryRecord[]> {
    // Model call is now synchronous
    return GenerationHistoryModel.getRecent(limit);
  }

  /**
   * Delete generation history
   * Also deletes associated image files from uploads/API/images/
   */
  static async deleteHistory(id: number): Promise<void> {
    // Get history record first (sync)
    const history = GenerationHistoryModel.findById(id);
    if (!history) {
      throw new Error(`Generation history ${id} not found`);
    }

    // Delete image files if they exist
    if (history.original_path && history.thumbnail_path && history.optimized_path) {
      await APIImageProcessor.deleteGeneratedImages({
        originalPath: history.original_path,
        thumbnailPath: history.thumbnail_path,
        optimizedPath: history.optimized_path
      });
    }

    // Delete history record (sync)
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
  }> {
    // All model calls are now synchronous
    const total = GenerationHistoryModel.count();
    const comfyui = GenerationHistoryModel.count({ service_type: 'comfyui' });
    const novelai = GenerationHistoryModel.count({ service_type: 'novelai' });
    const completed = GenerationHistoryModel.count({ generation_status: 'completed' });
    const failed = GenerationHistoryModel.count({ generation_status: 'failed' });
    const pending = GenerationHistoryModel.count({ generation_status: 'pending' });

    return { total, comfyui, novelai, completed, failed, pending };
  }

  /**
   * Get generation history by workflow ID
   */
  static async getHistoryByWorkflow(
    workflowId: number,
    filters?: {
      generation_status?: 'pending' | 'processing' | 'completed' | 'failed';
      limit?: number;
      offset?: number;
    }
  ): Promise<{ records: GenerationHistoryRecord[]; total: number }> {
    const records = GenerationHistoryModel.findByWorkflow(workflowId, filters);
    const total = GenerationHistoryModel.count({
      workflow_id: workflowId,
      generation_status: filters?.generation_status
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

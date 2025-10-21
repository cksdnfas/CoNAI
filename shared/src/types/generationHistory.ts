/**
 * API Generation History Types
 * For tracking ComfyUI and NovelAI image generation history
 */

export type ServiceType = 'comfyui' | 'novelai';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface GenerationHistoryRecord {
  id: number;

  // Basic Info
  service_type: ServiceType;
  generation_status: GenerationStatus;
  created_at: string;
  completed_at?: string;

  // ComfyUI Specific
  comfyui_workflow?: string;        // JSON string
  comfyui_prompt_id?: string;
  workflow_id?: number;             // Workflow reference for ComfyUI
  workflow_name?: string;           // Workflow name (denormalized)

  // NovelAI Specific
  nai_model?: string;
  nai_sampler?: string;
  nai_seed?: number;
  nai_steps?: number;
  nai_scale?: number;
  nai_parameters?: string;          // JSON string

  // Common Fields
  positive_prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;

  // Image Paths
  original_path?: string;
  thumbnail_path?: string;
  optimized_path?: string;
  file_size?: number;

  // Link to main images DB
  linked_image_id?: number;

  // Error and Metadata
  error_message?: string;
  metadata?: string;                // JSON string
}

export interface GenerationHistoryFilters {
  service_type?: ServiceType;
  generation_status?: GenerationStatus;
  workflow_id?: number;
  limit?: number;
  offset?: number;
}

export interface GenerationHistoryResponse {
  success: boolean;
  records: GenerationHistoryRecord[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface GenerationHistoryStatistics {
  total: number;
  comfyui: number;
  novelai: number;
  completed: number;
  failed: number;
  pending: number;
}

// ComfyUI Creation Request
export interface CreateComfyUIHistoryRequest {
  workflow: object;
  workflowId: number;
  workflowName: string;
  promptId: string;
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  metadata?: object;
}

// NovelAI Creation Request
export interface CreateNAIHistoryRequest {
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
}

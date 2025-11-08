/**
 * Image-related type definitions
 * Shared between backend and frontend
 *
 * BREAKING CHANGES - Complete migration to composite_hash system:
 * - Primary key: id (number) → composite_hash (string, 48 chars)
 * - Date field: upload_date → first_seen_date
 * - File path: file_path → original_file_path (from image_files table JOIN)
 * - File info: Now comes from image_files table (file_id, file_status, etc.)
 */

export interface ImageRecord {
  // ✅ New structure - Primary identification
  composite_hash: string;              // 48-character hash (PRIMARY KEY)
  first_seen_date: string;             // ISO 8601 date (replaces upload_date)

  // File information (from image_files table JOIN)
  file_id: number | null;              // Reference to image_files table
  original_file_path: string | null;   // Original file path (replaces file_path)
  file_size: number | null;            // File size in bytes
  mime_type: string;                   // MIME type (for HTTP headers only)
  file_status?: 'active' | 'deleted';  // File status
  file_type: 'image' | 'video' | 'animated';  // File type classification (use this for business logic)

  // Image metadata (from media_metadata table)
  width: number | null;                // Image width in pixels
  height: number | null;               // Image height in pixels
  thumbnail_path: string;              // Thumbnail file path

  // AI metadata fields (image generation info)
  ai_tool: string | null;              // ComfyUI, NovelAI, Stable Diffusion, etc.
  model_name: string | null;           // Main model name
  lora_models: string | null;          // LoRA models (JSON array)
  steps: number | null;                // Steps
  cfg_scale: number | null;            // CFG Scale
  sampler: string | null;              // Sampler
  seed: number | null;                 // Seed value
  scheduler: string | null;            // Scheduler
  prompt: string | null;               // Positive prompt
  negative_prompt: string | null;      // Negative prompt
  denoise_strength: number | null;     // Denoise strength
  generation_time: number | null;      // Generation time (seconds)
  batch_size: number | null;           // Batch size
  batch_index: number | null;          // Batch index
  auto_tags: string | null;            // WD v3 auto tags (JSON)

  // Image similarity search fields
  perceptual_hash: string | null;      // pHash algorithm based image hash
  dhash: string | null;                // dHash for difference hash
  ahash: string | null;                // aHash for average hash
  color_histogram: string | null;      // RGB color distribution (JSON)

  // Video-specific metadata fields
  duration: number | null;             // Video duration (seconds)
  fps: number | null;                  // Frame rate
  video_codec: string | null;          // Video codec (h264, vp9, etc.)
  audio_codec: string | null;          // Audio codec (aac, opus, etc.)
  bitrate: number | null;              // Bitrate (kbps)

  // ❌ REMOVED LEGACY FIELDS:
  // - id: number
  // - filename: string
  // - original_name: string
  // - file_path: string (now original_file_path from JOIN)
  // - upload_date: string (now first_seen_date)
  // - metadata: string | null (deprecated)
}

export interface ImageMetadata {
  [key: string]: any;
  ai_info?: {
    ai_tool?: string;                  // ComfyUI, NovelAI, Stable Diffusion, etc.
    model?: string;                    // Main model name
    lora_models?: string[];            // LoRA model array
    steps?: number;                    // Steps
    cfg_scale?: number;                // CFG Scale
    sampler?: string;                  // Sampler
    seed?: number;                     // Seed value
    scheduler?: string;                // Scheduler
    prompt?: string;                   // Positive prompt
    negative_prompt?: string;          // Negative prompt
    denoise_strength?: number;         // Denoise strength
    generation_time?: number;          // Generation time (seconds)
    batch_size?: number;               // Batch size
    batch_index?: number;              // Batch index

    // Legacy fields (compatibility)
    controlnet?: string;
    style?: string;
    quality?: string;
  };
  extractedAt?: string;
  error?: string;
}

// AI tool type definition
export type AITool = 'ComfyUI' | 'NovelAI' | 'Stable Diffusion' | 'Automatic1111' | 'InvokeAI' | 'Midjourney' | 'DALL-E' | 'Unknown';

// LoRA model information
export interface LoRAModel {
  name: string;
  strength?: number;
  version?: string;
}

export interface UploadResponse {
  success: boolean;
  data?: {
    composite_hash: string;            // ✅ Changed from id
    original_file_path: string;        // ✅ Changed from filename
    thumbnail_url: string;
    file_size: number;
    mime_type: string;
    width: number | null;
    height: number | null;
    first_seen_date: string;           // ✅ Changed from upload_date
  };
  error?: string;
}

export interface ImageListResponse {
  success: boolean;
  data?: {
    images: ImageRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  error?: string;
}

// Upload progress event types (for SSE)
export type UploadProgressEventType = 'start' | 'processing' | 'stage' | 'complete' | 'error';
export type UploadStage = 'upload' | 'metadata' | 'thumbnail' | 'auto-collect' | 'auto-tag';

export interface UploadProgressEvent {
  type: UploadProgressEventType;
  currentFile: number;             // Current file number (1-based)
  totalFiles: number;              // Total file count
  filename: string;                // Current filename
  stage?: UploadStage;             // Processing stage
  message?: string;                // Detailed message
  compositeHash?: string;          // ✅ Changed from imageId
  error?: string;                  // Error message
  timestamp: string;               // Timestamp
}

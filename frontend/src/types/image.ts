// Auto-tagging data structure (WD v3 Tagger)
export interface AutoTagsData {
  caption: string;
  taglist: string;
  rating: Record<string, number>;      // general, sensitive, questionable, explicit
  general: Record<string, number>;     // tag -> confidence score
  character: Record<string, number>;   // character -> confidence score
  model: string;
  thresholds: {
    general: number;
    character: number;
  };
  tagged_at: string;
}

/**
 * ImageRecord interface - Complete migration to composite_hash system
 *
 * Breaking Changes:
 * - Primary key: id (number) → composite_hash (string, 48 chars)
 * - Date field: upload_date → first_seen_date
 * - File path: file_path → original_file_path (from image_files table JOIN)
 * - File info: Now comes from image_files table (file_id, file_status, etc.)
 */
export interface ImageRecord {
  // ✅ Dual identification (migration period)
  id?: number;                         // image_files.id (for selection and operations)
  composite_hash: string | null;       // 48-character hash (PRIMARY KEY) - NULL during Phase 1
  first_seen_date: string;             // ISO 8601 date (replaces upload_date)

  // Phase 1/2 processing status
  is_processing?: boolean;             // True if composite_hash is NULL (Phase 1 only)

  // File information (from image_files table JOIN)
  file_id: number | null;              // Reference to image_files table
  original_file_path: string | null;   // Original file path (replaces file_path)
  file_size: number | null;            // File size in bytes
  mime_type: string;                   // MIME type (for HTTP headers only)
  file_status?: 'active' | 'deleted';  // File status
  file_type: 'image' | 'video' | 'animated';  // File type classification (use this for business logic)

  // Media metadata (from media_metadata table)
  width: number;                       // Image width in pixels
  height: number;                      // Image height in pixels
  thumbnail_path: string;              // Thumbnail file path

  // AI generation metadata
  ai_tool: string | null;              // ComfyUI, NovelAI, Stable Diffusion, etc.
  model_name: string | null;           // AI model name
  lora_models: string | null;          // LoRA models used (JSON string)
  steps: number | null;                // Generation steps
  cfg_scale: number | null;            // CFG scale
  sampler: string | null;              // Sampler name
  seed: number | null;                 // Generation seed
  scheduler: string | null;            // Scheduler name
  prompt: string | null;               // Positive prompt
  negative_prompt: string | null;      // Negative prompt
  denoise_strength: number | null;     // Denoise strength
  generation_time: number | null;      // Generation time in seconds
  batch_size: number | null;           // Batch size
  batch_index: number | null;          // Batch index

  // Auto-tagging (WD v3 Tagger)
  auto_tags: AutoTagsData | null;      // Auto-generated tags (parsed JSON)
  rating_score: number | null;         // Calculated rating score from auto_tags

  // Image similarity search
  perceptual_hash: string | null;      // pHash for perceptual similarity
  dhash: string | null;                // dHash for difference hash
  ahash: string | null;                // aHash for average hash
  color_histogram: string | null;      // RGB color histogram (JSON)

  // Video-specific metadata
  duration: number | null;             // Video duration in seconds
  fps: number | null;                  // Frame rate
  video_codec: string | null;          // Video codec (h264, vp9, etc.)
  audio_codec: string | null;          // Audio codec (aac, opus, etc.)
  bitrate: number | null;              // Bitrate in kbps

  // URLs (automatically added by backend enrichImageWithFileView)
  thumbnail_url: string | null;        // Thumbnail URL
  image_url: string | null;            // Original image URL

  // Group information (when joined)
  groups?: Array<{
    id: number;
    name: string;
    color?: string;
    collection_type: 'manual' | 'auto';
  }>;

  // Structured AI metadata (backend convenience field)
  ai_metadata?: {
    ai_tool: string | null;
    model_name: string | null;
    lora_models: any;
    generation_params: {
      steps: number | null;
      cfg_scale: number | null;
      sampler: string | null;
      seed: number | null;
      scheduler: string | null;
      denoise_strength: number | null;
      generation_time: number | null;
      batch_size: number | null;
      batch_index: number | null;
    };
    prompts: {
      prompt: string | null;
      negative_prompt: string | null;
    };
    // NovelAI 원본 생성 파라미터 (전체 JSON)
    raw_nai_parameters: Record<string, any> | null;
  };

  // ❌ REMOVED LEGACY FIELDS:
  // - filename: string
  // - original_name: string
  // - file_path: string (now original_file_path from JOIN)
  // - upload_date: string (now first_seen_date)
  // - metadata: string | null (deprecated)
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

export interface ImageSearchParams {
  search_text?: string;           // Positive prompt search keyword
  negative_text?: string;         // Negative prompt search keyword
  ai_tool?: string;
  model_name?: string;
  start_date?: string;
  end_date?: string;
  min_width?: number;
  max_width?: number;
  min_height?: number;
  max_height?: number;
  min_file_size?: number;
  max_file_size?: number;
  group_id?: number;
  page?: number;
  limit?: number;
  sortBy?: 'first_seen_date' | 'file_size' | 'width' | 'height';  // ✅ Changed from upload_date
  sortOrder?: 'ASC' | 'DESC';
}

export type PageSize = 25 | 50 | 100;

// AutoTag search related types
export interface RatingFilter {
  general?: { min?: number; max?: number };
  sensitive?: { min?: number; max?: number };
  questionable?: { min?: number; max?: number };
  explicit?: { min?: number; max?: number };
}

export interface TagFilter {
  tag: string;
  min_score?: number;
  max_score?: number;
}

export interface CharacterFilter {
  name?: string;
  min_score?: number;
  max_score?: number;
  has_character?: boolean;
}

export interface AutoTagSearchParams {
  rating?: RatingFilter;
  rating_score?: { min_score?: number; max_score?: number };
  general_tags?: TagFilter[];
  character?: CharacterFilter;
  model?: string;
  has_auto_tags?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'first_seen_date' | 'file_size' | 'width' | 'height';  // ✅ Changed from upload_date
  sortOrder?: 'ASC' | 'DESC';
}

// Upload progress event types (SSE)
export type UploadProgressEventType = 'start' | 'processing' | 'stage' | 'complete' | 'error';
export type UploadStage = 'upload' | 'metadata' | 'thumbnail' | 'auto-collect' | 'auto-tag';

export interface UploadProgressEvent {
  type: UploadProgressEventType;
  currentFile: number;             // Current file number (1-based)
  totalFiles: number;              // Total files count
  filename: string;                // Current filename
  stage?: UploadStage;             // Processing stage
  message?: string;                // Detail message
  compositeHash?: string;          // ✅ Changed from imageId
  error?: string;                  // Error message
  timestamp: string;               // Timestamp
}

// Image selection related types
export interface ImageSelectionProps {
  selectable?: boolean;
  selectedIds?: number[];                            // ✅ Changed to number[] (image_files.id)
  onSelectionChange?: (selectedIds: number[]) => void;  // ✅ Changed to number[] (image_files.id)
}

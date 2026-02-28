export interface AutoTagsData {
  caption: string;
  taglist: string;
  rating: Record<string, number>;
  general: Record<string, number>;
  character: Record<string, number>;
  model: string;
  thresholds: {
    general: number;
    character: number;
  };
  tagged_at: string;
  tagger?: {
    caption?: string;
    taglist?: string;
    rating?: Record<string, number>;
    general?: Record<string, number>;
    character?: Record<string, number>;
    model?: string;
    thresholds?: {
      general: number;
      character: number;
    };
    tagged_at?: string;
  };
  kaloscope?: {
    model?: string;
    topk?: number;
    artists?: Record<string, number>;
    taglist?: string;
    tagged_at?: string;
  };
}

export interface ImageRecord {
  id?: number;
  composite_hash: string | null;
  first_seen_date: string;

  is_processing?: boolean;

  file_id: number | null;
  original_file_path: string | null;
  file_size: number | null;
  mime_type: string;
  file_status?: 'active' | 'deleted';
  file_type: 'image' | 'video' | 'animated';

  width: number;
  height: number;
  thumbnail_path: string;

  ai_tool: string | null;
  model_name: string | null;
  lora_models: string | null;
  steps: number | null;
  cfg_scale: number | null;
  sampler: string | null;
  seed: number | null;
  scheduler: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  character_prompt_text?: string | null;
  denoise_strength: number | null;
  generation_time: number | null;
  batch_size: number | null;
  batch_index: number | null;

  auto_tags: AutoTagsData | null;
  rating_score: number | null;

  perceptual_hash: string | null;
  dhash: string | null;
  ahash: string | null;
  color_histogram: string | null;

  duration: number | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  bitrate: number | null;

  thumbnail_url: string | null;
  image_url: string | null;

  groups?: Array<{
    id: number;
    name: string;
    color?: string;
    collection_type: 'manual' | 'auto';
  }>;

  ai_metadata?: {
    ai_tool: string | null;
    model_name: string | null;
    lora_models: unknown;
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
      character_prompt_text?: string | null;
    };
    raw_nai_parameters: Record<string, unknown> | null;
  };
}

export interface UploadResponse {
  success: boolean;
  data?: {
    composite_hash: string;
    original_file_path: string;
    thumbnail_url: string;
    file_size: number;
    mime_type: string;
    width: number | null;
    height: number | null;
    first_seen_date: string;
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
  search_text?: string;
  negative_text?: string;
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
  sortBy?: 'first_seen_date' | 'file_size' | 'width' | 'height';
  sortOrder?: 'ASC' | 'DESC';
}

export type PageSize = 25 | 50 | 100;

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
  sortBy?: 'first_seen_date' | 'file_size' | 'width' | 'height';
  sortOrder?: 'ASC' | 'DESC';
}

export type UploadProgressEventType = 'start' | 'processing' | 'stage' | 'complete' | 'error';
export type UploadStage = 'upload' | 'metadata' | 'thumbnail' | 'auto-collect' | 'auto-tag';

export interface UploadProgressEvent {
  type: UploadProgressEventType;
  currentFile: number;
  totalFiles: number;
  filename: string;
  stage?: UploadStage;
  message?: string;
  compositeHash?: string;
  error?: string;
  timestamp: string;
}

export interface ImageSelectionProps {
  selectable?: boolean;
  selectedIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
}

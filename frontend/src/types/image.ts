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

export interface ImageRecord {
  id: number;
  filename: string;
  original_name: string;
  file_path: string;
  thumbnail_path: string;
  optimized_path: string | null;
  file_size: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  upload_date: string;
  metadata: string | null;

  // AI 메타데이터 필드들
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
  denoise_strength: number | null;
  generation_time: number | null;
  batch_size: number | null;
  batch_index: number | null;
  auto_tags: AutoTagsData | null;     // WD v3 자동 태그 (백엔드에서 이미 파싱됨)

  // 추가된 URL 필드들 (백엔드에서 enrichImageRecord로 추가)
  thumbnail_url?: string;
  image_url?: string;
  optimized_url?: string;

  // 그룹 정보 (백엔드에서 조인으로 추가)
  groups?: Array<{
    id: number;
    name: string;
    color?: string;
    collection_type: 'manual' | 'auto';
  }>;
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
  };
}

export interface UploadResponse {
  success: boolean;
  data?: {
    id: number;
    filename: string;
    original_name: string;
    thumbnail_url: string;
    optimized_url: string;
    file_size: number;
    mime_type: string;
    width: number | null;
    height: number | null;
    upload_date: string;
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
  search_text?: string;           // 긍정 프롬프트 검색 키워드
  negative_text?: string;         // 네거티브 프롬프트 검색 키워드 (필터)
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
  sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
  sortOrder?: 'ASC' | 'DESC';
}

export type PageSize = 25 | 50 | 100;

// AutoTag 검색 관련 타입
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
  rating_score?: { min_score?: number; max_score?: number };  // 가중치 기반 점수 필터
  general_tags?: TagFilter[];
  character?: CharacterFilter;
  model?: string;
  has_auto_tags?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
  sortOrder?: 'ASC' | 'DESC';
}

// 업로드 진행도 이벤트 타입 (SSE용)
export type UploadProgressEventType = 'start' | 'processing' | 'stage' | 'complete' | 'error';
export type UploadStage = 'upload' | 'metadata' | 'thumbnail' | 'auto-collect' | 'auto-tag';

export interface UploadProgressEvent {
  type: UploadProgressEventType;
  currentFile: number;        // 현재 처리 중인 파일 번호 (1-based)
  totalFiles: number;          // 전체 파일 개수
  filename: string;            // 현재 파일명
  stage?: UploadStage;         // 처리 단계
  message?: string;            // 상세 메시지
  imageId?: number;            // 완료 시 이미지 ID
  error?: string;              // 에러 메시지
  timestamp: string;           // 타임스탬프
}
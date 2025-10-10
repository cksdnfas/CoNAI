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
  ai_tool: string | null;              // ComfyUI, NovelAI, Stable Diffusion 등
  model_name: string | null;           // 메인 모델명
  lora_models: string | null;          // LoRA 모델들 (JSON 배열)
  steps: number | null;                // 스텝수
  cfg_scale: number | null;            // CFG Scale
  sampler: string | null;              // 샘플러
  seed: number | null;                 // 시드값
  scheduler: string | null;            // 스케줄러
  prompt: string | null;               // 포지티브 프롬프트
  negative_prompt: string | null;      // 네거티브 프롬프트
  denoise_strength: number | null;     // 디노이즈 강도
  generation_time: number | null;      // 생성 시간(초)
  batch_size: number | null;           // 배치 크기
  batch_index: number | null;          // 배치 내 인덱스
  auto_tags: string | null;            // WD v3 자동 태그 (JSON)
}

export interface ImageMetadata {
  [key: string]: any;
  ai_info?: {
    ai_tool?: string;                  // ComfyUI, NovelAI, Stable Diffusion 등
    model?: string;                    // 메인 모델명
    lora_models?: string[];            // LoRA 모델 배열
    steps?: number;                    // 스텝수
    cfg_scale?: number;                // CFG Scale
    sampler?: string;                  // 샘플러
    seed?: number;                     // 시드값
    scheduler?: string;                // 스케줄러
    prompt?: string;                   // 포지티브 프롬프트
    negative_prompt?: string;          // 네거티브 프롬프트
    denoise_strength?: number;         // 디노이즈 강도
    generation_time?: number;          // 생성 시간(초)
    batch_size?: number;               // 배치 크기
    batch_index?: number;              // 배치 내 인덱스

    // 레거시 필드들 (호환성)
    controlnet?: string;
    style?: string;
    quality?: string;
  };
  extractedAt?: string;
  error?: string;
}

// AI 도구 타입 정의
export type AITool = 'ComfyUI' | 'NovelAI' | 'Stable Diffusion' | 'Automatic1111' | 'InvokeAI' | 'Midjourney' | 'DALL-E' | 'Unknown';

// LoRA 모델 정보
export interface LoRAModel {
  name: string;
  strength?: number;
  version?: string;
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
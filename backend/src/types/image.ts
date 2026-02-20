/**
 * 영구 메타데이터 레코드 (실제 데이터 운용의 중심)
 * 원본 파일 접근이 필요 없는 모든 작업은 이 타입만 사용
 *
 * 사용 케이스:
 * - 이미지 브라우징 (썸네일은 캐시에 있음)
 * - 검색/필터 (prompt, model, tags 기반)
 * - 통계/분석 (모델 사용량, 프롬프트 분석)
 * - 그룹 관리 (composite_hash 기반)
 */
export interface ImageMetadataRecord {
  // 고유 식별자 (복합 해시: pHash + dHash + aHash)
  composite_hash: string;
  perceptual_hash: string;
  dhash: string;
  ahash: string;
  color_histogram: string | null;

  // 이미지 기본 정보
  width: number | null;
  height: number | null;

  // 캐시된 경로 (원본 파일 불필요)
  thumbnail_path: string | null;

  // AI 생성 메타데이터 (검색/필터/통계의 핵심)
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

  // 자동 태그
  auto_tags: string | null;

  // Civitai 연동용 모델 정보 (JSON)
  // [{"name":"model", "hash":"abc123", "type":"checkpoint"}, ...]
  model_references: string | null;

  // NovelAI 캐릭터 프롬프트 정규화 텍스트(검색 최적화용)
  character_prompt_text: string | null;

  // NovelAI 원본 생성 파라미터 (JSON)
  raw_nai_parameters: string | null;

  // 비디오 메타데이터
  duration: number | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  bitrate: number | null;

  // 평가 시스템
  rating_score: number;

  // 타임스탬프
  first_seen_date: string;
  metadata_updated_date: string;
}

/**
 * 파일 타입 정의
 * - image: 일반 정적 이미지 (PNG, JPG 등)
 * - video: 동영상 파일 (MP4, WEBM 등)
 * - animated: 프레임이 있는 이미지 (GIF, APNG 등)
 */
export type FileType = 'image' | 'video' | 'animated';

/**
 * 파일 위치 레코드 (원본 파일 접근 전용)
 * 다운로드, 삭제, 폴더 스캔에만 사용
 *
 * 사용 케이스:
 * - 원본 이미지 다운로드
 * - 파일 삭제
 * - 폴더 스캔 관리
 */
export interface ImageFileRecord {
  id: number;
  composite_hash: string | null; // 모든 파일 타입에 사용
  file_type: FileType; // 파일 타입 구분
  original_file_path: string;
  folder_id: number;
  file_status: 'active' | 'missing' | 'deleted';
  file_size: number;
  mime_type: string;
  file_modified_date: string | null;
  scan_date: string;
  last_verified_date: string;
}

/**
 * 통합 뷰 (원본 파일 경로가 필요한 경우)
 * 다운로드 API, 파일 관리 등에서 사용
 */
export interface ImageWithFileView extends ImageMetadataRecord {
  // 파일 정보 추가 (LEFT JOIN으로 null 가능)
  id: number | null;              // 파일 ID (일부 쿼리에서 id로 alias됨)
  file_id: number | null;
  original_file_path: string | null;
  file_status: string | null;
  file_type: FileType | null;     // 파일 타입 ('image' | 'video' | 'animated')
  mime_type: string | null;       // MIME 타입 (예: 'image/png', 'video/mp4')
  file_size: number | null;       // 파일 크기 (바이트)
  folder_id: number | null;
  folder_name: string | null;
}

/**
 * 레거시 타입 (호환성 유지용)
 * @deprecated 새 코드에서는 ImageMetadataRecord 사용 권장
 *
 * 기존 images 테이블 기반 구조
 * 점진적으로 ImageMetadataRecord로 전환 예정
 */
export interface ImageRecord {
  id: number;
  filename: string;
  original_name: string;
  file_path: string;
  thumbnail_path: string;
  file_size: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  upload_date: string;
  metadata: string | null;

  // AI 메타데이터 필드들 (이미지 생성 정보)
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

  // 이미지 유사도 검색 필드들
  perceptual_hash: string | null;      // pHash 알고리즘 기반 이미지 해시
  color_histogram: string | null;      // RGB 색상 분포 (JSON)

  // 동영상 전용 메타데이터 필드들
  duration: number | null;             // 동영상 재생 시간(초)
  fps: number | null;                  // 프레임 레이트
  video_codec: string | null;          // 비디오 코덱 (h264, vp9 등)
  audio_codec: string | null;          // 오디오 코덱 (aac, opus 등)
  bitrate: number | null;              // 비트레이트 (kbps)
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
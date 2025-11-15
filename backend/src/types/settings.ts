export type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW';

export interface DeleteProtectionSettings {
  enabled: boolean;
  recycleBinPath: string;
}

export interface GeneralSettings {
  language: SupportedLanguage;
  deleteProtection: DeleteProtectionSettings;
  enableGallery?: boolean;
  autoCleanupCanvasOnShutdown?: boolean;
  showRatingBadges?: boolean;
}

export type StealthScanMode = 'full' | 'fast' | 'skip';

export interface MetadataExtractionSettings {
  enableSecondaryExtraction: boolean;
  stealthScanMode: StealthScanMode;
  stealthMaxFileSizeMB: number;
  stealthMaxResolutionMP: number;
  skipStealthForComfyUI: boolean;
  skipStealthForWebUI: boolean;
}

export type TaggerModel = 'vit' | 'swinv2' | 'convnext';
export type TaggerDevice = 'auto' | 'cpu' | 'cuda';

export interface TaggerSettings {
  enabled: boolean;                // Tagger 활성화 (활성화 시 자동으로 미처리 이미지 태깅)
  autoTagOnUpload: boolean;        // 업로드 시 자동 태깅 여부
  model: TaggerModel;
  device: TaggerDevice;            // 디바이스 선택 (auto/cpu/cuda)
  generalThreshold: number;
  characterThreshold: number;
  pythonPath: string;
  keepModelLoaded: boolean;        // 메모리 유지 여부
  autoUnloadMinutes: number;       // 자동 언로드 시간 (분)
}

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean;  // 업로드 시 자동 해시 생성 여부
}

export type ThumbnailSize = 'original' | '2048' | '1080' | '720' | '512';

export interface ThumbnailSettings {
  size: ThumbnailSize;   // 썸네일 크기 (original = 원본 크기 유지)
  quality: number;       // 썸네일 품질 (60-100)
}

export interface AppSettings {
  general: GeneralSettings;
  tagger: TaggerSettings;
  similarity: SimilaritySettings;
  metadataExtraction: MetadataExtractionSettings;
  thumbnail: ThumbnailSettings;
}

export interface TaggerModelInfo {
  name: TaggerModel;
  label: string;
  description: string;
  downloaded: boolean;
}

export interface TaggerDependencyCheckResult {
  available: boolean;
  message: string;
  details?: {
    python: boolean;
    torch: boolean;
    timm: boolean;
    huggingface_hub: boolean;
    pillow: boolean;
    pandas: boolean;
    numpy: boolean;
  };
}

export interface ModelDownloadProgress {
  model: TaggerModel;
  status: 'idle' | 'downloading' | 'completed' | 'error';
  progress?: number;
  error?: string;
}

export interface TaggerServerStatus {
  isRunning: boolean;              // Daemon 실행 상태
  modelLoaded: boolean;            // 모델 로드 상태
  currentModel: TaggerModel | null; // 현재 로드된 모델
  currentDevice: string | null;    // 현재 사용 중인 디바이스 (예: "cuda:0", "cpu")
  lastUsedAt: string | null;       // 마지막 사용 시간 (ISO string)
}

export type TaggerModel = 'vit' | 'swinv2' | 'convnext';

export interface TaggerSettings {
  enabled: boolean;
  model: TaggerModel;
  generalThreshold: number;
  characterThreshold: number;
  pythonPath: string;
  autoTagOnUpload: boolean;
  keepModelLoaded: boolean;        // 메모리 유지 여부
  autoUnloadMinutes: number;       // 자동 언로드 시간 (분)
}

export interface AppSettings {
  tagger: TaggerSettings;
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
  lastUsedAt: string | null;       // 마지막 사용 시간 (ISO string)
}

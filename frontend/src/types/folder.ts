/**
 * 감시 폴더 타입
 */
export type FolderType = 'upload' | 'scan' | 'archive';

/**
 * 스캔 상태 타입
 */
export type ScanStatus = 'success' | 'error' | 'in_progress' | null;

/**
 * 감시자 상태 타입
 */
export type WatcherStatus = 'watching' | 'stopped' | 'error' | null;

/**
 * 파일 상태 타입
 */
export type FileStatus = 'active' | 'missing' | 'deleted';

/**
 * 감시 폴더 인터페이스
 */
export interface WatchedFolder {
  id: number;
  folder_path: string;
  folder_name: string | null;
  folder_type: FolderType;
  auto_scan: number;
  scan_interval: number;
  recursive: number;
  exclude_extensions: string | null;
  exclude_patterns: string | null;
  is_active: number;
  last_scan_date: string | null;
  last_scan_status: ScanStatus;
  last_scan_found: number;
  last_scan_error: string | null;
  watcher_enabled: number;
  watcher_status: WatcherStatus;
  watcher_error: string | null;
  watcher_last_event: string | null;
  created_date: string;
  updated_date: string;
}

/**
 * 폴더 생성 데이터
 */
export interface WatchedFolderCreate {
  folder_path: string;
  folder_name?: string;
  folder_type?: FolderType;
  auto_scan?: boolean;
  scan_interval?: number;
  recursive?: boolean;
  exclude_extensions?: string[];
  exclude_patterns?: string[];
  watcher_enabled?: boolean;
}

/**
 * 폴더 업데이트 데이터
 */
export interface WatchedFolderUpdate {
  folder_name?: string;
  auto_scan?: boolean;
  scan_interval?: number;
  recursive?: boolean;
  exclude_extensions?: string[];
  exclude_patterns?: string[];
  is_active?: boolean;
  watcher_enabled?: boolean;
}

/**
 * 폴더 스캔 결과
 */
export interface FolderScanResult {
  folderId: number;
  totalScanned: number;
  newImages: number;
  existingImages: number;
  updatedPaths: number;
  missingImages: number;
  errors: Array<{ file: string; error: string }>;
  duration: number;
  thumbnailsGenerated: number;
  backgroundTasks: number;
}

/**
 * 전체 스캔 요약
 */
export interface ScanAllSummary {
  totalFolders: number;
  totalScanned: number;
  totalNew: number;
  totalExisting: number;
  totalErrors: number;
  results: FolderScanResult[];
}

/**
 * 경로 검증 결과
 */
export interface PathValidationResult {
  valid: boolean;
  message: string;
}

/**
 * 백그라운드 작업 타입
 */
export type BackgroundTaskType = 'metadata_extraction' | 'prompt_collection';

/**
 * 자동 태깅 스케줄러 상태
 */
export interface AutoTagStatus {
  isRunning: boolean;
  pollingIntervalSeconds: number;
  batchSize: number;
  untaggedCount: number;
}

/**
 * 백그라운드 큐 상태 (통합)
 */
export interface BackgroundQueueStatus {
  queue: {
    queueLength: number;
    processing: boolean;
    tasksByType: Record<BackgroundTaskType, number>;
  };
  autoTag: AutoTagStatus;
}

/**
 * 감시자 상태 정보
 */
export interface WatcherStatusInfo {
  id: number;
  folder_path: string;
  watcher_enabled: number;
  watcher_status: WatcherStatus;
  watcher_error: string | null;
  watcher_last_event: string | null;
}

/**
 * 감시자 헬스체크 결과
 */
export interface WatcherHealthCheck {
  totalWatchers: number;
  activeWatchers: number;
  errorWatchers: number;
  watchers: WatcherStatusInfo[];
}

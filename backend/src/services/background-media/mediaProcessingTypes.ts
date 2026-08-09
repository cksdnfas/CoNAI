import type { FileType } from '../../types/image';

export interface UnhashedMediaFile {
  id: number;
  original_file_path: string;
  folder_id: number;
  mime_type: string;
  file_type: string;
}

export interface BackgroundProcessorOptions {
  quietIfIdle?: boolean;
}

export interface SavedMediaProcessingOptions {
  folderId?: number;
  mimeType?: string;
  triggerAutoTag?: boolean;
  metadataMode?: 'inline' | 'background';
  quiet?: boolean;
}

export interface SavedMediaProcessingResult {
  fileId: number;
  compositeHash: string | null;
  fileType: FileType;
  status: 'processed' | 'already_processed';
}

export interface ProcessFileOptions {
  metadataMode?: 'inline' | 'background';
}

export interface ImageFileProcessingRecord extends UnhashedMediaFile {
  composite_hash: string | null;
}

export interface ProcessingResult {
  processed: number;
  duplicates: number;
  errors: number;
  unique: number;
}

export type MediaProcessingStage =
  | 'file-access'
  | 'file-stat'
  | 'image-hash'
  | 'video-hash'
  | 'duplicate-link'
  | 'thumbnail'
  | 'video-metadata'
  | 'metadata-row'
  | 'file-link'
  | 'poster'
  | 'visibility'
  | 'auto-collection'
  | 'group-assignment'
  | 'metadata-extraction'
  | 'auto-tag'
  | 'complete';

export type MediaProcessingStageStatus = 'completed' | 'scheduled' | 'deferred' | 'skipped' | 'failed';

/** Explicit outcome shared by every file-processing stage. */
export interface MediaProcessingStageResult {
  stage: MediaProcessingStage;
  status: MediaProcessingStageStatus;
  retryable: boolean;
  error: string | null;
}

/** Internal processor result. Public BackgroundProcessorService results stay unchanged. */
export interface MediaFileProcessingResult extends MediaProcessingStageResult {
  compositeHash: string | null;
  duplicate: boolean;
  stages: MediaProcessingStageResult[];
  /** Original thrown value retained only so the orchestrator can preserve throw semantics. */
  cause?: unknown;
}

export function completedStage(stage: MediaProcessingStage): MediaProcessingStageResult {
  return { stage, status: 'completed', retryable: false, error: null };
}

export function skippedStage(stage: MediaProcessingStage, reason: string): MediaProcessingStageResult {
  return { stage, status: 'skipped', retryable: false, error: reason };
}

export function scheduledStage(stage: MediaProcessingStage): MediaProcessingStageResult {
  return { stage, status: 'scheduled', retryable: false, error: null };
}

export function deferredStage(stage: MediaProcessingStage, reason: string): MediaProcessingStageResult {
  return { stage, status: 'deferred', retryable: false, error: reason };
}

export function failedStage(
  stage: MediaProcessingStage,
  error: unknown,
  retryable: boolean,
): MediaProcessingStageResult {
  return {
    stage,
    status: 'failed',
    retryable,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function completedFileProcessing(
  compositeHash: string | null,
  duplicate: boolean,
  stages: MediaProcessingStageResult[],
): MediaFileProcessingResult {
  const complete = completedStage('complete');
  return { ...complete, compositeHash, duplicate, stages: [...stages, complete] };
}

export function stoppedFileProcessing(
  result: MediaProcessingStageResult,
  stages: MediaProcessingStageResult[],
  options: { compositeHash?: string | null; duplicate?: boolean; cause?: unknown } = {},
): MediaFileProcessingResult {
  return {
    ...result,
    compositeHash: options.compositeHash ?? null,
    duplicate: options.duplicate ?? false,
    stages: [...stages, result],
    cause: options.cause,
  };
}

const PROCESSING_RESULT_KEY = 'mediaProcessingResult';

/** Preserve the former thrown error object while attaching the new stage result. */
export function throwIfRetryableMediaFailure(result: MediaFileProcessingResult): void {
  if (result.status !== 'failed' || !result.retryable) {
    return;
  }

  if (result.cause instanceof Error) {
    Object.defineProperty(result.cause, PROCESSING_RESULT_KEY, {
      configurable: true,
      value: result,
    });
    throw result.cause;
  }

  const error = new Error(result.error ?? `Media processing failed at ${result.stage}`);
  Object.defineProperty(error, PROCESSING_RESULT_KEY, {
    configurable: true,
    value: result,
  });
  throw error;
}

/** Preserve an immediate saved-media call's legacy throw-on-failure behavior. */
export function throwMediaProcessingFailure(result: MediaFileProcessingResult): void {
  if (result.status !== 'failed') {
    return;
  }

  if (result.cause instanceof Error) {
    Object.defineProperty(result.cause, PROCESSING_RESULT_KEY, {
      configurable: true,
      value: result,
    });
    throw result.cause;
  }

  const error = new Error(result.error ?? `Media processing failed at ${result.stage}`);
  Object.defineProperty(error, PROCESSING_RESULT_KEY, {
    configurable: true,
    value: result,
  });
  throw error;
}

export function getMediaProcessingResultFromError(error: unknown): MediaFileProcessingResult | null {
  if (!(error instanceof Error)) {
    return null;
  }

  return (error as Error & { mediaProcessingResult?: MediaFileProcessingResult }).mediaProcessingResult ?? null;
}

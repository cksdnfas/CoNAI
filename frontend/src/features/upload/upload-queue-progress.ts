import type { UploadBatchResult } from '@/lib/api-images'
import { planUploadBatches } from './upload-batches'

export type UploadQueueFileStatus = 'waiting' | 'uploading' | 'processing' | 'done' | 'failed'

export type UploadQueueFileState = {
  status: UploadQueueFileStatus
  /** 0-100, bytes of this file sent so far. */
  percent: number
  error?: string
}

type UploadRunProgress = {
  phase: 'uploading' | 'processing' | 'done'
  loaded: number
  processedFiles: number
}

const WAITING: UploadQueueFileState = { status: 'waiting', percent: 0 }

/**
 * Per-row state for the upload queue, derived from the run's aggregate progress (bytes sent, files processed).
 * Files go out in queue order through `planUploadBatches`, so a file's share of the byte stream and its position
 * against the processed count tell where it is. Failures come from the run's result once it has finished.
 */
export function getUploadQueueFileStates(
  queue: readonly File[],
  runFiles: readonly File[],
  progress: UploadRunProgress | null,
  result: UploadBatchResult | null,
): Map<File, UploadQueueFileState> {
  const states = new Map<File, UploadQueueFileState>()
  const failedByName = new Map((result?.failed ?? []).map((failure) => [failure.filename, failure.error] as const))

  if (progress && runFiles.length > 0) {
    const { batches, oversized } = planUploadBatches(runFiles)
    let bytesBefore = 0
    let index = 0

    for (const file of batches.flat()) {
      const sent = file.size > 0 ? Math.min(1, Math.max(0, (progress.loaded - bytesBefore) / file.size)) : (progress.loaded >= bytesBefore ? 1 : 0)
      const processed = index < progress.processedFiles
      const failedError = progress.phase === 'done' ? failedByName.get(file.name) : undefined
      states.set(file, failedError !== undefined
        ? { status: 'failed', percent: 100, error: failedError }
        : processed
          ? { status: 'done', percent: 100 }
          : sent >= 1
            ? { status: 'processing', percent: 100 }
            : sent > 0
              ? { status: 'uploading', percent: Math.round(sent * 100) }
              : WAITING)
      bytesBefore += file.size
      index += 1
    }

    for (const file of oversized) {
      const error = failedByName.get(file.name)
      states.set(file, error !== undefined ? { status: 'failed', percent: 0, error } : WAITING)
    }
  }

  for (const file of queue) {
    if (!states.has(file)) {
      states.set(file, WAITING)
    }
  }

  return states
}

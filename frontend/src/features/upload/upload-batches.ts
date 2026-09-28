import { UPLOAD_LIMITS } from '@/lib/upload-limits'

export type UploadBatchPlan<T extends { size: number }> = {
  /** Sequential request batches, each within the per-request file and byte limits. */
  batches: T[][]
  /** Files larger than the per-file limit; never sent. */
  oversized: T[]
}

/** Split files into request-sized batches, preserving order and setting aside files the server would reject outright. */
export function planUploadBatches<T extends { size: number }>(
  files: readonly T[],
  limits: {
    maxFileBytes: number
    maxFilesPerRequest: number
    maxRequestBytes: number
  } = UPLOAD_LIMITS,
): UploadBatchPlan<T> {
  const perFileLimit = Math.min(limits.maxFileBytes, limits.maxRequestBytes)
  const batches: T[][] = []
  const oversized: T[] = []
  let current: T[] = []
  let currentBytes = 0

  for (const file of files) {
    if (file.size > perFileLimit) {
      oversized.push(file)
      continue
    }

    if (current.length > 0 && (current.length >= limits.maxFilesPerRequest || currentBytes + file.size > limits.maxRequestBytes)) {
      batches.push(current)
      current = []
      currentBytes = 0
    }

    current.push(file)
    currentBytes += file.size
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return { batches, oversized }
}

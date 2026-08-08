import type { GenerationQueueLiveProgress } from '../../types/generationQueue'

/** Process-local latest-value registry; progress events stay off the SQLite write path. */
const progressByJobId = new Map<number, GenerationQueueLiveProgress>()

export function setGenerationQueueLiveProgress(jobId: number, progress: GenerationQueueLiveProgress) {
  progressByJobId.set(jobId, progress)
}

export function getGenerationQueueLiveProgress(jobId: number) {
  return progressByJobId.get(jobId) ?? null
}

export function clearGenerationQueueLiveProgress(jobId: number) {
  progressByJobId.delete(jobId)
}

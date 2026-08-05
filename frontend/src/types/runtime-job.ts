/**
 * 책임형 잡 러너 타입 미러.
 *
 * `backend/src/types/runtimeJob.ts` 와 유니온 리터럴 집합이 정확히 일치해야 하며,
 * 어긋나면 `npm run verify:runtime-job-ui-contracts` 가 실패한다.
 */

export type RuntimeJobKind =
  | 'thumbnail-regenerate'
  | 'thumbnail-repair'
  | 'video-poster-backfill'
  | 'media-prompt-index'
  | 'group-auto-collect'
  | 'all-auto-collect'
  | 'auto-folder-rebuild'
  | 'folder-scan-all'

export type RuntimeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export const RUNTIME_JOB_TERMINAL_STATUSES: readonly RuntimeJobStatus[] = ['completed', 'failed', 'cancelled']

export interface RuntimeJobProgress {
  total: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
  /** 서버가 계산한 파생값. 클라이언트에서 다시 계산하지 않는다. */
  percentage: number
  currentLabel: string | null
}

export interface RuntimeJobError {
  target: string
  error: string
}

export interface RuntimeJobRecord<TResult = unknown> {
  jobId: string
  kind: RuntimeJobKind
  status: RuntimeJobStatus
  phase: string | null
  progress: RuntimeJobProgress
  message: string | null
  result: TResult | null
  errors: RuntimeJobError[]
  warnings: string[]
  failureCode: string | null
  failureMessage: string | null
  cancelRequested: boolean
  queuedAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

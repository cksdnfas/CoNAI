/**
 * 책임형 잡 러너 계약.
 *
 * 이 파일은 `frontend/src/types/runtime-job.ts` 와 1:1 미러이며,
 * 두 파일의 `RuntimeJobKind` / `RuntimeJobStatus` 유니온 집합이 어긋나면
 * `verify:runtime-job-ui-contracts` 가 실패한다.
 *
 * 상태 정본은 `user.db` 의 `runtime_jobs` 테이블이다. SSE 힌트는 무효화 신호일 뿐이고
 * 진행률 수치를 싣지 않는다 — 정본 조회 경로는 언제나 `GET /api/jobs/:jobId` 다.
 */

export type RuntimeJobKind =
  | 'thumbnail-regenerate'
  | 'thumbnail-repair'
  | 'group-auto-collect'
  | 'all-auto-collect'
  | 'auto-folder-rebuild'
  | 'folder-scan-all'

export type RuntimeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export const RUNTIME_JOB_KINDS: readonly RuntimeJobKind[] = [
  'thumbnail-regenerate',
  'thumbnail-repair',
  'group-auto-collect',
  'all-auto-collect',
  'auto-folder-rebuild',
  'folder-scan-all',
]

export const RUNTIME_JOB_TERMINAL_STATUSES: readonly RuntimeJobStatus[] = ['completed', 'failed', 'cancelled']

/**
 * 종료 사유 코드.
 * - `process_restarted`: 기동 복구가 미완 잡을 마감했다(자동 재개하지 않는다).
 * - `worker_lost`: 하트비트가 끊긴 잡을 스위퍼가 마감했다.
 * - `cancelled`: 사용자가 취소를 요청했고 핸들러가 체크포인트에서 빠져나왔다.
 * - `handler_error`: 핸들러가 예외로 끝났다.
 */
export const RUNTIME_JOB_FAILURE_CODES = {
  processRestarted: 'process_restarted',
  workerLost: 'worker_lost',
  cancelled: 'cancelled',
  handlerError: 'handler_error',
} as const

export type RuntimeJobFailureCode = (typeof RUNTIME_JOB_FAILURE_CODES)[keyof typeof RUNTIME_JOB_FAILURE_CODES]

/** 잡을 실행 중인 프로세스의 역할. 기동 복구가 subprocess 잡을 건너뛰는 근거가 된다. */
export type RuntimeJobOwnerRole = 'all' | 'worker' | 'api' | 'subprocess'

export interface RuntimeJobProgress {
  total: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
  /** 파생값. total === 0 이면 0. */
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

/** 진행률 보고 패치. 러너 컨텍스트와 저장소가 공유한다. */
export type RuntimeJobProgressPatch = Partial<RuntimeJobProgress> & {
  phase?: string
  message?: string
}

/** `errors` 컬럼에 유지하는 최근 실패 건수 상한. 잡 하나가 DB를 채우는 것을 막는다. */
export const RUNTIME_JOB_ERROR_LIMIT = 50

/** `result` 컬럼 직렬화 상한(64KB). 넘으면 요약 문자열로 대체한다. */
export const RUNTIME_JOB_RESULT_MAX_BYTES = 64 * 1024

/** Compute the derived percentage the same way on every read path. */
export function resolveRuntimeJobPercentage(total: number, processed: number): number {
  if (total <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
}

/** Check whether one status can no longer change. */
export function isRuntimeJobTerminalStatus(status: RuntimeJobStatus): boolean {
  return RUNTIME_JOB_TERMINAL_STATUSES.includes(status)
}

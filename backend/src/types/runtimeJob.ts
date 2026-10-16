/**
 * 책임형 잡 러너의 백엔드 전용 계약(종료 코드·소유 역할·저장 상한).
 * 와이어 타입(`RuntimeJobKind`/`RuntimeJobStatus`/`RuntimeJobRecord`…)은 `@conai/shared` 에 있다.
 */
import { RUNTIME_JOB_TERMINAL_STATUSES, type RuntimeJobProgress, type RuntimeJobStatus } from '@conai/shared'

export { RUNTIME_JOB_KINDS, RUNTIME_JOB_TERMINAL_STATUSES } from '@conai/shared'
export type { RuntimeJobError, RuntimeJobKind, RuntimeJobProgress, RuntimeJobRecord, RuntimeJobStatus } from '@conai/shared'

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

/** 진행률 보고 패치. 러너 컨텍스트와 저장소가 공유한다. */
export type RuntimeJobProgressPatch = Partial<RuntimeJobProgress> & {
  phase?: string
  message?: string
}

/** `errors` 컬럼에 유지하는 최근 실패 건수 상한. 잡 하나가 DB를 채우는 것을 막는다. */
export const RUNTIME_JOB_ERROR_LIMIT = 50

/** `result` 컬럼 상한(64KB). 대량 정규화는 결과 파일 참조, 다른 작업은 크기 요약을 저장한다. */
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

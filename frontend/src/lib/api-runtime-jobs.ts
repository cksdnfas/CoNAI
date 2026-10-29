import { requestApiData } from '@/lib/api-request'
import {
  RUNTIME_JOB_TERMINAL_STATUSES,
  type RuntimeJobKind,
  type RuntimeJobRecord,
  type RuntimeJobStatus,
} from '@/types/runtime-job'

/**
 * 장기 실행 잡 조회/취소 클라이언트.
 *
 * `GET /api/jobs/:jobId` 폴링이 진행률의 **정본 계약**이다. SSE `job.status` 힌트는
 * 이 쿼리를 무효화하는 신호일 뿐이라, 스트림이 죽어도 폴링이 스스로 회복한다.
 */

export interface RuntimeJobListFilter {
  kind?: RuntimeJobKind
  status?: RuntimeJobStatus[]
  limit?: number
}

/** Check whether one job status can no longer change. 폴링 정지 판단의 유일한 기준이다. */
export function isRuntimeJobTerminal(status: RuntimeJobStatus | undefined): boolean {
  return status !== undefined && RUNTIME_JOB_TERMINAL_STATUSES.includes(status)
}

export async function getRuntimeJob<T = unknown>(jobId: string) {
  return requestApiData<RuntimeJobRecord<T>>(`/api/jobs/${jobId}`)
}

export async function listRuntimeJobs(filter: RuntimeJobListFilter = {}) {
  const searchParams = new URLSearchParams()
  if (filter.kind) {
    searchParams.set('kind', filter.kind)
  }
  if (filter.status && filter.status.length > 0) {
    searchParams.set('status', filter.status.join(','))
  }
  if (filter.limit) {
    searchParams.set('limit', String(filter.limit))
  }

  const query = searchParams.toString()
  return requestApiData<RuntimeJobRecord[]>(`/api/jobs${query ? `?${query}` : ''}`)
}

export async function cancelRuntimeJob(jobId: string) {
  return requestApiData<RuntimeJobRecord>(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
}

/** 잡 대기 상한. 라이브러리 전체를 도는 잡도 이 안에서 끝나야 한다. */
export const RUNTIME_JOB_WAIT_TIMEOUT_MS = 2 * 60 * 60 * 1000

/**
 * Resolve the adaptive poll interval for one attempt.
 *
 * 초반에는 촘촘하게, 오래 걸리는 잡은 성기게. 고정 상수 폴링을 금지하는 계약의 근거 함수다.
 */
export function resolveRuntimeJobPollIntervalMs(attempt: number): number {
  if (attempt <= 4) {
    return 500
  }
  if (attempt <= 20) {
    return 2_000
  }
  return 5_000
}

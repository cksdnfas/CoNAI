import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import { resolveRuntimeJobPollIntervalMs, RUNTIME_JOB_WAIT_TIMEOUT_MS } from '@/lib/api-runtime-jobs'
import type { ApiResponse } from '@/types/image'
import type { GroupRematchJobRecord } from '@/types/group'

/**
 * 그룹 재매칭 잡 클라이언트.
 *
 * 서버는 이제 `runtime_jobs` 를 정본으로 쓰고 `/api/groups/auto-collect-jobs/:jobId` 는
 * 레거시 형태로 되돌려 주는 alias 다. 폴링 정책만 공용 러너 규약(`api-runtime-jobs`)에
 * 위임해 고정 1초 × 2시간(최대 7200 요청)을 적응형 간격으로 바꿨다.
 *
 * `resolveGroupRematchJobResponse()` 시그니처는 유지한다 — 호출부(`api-groups.ts`,
 * `api-auto-folder-groups.ts`)를 진행률 UI 로 옮기기 전까지 앱이 계속 동작해야 하기 때문이다.
 */

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isGroupRematchJobRecord<T>(value: unknown): value is GroupRematchJobRecord<T> {
  return Boolean(value && typeof value === 'object' && 'job_id' in value && 'status' in value)
}

export async function getGroupRematchJob<T>(jobId: string) {
  const response = await fetchJson<ApiResponse<GroupRematchJobRecord<T>>>(`/api/groups/auto-collect-jobs/${jobId}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'groups.autoCollect.run')
  }
  return response.data
}

export async function waitForGroupRematchJob<T>(
  jobId: string,
  options: {
    timeoutMs?: number
  } = {},
): Promise<T> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? RUNTIME_JOB_WAIT_TIMEOUT_MS
  let idlePollCount = 0

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getGroupRematchJob<T>(jobId)

    if (job.status === 'completed') {
      return job.result as T
    }

    // 취소된 잡도 alias 에서는 'failed' 로 접혀 오므로 여기서 종료가 관측된다.
    // 서버가 재시작 복구/스테일 스위프로 잡을 반드시 마감하기 때문에 무한 대기가 생기지 않는다.
    if (job.status === 'failed') {
      throw new Error(job.error || 'Group rematch job failed')
    }

    idlePollCount += 1
    await delay(resolveRuntimeJobPollIntervalMs(idlePollCount))
  }

  throw new Error('Group rematch job timed out')
}

export async function resolveGroupRematchJobResponse<T>(data: T | GroupRematchJobRecord<T>): Promise<T> {
  if (!isGroupRematchJobRecord<T>(data)) {
    return data
  }

  return waitForGroupRematchJob<T>(data.job_id)
}

import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type { GroupRematchJobRecord } from '@/types/group'

const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000

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
    pollIntervalMs?: number
    timeoutMs?: number
  } = {},
): Promise<T> {
  const startedAt = Date.now()
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getGroupRematchJob<T>(jobId)

    if (job.status === 'completed') {
      return job.result as T
    }

    if (job.status === 'failed') {
      throw new Error(job.error || 'Group rematch job failed')
    }

    await delay(pollIntervalMs)
  }

  throw new Error('Group rematch job timed out')
}

export async function resolveGroupRematchJobResponse<T>(data: T | GroupRematchJobRecord<T>): Promise<T> {
  if (!isGroupRematchJobRecord<T>(data)) {
    return data
  }

  return waitForGroupRematchJob<T>(data.job_id)
}

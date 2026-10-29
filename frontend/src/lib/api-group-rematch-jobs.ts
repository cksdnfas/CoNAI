import { createApiFallbackError, type ApiErrorFallbackKey } from '@/i18n/api-error-fallbacks'
import { requestJson } from '@/lib/api-request'
import { getRuntimeJob } from '@/lib/api-runtime-jobs'
import type { ApiResponse } from '@/types/image'
import type { GroupRematchJobRecord } from '@/types/group'
import type { RuntimeJobRecord } from '@/types/runtime-job'

/**
 * Start a group rematch job (auto-collect, all auto-collect, watched-folder rebuild). The start routes answer 202
 * with the legacy job shape; the runtime job record (`GET /api/jobs/:jobId`) is what the page then follows with
 * `useRuntimeJobAction`, so progress, cancel and resume after leaving the page use the shared runner contract.
 */
export async function startGroupRematchJob<T>(path: string, fallbackKey: ApiErrorFallbackKey): Promise<RuntimeJobRecord<T>> {
  const response = await requestJson<ApiResponse<GroupRematchJobRecord<T>>>(path, { method: 'POST' })
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
  return getRuntimeJob<T>(response.data.job_id)
}

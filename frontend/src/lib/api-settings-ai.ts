import type { AiRuntimeSettings, AiRuntimeStatus, AiTorchBackendPreference, EmbeddingServerStatus, EmbeddingSettings } from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** The AI Python environment: GPU detection, the installed build, install progress. `refresh` re-runs nvidia-smi. */
export async function getAiRuntimeStatus(refresh = false) {
  const response = await fetchJson<ApiResponse<AiRuntimeStatus>>(`/api/settings/ai-runtime${refresh ? '?refresh=1' : ''}`)
  if (!response.success) throw createApiFallbackError(response.error, 'settings.aiRuntime.load')
  return response.data
}

export async function updateAiRuntimeSettings(settings: Partial<AiRuntimeSettings>) {
  const response = await fetchJson<ApiResponse<AiRuntimeStatus>>('/api/settings/ai-runtime', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.aiRuntime.update')
  return response.data
}

/** Start installing a new environment with that build (the current one stays until the new one passes its check). */
export async function installAiRuntime(backend: AiTorchBackendPreference) {
  const response = await fetchJson<ApiResponse<AiRuntimeStatus>>('/api/settings/ai-runtime/install', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ backend }),
  })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.aiRuntime.install')
  return response.data
}

export async function cancelAiRuntimeInstall() {
  const response = await fetchJson<ApiResponse<AiRuntimeStatus>>('/api/settings/ai-runtime/cancel', { method: 'POST' })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.aiRuntime.install')
  return response.data
}

export async function getEmbeddingStatus() {
  const response = await fetchJson<ApiResponse<EmbeddingServerStatus>>('/api/settings/embedding/status')
  if (!response.success) throw createApiFallbackError(response.error, 'settings.embedding.load')
  return response.data
}

export async function updateEmbeddingSettings(settings: Partial<EmbeddingSettings>) {
  const response = await fetchJson<ApiResponse<{ settings: EmbeddingSettings; status: EmbeddingServerStatus }>>('/api/settings/embedding', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.embedding.update')
  return response.data
}

/** Send Kaloscope v2 artist results back to the auto-tag queue to be extracted again with 3.0. */
export async function requeueOutdatedKaloscopeResults() {
  const response = await fetchJson<ApiResponse<{ requeued: number }>>('/api/settings/kaloscope/requeue-outdated', { method: 'POST' })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.kaloscopeRequeue.run')
  return response.data
}

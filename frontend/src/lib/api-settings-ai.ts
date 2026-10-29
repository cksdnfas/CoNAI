import type { AiRuntimeSettings, AiRuntimeStatus, AiTorchBackendPreference, EmbeddingServerStatus, EmbeddingSettings } from '@conai/shared'
import type { PageSettingsVersions } from '@conai/shared'
import { requestApiData } from '@/lib/api-request'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** The AI Python environment: GPU detection, the installed build, install progress. `refresh` re-runs nvidia-smi. */
export async function getAiRuntimeStatus(refresh = false) {
  return requestApiData<AiRuntimeStatus>(`/api/settings/ai-runtime${refresh ? '?refresh=1' : ''}`, 'settings.aiRuntime.load')
}

export async function updateAiRuntimeSettings(settings: Partial<AiRuntimeSettings>, revision?: string) {
  return requestApiData<AiRuntimeStatus & { pageSettingsRevisions: { 'ai-runtime': string } }>('/api/settings/ai-runtime', 'settings.aiRuntime.update', {
    method: 'PUT',
    headers: { ...JSON_HEADERS, ...(revision ? { 'If-Match': revision } : {}) },
    body: JSON.stringify(settings),
  })
}

/** Start installing a new environment with that build (the current one stays until the new one passes its check). */
export async function installAiRuntime(backend: AiTorchBackendPreference) {
  return requestApiData<AiRuntimeStatus>('/api/settings/ai-runtime/install', 'settings.aiRuntime.install', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ backend }),
  })
}

export async function cancelAiRuntimeInstall() {
  return requestApiData<AiRuntimeStatus>('/api/settings/ai-runtime/cancel', 'settings.aiRuntime.install', { method: 'POST' })
}

export async function getEmbeddingStatus() {
  return requestApiData<EmbeddingServerStatus>('/api/settings/embedding/status', 'settings.embedding.load')
}

export async function updateEmbeddingSettings(settings: Partial<EmbeddingSettings>, revision?: string) {
  return requestApiData<{ settings: EmbeddingSettings; status: EmbeddingServerStatus } & PageSettingsVersions>('/api/settings/embedding', 'settings.embedding.update', {
    method: 'PUT',
    headers: { ...JSON_HEADERS, ...(revision ? { 'If-Match': revision } : {}) },
    body: JSON.stringify(settings),
  })
}

/** Send Kaloscope v2 artist results back to the auto-tag queue to be extracted again with 3.0. */
export async function requeueOutdatedKaloscopeResults() {
  return requestApiData<{ requeued: number }>('/api/settings/kaloscope/requeue-outdated', 'settings.kaloscopeRequeue.run', { method: 'POST' })
}

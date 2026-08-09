import type { AppSettings, LlmSettings } from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

export interface LlmPresetOptionRecord {
  id: string
  name: string
  content: string
  updatedAt: string
}

export interface LlmPresetOptionCollections {
  systemPromptPresets: LlmPresetOptionRecord[]
  promptPresets: LlmPresetOptionRecord[]
  structuredOutputJsonPresets: LlmPresetOptionRecord[]
}

export async function updateLlmSettings(settings: Partial<LlmSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/llm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.llm.update')
  }
  return response.data
}

export async function getLlmPresetOptions() {
  const response = await fetchJson<ApiResponse<LlmPresetOptionCollections>>('/api/settings/llm-presets/options')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.llmPresets.load')
  }
  return response.data
}

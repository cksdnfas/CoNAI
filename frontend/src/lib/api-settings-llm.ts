import type { AppSettings, LlmSettings } from '@conai/shared'
import { fetchApiData } from '@/lib/api-client'

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
  return fetchApiData<AppSettings>('/api/settings/llm', 'settings.llm.update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export async function getLlmPresetOptions() {
  return fetchApiData<LlmPresetOptionCollections>('/api/external-api/llm-presets/options', 'settings.llmPresets.load')
}

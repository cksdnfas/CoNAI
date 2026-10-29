import type { AppSettings, LlmSettings } from '@conai/shared'
import { requestApiData } from '@/lib/api-request'

export const LLM_PRESET_OPTIONS_QUERY_KEY = ['llm-preset-options'] as const
export const LLM_PRESET_EDITOR_QUERY_KEY = ['llm-preset-editor'] as const

export type LlmPresetCollectionKey = 'systemPromptPresets' | 'promptPresets' | 'structuredOutputJsonPresets'
export type LlmPresetSnapshot = Pick<LlmSettings, LlmPresetCollectionKey> & {
  collectionRevisions: Record<LlmPresetCollectionKey, string>
}

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

export async function getLlmPresetSnapshot() {
  return requestApiData<LlmPresetSnapshot>('/api/settings/llm-presets/options', 'settings.llmPresets.load')
}

export async function updateLlmSettings(settings: Partial<LlmSettings>, revision?: string) {
  return requestApiData<AppSettings>('/api/settings/llm', 'settings.llm.update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) },
    body: JSON.stringify(settings),
  })
}

export async function getLlmPresetOptions() {
  return requestApiData<LlmPresetOptionCollections>('/api/external-api/llm-presets/options', 'settings.llmPresets.load')
}

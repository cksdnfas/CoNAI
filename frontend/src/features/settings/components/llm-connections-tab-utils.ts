import { normalizeOptionalString } from '@/lib/primitive-normalizers'
import type { ExternalApiProviderRecord, ExternalApiProviderType } from '@/lib/api-external-api'
import type { TranslationDictionary } from '@/i18n'
import type { LlmPresetRecord, LlmSettings } from '@/types/settings'

export type LlmConnectionDraft = {
  providerName: string
  displayName: string
  providerType: ExternalApiProviderType
  baseUrl: string
  defaultModel: string
  defaultTemperature: string
  defaultMaxTokens: string
  apiKey: string
  isEnabled: boolean
}

export type LlmConnectionModalState =
  | { mode: 'create' }
  | { mode: 'edit'; provider: ExternalApiProviderRecord }
  | null

export type LlmPresetCollectionKey = keyof Pick<LlmSettings, 'systemPromptPresets' | 'promptPresets' | 'structuredOutputJsonPresets'>

export type LlmPresetDraft = {
  id: string
  name: string
  content: string
  createdAt: string | null
}

export type LlmPresetModalState =
  | { mode: 'create'; presetType: LlmPresetCollectionKey }
  | { mode: 'edit'; presetType: LlmPresetCollectionKey; preset: LlmPresetRecord }
  | null

export const LLM_CONNECTIONS_TABLE_GRID = 'grid-cols-[minmax(220px,1.15fr)_minmax(180px,1fr)_minmax(180px,0.95fr)_88px_108px_72px_56px] gap-3'
export const LLM_PRESETS_TABLE_GRID = 'grid-cols-[minmax(200px,0.9fr)_minmax(320px,1.6fr)_148px_56px] gap-3'

export const STRUCTURED_OUTPUT_JSON_EXAMPLE = `{
  "title": "",
  "summary": "",
  "tags": []
}`

export const LLM_PROVIDER_OPTIONS: Array<{ value: ExternalApiProviderType; label: TranslationDictionary; shortLabel: TranslationDictionary }> = [
  {
    value: 'llm_openai_compatible',
    label: {
      ko: 'OpenAI 호환 (LM Studio, OpenRouter, vLLM, text-generation-webui 등)',
      en: 'OpenAI compatible (LM Studio, OpenRouter, vLLM, text-generation-webui, etc.)',
    },
    shortLabel: { ko: 'OpenAI 호환', en: 'OpenAI compatible' },
  },
  {
    value: 'llm_ollama',
    label: { ko: 'Ollama', en: 'Ollama' },
    shortLabel: { ko: 'Ollama', en: 'Ollama' },
  },
]

export const LLM_PRESET_SECTIONS: Array<{
  key: LlmPresetCollectionKey
  heading: TranslationDictionary
  addLabel: TranslationDictionary
  fieldLabel: TranslationDictionary
  placeholder: TranslationDictionary
  emptyMessage: TranslationDictionary
  initialContent?: string
  expectsJson?: boolean
  mono?: boolean
}> = [
  {
    key: 'systemPromptPresets',
    heading: { ko: '시스템 프롬프트 프리셋', en: 'System prompt presets' },
    addLabel: { ko: '시스템 프롬프트 추가', en: 'Add system prompt' },
    fieldLabel: { ko: '시스템 프롬프트', en: 'System prompt' },
    placeholder: { ko: '역할, 규칙, 말투 같은 기본 지시를 저장해 둬.', en: 'Save default instructions such as role, rules, and tone.' },
    emptyMessage: { ko: '저장된 시스템 프롬프트 프리셋이 아직 없어.', en: 'No saved system prompt presets yet.' },
  },
  {
    key: 'promptPresets',
    heading: { ko: '프롬프트 프리셋', en: 'Prompt presets' },
    addLabel: { ko: '프롬프트 추가', en: 'Add prompt' },
    fieldLabel: { ko: '프롬프트', en: 'Prompt' },
    placeholder: { ko: '재사용할 기본 요청 본문을 저장해 둬.', en: 'Save a reusable default request body.' },
    emptyMessage: { ko: '저장된 프롬프트 프리셋이 아직 없어.', en: 'No saved prompt presets yet.' },
  },
  {
    key: 'structuredOutputJsonPresets',
    heading: { ko: '구조화 출력 JSON 프리셋', en: 'Structured output JSON presets' },
    addLabel: { ko: 'JSON 프리셋 추가', en: 'Add JSON preset' },
    fieldLabel: { ko: '구조화 출력 JSON 양식', en: 'Structured output JSON template' },
    placeholder: { ko: '{\n  "title": "",\n  "summary": "",\n  "tags": []\n}', en: '{\n  "title": "",\n  "summary": "",\n  "tags": []\n}' },
    emptyMessage: { ko: '저장된 구조화 출력 JSON 프리셋이 아직 없어.', en: 'No saved structured output JSON presets yet.' },
    initialContent: STRUCTURED_OUTPUT_JSON_EXAMPLE,
    expectsJson: true,
    mono: true,
  },
]

export function normalizeOptionalNumberString(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : ''
  }

  return ''
}

export function buildEmptyDraft(): LlmConnectionDraft {
  return {
    providerName: '',
    displayName: '',
    providerType: 'llm_openai_compatible',
    baseUrl: '',
    defaultModel: '',
    defaultTemperature: '',
    defaultMaxTokens: '',
    apiKey: '',
    isEnabled: true,
  }
}

export function buildProviderDraft(provider: ExternalApiProviderRecord): LlmConnectionDraft {
  return {
    providerName: provider.provider_name,
    displayName: provider.display_name,
    providerType: provider.provider_type,
    baseUrl: normalizeOptionalString(provider.base_url) ?? '',
    defaultModel: normalizeOptionalString(provider.additional_config?.default_model) ?? '',
    defaultTemperature: normalizeOptionalNumberString(provider.additional_config?.default_temperature ?? provider.additional_config?.temperature),
    defaultMaxTokens: normalizeOptionalNumberString(provider.additional_config?.default_max_tokens ?? provider.additional_config?.max_tokens),
    apiKey: '',
    isEnabled: provider.is_enabled,
  }
}

export function buildProviderPlaceholder(providerType: ExternalApiProviderType) {
  if (providerType === 'llm_ollama') {
    return 'http://127.0.0.1:11434'
  }

  return 'http://127.0.0.1:1234/v1'
}

export function getDefaultModelSummary(provider: ExternalApiProviderRecord, notSetLabel: string) {
  const defaultModel = normalizeOptionalString(provider.additional_config?.default_model)
  return defaultModel || notSetLabel
}

export function getDefaultTemperatureSummary(provider: ExternalApiProviderRecord, autoLabel: string) {
  return normalizeOptionalNumberString(provider.additional_config?.default_temperature ?? provider.additional_config?.temperature) || autoLabel
}

export function getDefaultMaxTokensSummary(provider: ExternalApiProviderRecord, autoLabel: string) {
  return normalizeOptionalNumberString(provider.additional_config?.default_max_tokens ?? provider.additional_config?.max_tokens) || autoLabel
}

export function getBaseUrlSummary(provider: ExternalApiProviderRecord, notSetLabel: string) {
  return normalizeOptionalString(provider.base_url) ?? notSetLabel
}

export function buildAdditionalConfig(draft: LlmConnectionDraft, baseConfig?: Record<string, unknown> | null) {
  const restConfig = { ...(baseConfig ?? {}) }
  delete restConfig.default_response_mode
  delete restConfig.response_mode

  return {
    ...restConfig,
    default_model: draft.defaultModel || undefined,
    default_temperature: draft.defaultTemperature || undefined,
    default_max_tokens: draft.defaultMaxTokens || undefined,
  }
}

export function buildPresetId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `llm-preset-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildEmptyPresetDraft(presetType?: LlmPresetCollectionKey): LlmPresetDraft {
  const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === presetType)

  return {
    id: buildPresetId(),
    name: '',
    content: section?.initialContent ?? '',
    createdAt: null,
  }
}

export function buildPresetDraft(preset: LlmPresetRecord): LlmPresetDraft {
  return {
    id: preset.id,
    name: preset.name,
    content: preset.content,
    createdAt: preset.createdAt,
  }
}

export function normalizePresetJson(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return JSON.stringify(JSON.parse(trimmed), null, 2)
}

export function summarizePresetValue(value: string, emptyLabel = '비어 있음') {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return emptyLabel
  }

  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized
}

export function formatPresetUpdatedAt(value: string, locale?: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return '—'
  }

  return new Date(parsed).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

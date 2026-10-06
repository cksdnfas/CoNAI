import { normalizeOptionalString } from '@/lib/primitive-normalizers'
import type { ExternalApiProviderRecord, ExternalApiProviderType } from '@/lib/api-external-api'
import type { TranslationDictionary } from '@/i18n'
import type { LlmPresetRecord, LlmSettings } from '@conai/shared'

export type LlmConnectionDraft = {
  providerName: string
  displayName: string
  providerType: ExternalApiProviderType
  baseUrl: string
  defaultModel: string
  /** Request time limit in seconds; empty uses the server-wide default. */
  timeoutSeconds: string
  /** Requests the server answers at once; group rooms let that many members on this connection answer together. */
  concurrentRequests: string
  apiKey: string
  /** Put cache_control breakpoints on requests (Anthropic models behind LiteLLM); other servers ignore or reject them. */
  promptCacheMarks: boolean
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

// Container-prefixed: the tables stack into labelled rows below these widths (SettingsResourceTable stackBelow).
export const LLM_CONNECTIONS_TABLE_GRID = '@4xl:grid-cols-[minmax(160px,1.1fr)_minmax(150px,1fr)_minmax(140px,0.9fr)_minmax(130px,0.8fr)_88px_64px_48px]'
export const LLM_PRESETS_TABLE_GRID = '@3xl:grid-cols-[minmax(180px,0.9fr)_minmax(240px,1.6fr)_140px_48px]'

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
    timeoutSeconds: '',
    concurrentRequests: '1',
    apiKey: '',
    promptCacheMarks: false,
    isEnabled: true,
  }
}

export function buildProviderDraft(provider: ExternalApiProviderRecord): LlmConnectionDraft {
  return {
    providerName: provider.provider_name,
    displayName: provider.display_name,
    providerType: provider.provider_type,
    baseUrl: normalizeOptionalString(provider.base_url) ?? '',
    defaultModel: normalizeOptionalString(provider.additional_config?.default_model ?? provider.additional_config?.model) ?? '',
    timeoutSeconds: readTimeoutSeconds(provider),
    concurrentRequests: readConcurrentRequests(provider),
    apiKey: '',
    promptCacheMarks: provider.additional_config?.prompt_cache_marks === true,
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

function readTimeoutSeconds(provider: ExternalApiProviderRecord) {
  const ms = Number(provider.additional_config?.request_timeout_ms ?? provider.additional_config?.timeout_ms)
  return Number.isFinite(ms) && ms > 0 ? String(Math.round(ms / 1000)) : ''
}

function readConcurrentRequests(provider: ExternalApiProviderRecord) {
  const count = Number(provider.additional_config?.max_concurrent_requests)
  return Number.isFinite(count) && count >= 1 ? String(Math.floor(count)) : '1'
}

export function getTimeoutSummary(provider: ExternalApiProviderRecord, defaultLabel: string) {
  const seconds = readTimeoutSeconds(provider)
  return seconds ? `${seconds}s` : defaultLabel
}

export function getBaseUrlSummary(provider: ExternalApiProviderRecord, notSetLabel: string) {
  return normalizeOptionalString(provider.base_url) ?? notSetLabel
}

export function buildAdditionalConfig(draft: LlmConnectionDraft, baseConfig?: Record<string, unknown> | null) {
  const restConfig = { ...(baseConfig ?? {}) }
  // Generation options live on chat profiles / workflow nodes now; legacy keys are dropped on save.
  for (const key of ['default_response_mode', 'response_mode', 'default_temperature', 'temperature', 'default_max_tokens', 'max_tokens', 'model', 'timeout_ms']) {
    delete restConfig[key]
  }
  const seconds = Number(draft.timeoutSeconds)
  const concurrent = Math.floor(Number(draft.concurrentRequests))

  return {
    ...restConfig,
    default_model: draft.defaultModel || undefined,
    request_timeout_ms: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined,
    max_concurrent_requests: Number.isFinite(concurrent) && concurrent > 1 ? concurrent : undefined,
    prompt_cache_marks: draft.promptCacheMarks || undefined,
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

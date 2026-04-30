import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, LoaderCircle, Plus, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createExternalApiProvider,
  deleteExternalApiProvider,
  getExternalApiProviders,
  testExternalApiProvider,
  updateExternalApiProvider,
  type ExternalApiProviderRecord,
  type ExternalApiProviderType,
} from '@/lib/api-external-api'
import { getAppSettings, updateLlmSettings } from '@/lib/api-settings'
import { normalizeOptionalString } from '@/lib/primitive-normalizers'
import type { LlmPresetRecord, LlmSettings } from '@/types/settings'
import { cn } from '@/lib/utils'
import { useI18n, type TranslationDictionary } from '@/i18n'
import { SettingsModal } from './settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsSection, SettingsToggleRow } from './settings-primitives'
import { SettingsResourceTable, SettingsResourceTableRow, SettingsStatusIcon } from './settings-resource-shared'

type LlmConnectionDraft = {
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

type LlmConnectionModalState =
  | { mode: 'create' }
  | { mode: 'edit'; provider: ExternalApiProviderRecord }
  | null

type LlmPresetCollectionKey = keyof Pick<LlmSettings, 'systemPromptPresets' | 'promptPresets' | 'structuredOutputJsonPresets'>

type LlmPresetDraft = {
  id: string
  name: string
  content: string
  createdAt: string | null
}

type LlmPresetModalState =
  | { mode: 'create'; presetType: LlmPresetCollectionKey }
  | { mode: 'edit'; presetType: LlmPresetCollectionKey; preset: LlmPresetRecord }
  | null

const LLM_CONNECTIONS_TABLE_GRID = 'grid-cols-[minmax(220px,1.15fr)_minmax(180px,1fr)_minmax(180px,0.95fr)_88px_108px_72px_56px] gap-3'
const LLM_PRESETS_TABLE_GRID = 'grid-cols-[minmax(200px,0.9fr)_minmax(320px,1.6fr)_148px_56px] gap-3'

const STRUCTURED_OUTPUT_JSON_EXAMPLE = `{
  "title": "",
  "summary": "",
  "tags": []
}`

const LLM_PROVIDER_OPTIONS: Array<{ value: ExternalApiProviderType; label: TranslationDictionary; shortLabel: TranslationDictionary }> = [
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

const LLM_PRESET_SECTIONS: Array<{
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

function normalizeOptionalNumberString(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : ''
  }

  return ''
}

function buildEmptyDraft(): LlmConnectionDraft {
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

function buildProviderDraft(provider: ExternalApiProviderRecord): LlmConnectionDraft {
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

function buildProviderPlaceholder(providerType: ExternalApiProviderType) {
  if (providerType === 'llm_ollama') {
    return 'http://127.0.0.1:11434'
  }

  return 'http://127.0.0.1:1234/v1'
}

function getDefaultModelSummary(provider: ExternalApiProviderRecord, notSetLabel: string) {
  const defaultModel = normalizeOptionalString(provider.additional_config?.default_model)
  return defaultModel || notSetLabel
}

function getDefaultTemperatureSummary(provider: ExternalApiProviderRecord, autoLabel: string) {
  return normalizeOptionalNumberString(provider.additional_config?.default_temperature ?? provider.additional_config?.temperature) || autoLabel
}

function getDefaultMaxTokensSummary(provider: ExternalApiProviderRecord, autoLabel: string) {
  return normalizeOptionalNumberString(provider.additional_config?.default_max_tokens ?? provider.additional_config?.max_tokens) || autoLabel
}

function getBaseUrlSummary(provider: ExternalApiProviderRecord, notSetLabel: string) {
  return normalizeOptionalString(provider.base_url) ?? notSetLabel
}

function buildAdditionalConfig(draft: LlmConnectionDraft, baseConfig?: Record<string, unknown> | null) {
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

function buildPresetId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `llm-preset-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function buildEmptyPresetDraft(presetType?: LlmPresetCollectionKey): LlmPresetDraft {
  const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === presetType)

  return {
    id: buildPresetId(),
    name: '',
    content: section?.initialContent ?? '',
    createdAt: null,
  }
}

function buildPresetDraft(preset: LlmPresetRecord): LlmPresetDraft {
  return {
    id: preset.id,
    name: preset.name,
    content: preset.content,
    createdAt: preset.createdAt,
  }
}

function normalizePresetJson(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return JSON.stringify(JSON.parse(trimmed), null, 2)
}

function summarizePresetValue(value: string, emptyLabel = '비어 있음') {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return emptyLabel
  }

  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized
}

function formatPresetUpdatedAt(value: string, locale?: string) {
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

function LlmConnectionListItem({
  provider,
  selected = false,
  onOpenOptions,
}: {
  provider: ExternalApiProviderRecord
  selected?: boolean
  onOpenOptions: (provider: ExternalApiProviderRecord) => void
}) {
  const { t } = useI18n()
  const notSetLabel = t('llmConnectionsTab.notSet')
  const autoLabel = t({ ko: '자동', en: 'Auto' })
  const baseUrlSummary = getBaseUrlSummary(provider, notSetLabel)

  return (
    <SettingsResourceTableRow
      gridClassName={LLM_CONNECTIONS_TABLE_GRID}
      selected={selected}
      onOpenOptions={() => onOpenOptions(provider)}
      cells={[
        <div className="min-w-0 truncate font-medium text-foreground" title={provider.provider_name}>
          {provider.provider_name}
        </div>,
        <div
          className={cn('text-xs text-muted-foreground', baseUrlSummary === notSetLabel ? 'font-medium' : 'truncate font-mono')}
          title={baseUrlSummary}
        >
          {baseUrlSummary}
        </div>,
        <div className="min-w-0 truncate text-sm font-medium text-foreground" title={getDefaultModelSummary(provider, notSetLabel)}>{getDefaultModelSummary(provider, notSetLabel)}</div>,
        <div className="text-center text-sm font-medium text-foreground">{getDefaultTemperatureSummary(provider, autoLabel)}</div>,
        <div className="text-center text-sm font-medium text-foreground">{getDefaultMaxTokensSummary(provider, autoLabel)}</div>,
        <SettingsStatusIcon checked={provider.is_enabled} title={provider.is_enabled ? t({ ko: '활성', en: 'Active' }) : t({ ko: '비활성', en: 'Inactive' })} />,
      ]}
    />
  )
}

function LlmPresetListItem({
  preset,
  selected = false,
  onOpenOptions,
}: {
  preset: LlmPresetRecord
  selected?: boolean
  onOpenOptions: (preset: LlmPresetRecord) => void
}) {
  const { locale, t } = useI18n()

  return (
    <SettingsResourceTableRow
      gridClassName={LLM_PRESETS_TABLE_GRID}
      selected={selected}
      onOpenOptions={() => onOpenOptions(preset)}
      cells={[
        <div className="min-w-0 truncate font-medium text-foreground" title={preset.name}>{preset.name}</div>,
        <div className="min-w-0 truncate text-xs text-muted-foreground" title={preset.content || t({ ko: '비어 있음', en: 'Empty' })}>
          {summarizePresetValue(preset.content, t({ ko: '비어 있음', en: 'Empty' }))}
        </div>,
        <div className="text-center text-xs text-muted-foreground">{formatPresetUpdatedAt(preset.updatedAt, locale)}</div>,
      ]}
    />
  )
}

function LlmConnectionFormFields({
  draft,
  mode,
  apiKeyMasked,
  onChange,
}: {
  draft: LlmConnectionDraft
  mode: 'create' | 'edit'
  apiKeyMasked?: string
  onChange: (patch: Partial<LlmConnectionDraft>) => void
}) {
  const { t } = useI18n()

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SettingsField label={t('llmConnectionsTab.connectionName')} className="md:col-span-2">
        <Input
          variant="settings"
          value={draft.providerName}
          onChange={(event) => onChange({ providerName: event.target.value, displayName: event.target.value })}
          placeholder={t({ ko: '예: lmstudio-local', en: 'e.g. lmstudio-local' })}
          readOnly={mode === 'edit'}
          disabled={mode === 'edit'}
        />
      </SettingsField>

      <SettingsField label={t('llmConnectionsTab.connectionType')}>
        <Select
          variant="settings"
          value={draft.providerType}
          onChange={(event) => onChange({ providerType: event.target.value as ExternalApiProviderType })}
        >
          {LLM_PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{t(option.label)}</option>
          ))}
        </Select>
      </SettingsField>

      <SettingsField label={t('llmConnectionsTab.defaultModel')}>
        <Input
          variant="settings"
          value={draft.defaultModel}
          onChange={(event) => onChange({ defaultModel: event.target.value })}
          placeholder={draft.providerType === 'llm_ollama' ? t({ ko: '예: qwen2.5:7b', en: 'e.g. qwen2.5:7b' }) : t({ ko: '예: gpt-4.1-mini, local-model', en: 'e.g. gpt-4.1-mini, local-model' })}
        />
      </SettingsField>

      <SettingsField label={t({ ko: '기본 URL', en: 'Base URL' })} className="md:col-span-2">
        <Input
          variant="settings"
          value={draft.baseUrl}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
          placeholder={buildProviderPlaceholder(draft.providerType)}
        />
      </SettingsField>

      <SettingsField label={t('llmConnectionsTab.defaultTemperature')}>
        <ScrubbableNumberInput
          variant="settings"
          step={0.1}
          min={0}
          value={draft.defaultTemperature}
          onChange={(value) => onChange({ defaultTemperature: value })}
          placeholder={t({ ko: '예: 0.7', en: 'e.g. 0.7' })}
        />
      </SettingsField>

      <SettingsField label={t('llmConnectionsTab.defaultMaxTokens')}>
        <ScrubbableNumberInput
          variant="settings"
          step={128}
          min={128}
          value={draft.defaultMaxTokens}
          onChange={(value) => onChange({ defaultMaxTokens: value })}
          placeholder={t({ ko: '예: 1024', en: 'e.g. 1024' })}
        />
      </SettingsField>

      <SettingsField label={t('llmConnectionsTab.apiKeyOptional')}>
        <Input
          variant="settings"
          type="password"
          value={draft.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder={draft.providerType === 'llm_ollama' ? t('llmConnectionsTab.usuallySafeToLeaveBlank') : apiKeyMasked || t('llmConnectionsTab.enterANewApiKey')}
        />
      </SettingsField>

      <SettingsToggleRow className="md:col-span-2 justify-between gap-4">
        <span className="text-sm text-foreground">{t({ ko: '연결 활성화', en: 'Enable connection' })}</span>
        <input
          type="checkbox"
          checked={draft.isEnabled}
          onChange={(event) => onChange({ isEnabled: event.target.checked })}
        />
      </SettingsToggleRow>
    </div>
  )
}

function LlmPresetFormFields({
  draft,
  mode,
  section,
  onChange,
}: {
  draft: LlmPresetDraft
  mode: 'create' | 'edit'
  section: (typeof LLM_PRESET_SECTIONS)[number]
  onChange: (patch: Partial<LlmPresetDraft>) => void
}) {
  const { locale, t } = useI18n()

  return (
    <div className="grid gap-4">
      <SettingsField label={t('llmConnectionsTab.presetName')}>
        <Input
          variant="settings"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={t({ ko: '예: item-summary-json', en: 'e.g. item-summary-json' })}
        />
      </SettingsField>

      <SettingsField label={t(section.fieldLabel)}>
        <Textarea
          variant="settings"
          rows={section.expectsJson ? 10 : 8}
          value={draft.content}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder={t(section.placeholder)}
          className={section.mono ? 'font-mono text-xs' : undefined}
        />
      </SettingsField>

      {mode === 'edit' && draft.createdAt ? (
        <p className="text-xs text-muted-foreground">{t({ ko: '생성: {value}', en: 'Created: {value}' }, { value: formatPresetUpdatedAt(draft.createdAt, locale) })}</p>
      ) : null}
    </div>
  )
}

function LlmConnectionEditorModal({
  state,
  onClose,
  onChanged,
}: {
  state: LlmConnectionModalState
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const isOpen = state !== null
  const isEditMode = state?.mode === 'edit'
  const provider = state?.mode === 'edit' ? state.provider : null
  const [draft, setDraft] = useState<LlmConnectionDraft>(() => (provider ? buildProviderDraft(provider) : buildEmptyDraft()))

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setDraft(provider ? buildProviderDraft(provider) : buildEmptyDraft())
  }, [isOpen, provider])

  const createMutation = useMutation({
    mutationFn: async () => {
      await createExternalApiProvider({
        provider_name: draft.providerName,
        display_name: draft.providerName,
        provider_type: draft.providerType,
        base_url: draft.baseUrl,
        api_key: draft.apiKey || undefined,
        additional_config: buildAdditionalConfig(draft),
        is_enabled: draft.isEnabled,
      })
    },
    onSuccess: async () => {
      showSnackbar({ message: t('llmConnectionsTab.llmConnectionCreated'), tone: 'info' })
      await onChanged()
      onClose()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToCreateLlmConnection'),
        tone: 'error',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!provider) {
        return
      }

      await updateExternalApiProvider(provider.provider_name, {
        display_name: draft.providerName,
        provider_type: draft.providerType,
        base_url: draft.baseUrl,
        api_key: draft.apiKey || undefined,
        additional_config: buildAdditionalConfig(draft, provider.additional_config),
        is_enabled: draft.isEnabled,
      })
    },
    onSuccess: async () => {
      showSnackbar({ message: t('llmConnectionsTab.llmConnectionSaved'), tone: 'info' })
      await onChanged()
      onClose()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToSaveLlmConnection'),
        tone: 'error',
      })
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!provider) {
        throw new Error(t('llmConnectionsTab.saveTheConnectionFirst'))
      }

      return await testExternalApiProvider(provider.provider_name)
    },
    onSuccess: (result) => {
      showSnackbar({ message: result.message || t('llmConnectionsTab.connectionTestFinished'), tone: result.success ? 'info' : 'error' })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t('llmConnectionsTab.connectionTestFailed'),
        tone: 'error',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!provider) {
        return
      }

      await deleteExternalApiProvider(provider.provider_name)
    },
    onSuccess: async () => {
      showSnackbar({ message: t('llmConnectionsTab.llmConnectionDeleted'), tone: 'info' })
      await onChanged()
      onClose()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToDeleteLlmConnection'),
        tone: 'error',
      })
    },
  })

  const isSaving = createMutation.isPending || updateMutation.isPending
  const canSave = draft.providerName.trim().length > 0 && draft.baseUrl.trim().length > 0

  return (
    <SettingsModal
      open={isOpen}
      onClose={onClose}
      title={isEditMode ? t('llmConnectionsTab.editLlmConnection') : t('llmConnectionsTab.addLlmConnection')}
      widthClassName="max-w-3xl"
    >
      <SettingsModalBody>
        <LlmConnectionFormFields
          draft={draft}
          mode={isEditMode ? 'edit' : 'create'}
          apiKeyMasked={provider?.api_key_masked}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </SettingsModalBody>

      <SettingsModalFooter>
        {isEditMode ? (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => void testMutation.mutateAsync()}
              disabled={testMutation.isPending || isSaving}
              aria-label={t('llmConnectionsTab.testConnection')}
              title={t('llmConnectionsTab.testConnection')}
            >
              {testMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="destructive"
              onClick={() => {
                if (!provider) {
                  return
                }

                if (window.confirm(t({ ko: "연결 '{providerName}' 을(를) 삭제할까?", en: "Delete connection '{providerName}'?" }, { providerName: provider.provider_name }))) {
                  void deleteMutation.mutateAsync()
                }
              }}
              disabled={deleteMutation.isPending || isSaving}
              aria-label={t('llmConnectionsTab.deleteConnection')}
              title={t('llmConnectionsTab.deleteConnection')}
            >
              {deleteMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </>
        ) : null}
        <Button type="button" size="icon-sm" variant="outline" onClick={onClose} disabled={isSaving} aria-label={t({ ko: '취소', en: 'Cancel' })} title={t({ ko: '취소', en: 'Cancel' })}>
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          onClick={() => void (isEditMode ? updateMutation.mutateAsync() : createMutation.mutateAsync())}
          disabled={!canSave || isSaving}
          aria-label={isEditMode ? t('llmConnectionsTab.saveConnection') : t('llmConnectionsTab.createAndSaveConnection')}
          title={isEditMode ? t('llmConnectionsTab.saveConnection') : t('llmConnectionsTab.createAndSaveConnection')}
        >
          {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </SettingsModalFooter>
    </SettingsModal>
  )
}

function LlmPresetEditorModal({
  state,
  isSaving,
  isDeleting,
  onClose,
  onSave,
  onDelete,
}: {
  state: LlmPresetModalState
  isSaving: boolean
  isDeleting: boolean
  onClose: () => void
  onSave: (draft: LlmPresetDraft) => Promise<void>
  onDelete: (preset: LlmPresetRecord) => Promise<void>
}) {
  const { t } = useI18n()
  const isOpen = state !== null
  const isEditMode = state?.mode === 'edit'
  const preset = state?.mode === 'edit' ? state.preset : null
  const presetType = state?.presetType
  const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === presetType) ?? LLM_PRESET_SECTIONS[0]
  const [draft, setDraft] = useState<LlmPresetDraft>(() => (preset ? buildPresetDraft(preset) : buildEmptyPresetDraft(presetType)))

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setDraft(preset ? buildPresetDraft(preset) : buildEmptyPresetDraft(presetType))
  }, [isOpen, preset, presetType])

  const canSave = draft.name.trim().length > 0

  return (
    <SettingsModal
      open={isOpen}
      onClose={onClose}
      title={isEditMode ? t({ ko: '{heading} 수정', en: 'Edit {heading}' }, { heading: t(section.heading) }) : t({ ko: '{heading} 추가', en: 'Add {heading}' }, { heading: t(section.heading) })}
      widthClassName="max-w-4xl"
    >
      <SettingsModalBody>
        <LlmPresetFormFields
          draft={draft}
          mode={isEditMode ? 'edit' : 'create'}
          section={section}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </SettingsModalBody>

      <SettingsModalFooter>
        {preset ? (
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            disabled={isSaving || isDeleting}
            onClick={() => {
              if (window.confirm(t({ ko: "프리셋 '{presetName}' 을(를) 삭제할까?", en: "Delete preset '{presetName}'?" }, { presetName: preset.name }))) {
                void onDelete(preset)
              }
            }}
            aria-label={t('llmConnectionsTab.deletePreset')}
            title={t('llmConnectionsTab.deletePreset')}
          >
            {isDeleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        ) : null}
        <Button type="button" size="icon-sm" variant="outline" onClick={onClose} disabled={isSaving || isDeleting} aria-label={t({ ko: '취소', en: 'Cancel' })} title={t({ ko: '취소', en: 'Cancel' })}>
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          onClick={() => void onSave(draft)}
          disabled={!canSave || isSaving || isDeleting}
          aria-label={preset ? t('llmConnectionsTab.savePreset') : t({ ko: '{fieldLabel} 저장', en: 'Save {fieldLabel}' }, { fieldLabel: t(section.fieldLabel) })}
          title={preset ? t('llmConnectionsTab.savePreset') : t({ ko: '{fieldLabel} 저장', en: 'Save {fieldLabel}' }, { fieldLabel: t(section.fieldLabel) })}
        >
          {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </SettingsModalFooter>
    </SettingsModal>
  )
}

export function LlmConnectionsTab() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [connectionModalState, setConnectionModalState] = useState<LlmConnectionModalState>(null)
  const [presetModalState, setPresetModalState] = useState<LlmPresetModalState>(null)

  const providersQuery = useQuery({
    queryKey: ['external-api-providers', 'settings-llm-connections'],
    queryFn: getExternalApiProviders,
  })

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const llmPresetCollections = settingsQuery.data?.llm ?? {
    systemPromptPresets: [],
    promptPresets: [],
    structuredOutputJsonPresets: [],
  }

  const refreshProviders = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['external-api-providers'] }),
      queryClient.invalidateQueries({ queryKey: ['external-api-llm-options'] }),
      queryClient.invalidateQueries({ queryKey: ['module-definitions'] }),
    ])
  }

  const syncSettingsCache = (nextSettings: Awaited<ReturnType<typeof getAppSettings>>) => {
    queryClient.setQueryData(['app-settings'], nextSettings)
  }

  const savePresetMutation = useMutation({
    mutationFn: async (draft: LlmPresetDraft) => {
      const presetType = presetModalState?.presetType
      if (!presetType) {
        throw new Error(t('llmConnectionsTab.selectAPresetTypeFirst'))
      }

      const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === presetType)
      const currentPresets = llmPresetCollections[presetType]
      const normalizedName = draft.name.trim()
      if (!normalizedName) {
        throw new Error(t('llmConnectionsTab.presetNameIsRequired'))
      }

      let content = draft.content
      if (section?.expectsJson) {
        try {
          content = normalizePresetJson(draft.content)
        } catch {
          throw new Error(t('llmConnectionsTab.structuredOutputJsonTemplateIs'))
        }
      }

      if (!content.trim()) {
        throw new Error(t('llmConnectionsTab.presetContentIsEmpty'))
      }

      const duplicate = currentPresets.find((preset) => preset.id !== draft.id && preset.name.trim().toLowerCase() === normalizedName.toLowerCase())
      if (duplicate) {
        throw new Error(t({ ko: '같은 이름의 프리셋이 이미 있어: {presetName}', en: 'A preset with this name already exists: {presetName}' }, { presetName: duplicate.name }))
      }

      const existingPreset = currentPresets.find((preset) => preset.id === draft.id) ?? null
      const nextPreset: LlmPresetRecord = {
        id: existingPreset?.id ?? draft.id,
        name: normalizedName,
        content,
        createdAt: existingPreset?.createdAt ?? draft.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const nextPresets = existingPreset
        ? currentPresets.map((preset) => (preset.id === existingPreset.id ? nextPreset : preset))
        : [...currentPresets, nextPreset]

      return await updateLlmSettings({ [presetType]: nextPresets } as Partial<LlmSettings>)
    },
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      void queryClient.invalidateQueries({ queryKey: ['llm-preset-options'] })
      showSnackbar({ message: t('llmConnectionsTab.llmPresetSaved'), tone: 'info' })
      setPresetModalState(null)
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToSaveLlmPreset'),
        tone: 'error',
      })
    },
  })

  const deletePresetMutation = useMutation({
    mutationFn: async (preset: LlmPresetRecord) => {
      const presetType = presetModalState?.presetType
      if (!presetType) {
        throw new Error(t('llmConnectionsTab.selectAPresetTypeFirst'))
      }

      const nextPresets = llmPresetCollections[presetType].filter((entry) => entry.id !== preset.id)
      return await updateLlmSettings({ [presetType]: nextPresets } as Partial<LlmSettings>)
    },
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      void queryClient.invalidateQueries({ queryKey: ['llm-preset-options'] })
      showSnackbar({ message: t('llmConnectionsTab.llmPresetDeleted'), tone: 'info' })
      setPresetModalState(null)
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToDeleteLlmPreset'),
        tone: 'error',
      })
    },
  })

  const llmProviders = useMemo(
    () => (providersQuery.data ?? []).filter((provider) => provider.provider_type === 'llm_openai_compatible' || provider.provider_type === 'llm_ollama'),
    [providersQuery.data],
  )

  return (
    <div className="space-y-6">
      <SettingsSection
        heading={t('llmConnectionsTab.llmConnections')}
        actions={
          <Button
            type="button"
            size="icon-sm"
            onClick={() => setConnectionModalState({ mode: 'create' })}
            aria-label={t('llmConnectionsTab.addConnection')}
            title={t('llmConnectionsTab.addConnection')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        }
        bodyClassName="px-0 py-0"
      >
        {providersQuery.isLoading ? (
          <div className="space-y-2 px-4 py-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-sm" />
            ))}
          </div>
        ) : llmProviders.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">{t({ ko: '연결된 LLM이 아직 없어.', en: 'No connected LLMs yet.' })}</div>
        ) : (
          <SettingsResourceTable
            gridClassName={LLM_CONNECTIONS_TABLE_GRID}
            minWidthClassName="min-w-[1200px]"
            headers={[t({ ko: '연결', en: 'Connection' }), t({ ko: '기본 URL', en: 'Base URL' }), t({ ko: '기본 모델', en: 'Default model' }), t({ ko: '온도', en: 'Temperature' }), t({ ko: '최대 토큰', en: 'Max tokens' }), t({ ko: '활성', en: 'Active' }), '']}
          >
            {llmProviders.map((provider) => (
              <LlmConnectionListItem
                key={provider.id}
                provider={provider}
                selected={connectionModalState?.mode === 'edit' && connectionModalState.provider.provider_name === provider.provider_name}
                onOpenOptions={(nextProvider) => setConnectionModalState({ mode: 'edit', provider: nextProvider })}
              />
            ))}
          </SettingsResourceTable>
        )}
      </SettingsSection>

      {LLM_PRESET_SECTIONS.map((section) => {
        const presets = llmPresetCollections[section.key]

        return (
          <SettingsSection
            key={section.key}
            heading={t(section.heading)}
            actions={
              <Button
                type="button"
                size="icon-sm"
                onClick={() => setPresetModalState({ mode: 'create', presetType: section.key })}
                aria-label={t(section.addLabel)}
                title={t(section.addLabel)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            }
            bodyClassName="px-0 py-0"
          >
            {settingsQuery.isLoading ? (
              <div className="space-y-2 px-4 py-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-sm" />
                ))}
              </div>
            ) : presets.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">{t(section.emptyMessage)}</div>
            ) : (
              <SettingsResourceTable
                gridClassName={LLM_PRESETS_TABLE_GRID}
                minWidthClassName="min-w-[980px]"
                headers={[t({ ko: '이름', en: 'Name' }), t(section.fieldLabel), t({ ko: '수정', en: 'Updated' }), '']}
              >
                {presets.map((preset) => (
                  <LlmPresetListItem
                    key={preset.id}
                    preset={preset}
                    selected={presetModalState?.mode === 'edit' && presetModalState.presetType === section.key && presetModalState.preset.id === preset.id}
                    onOpenOptions={(nextPreset) => setPresetModalState({ mode: 'edit', presetType: section.key, preset: nextPreset })}
                  />
                ))}
              </SettingsResourceTable>
            )}
          </SettingsSection>
        )
      })}

      <LlmConnectionEditorModal
        state={connectionModalState}
        onClose={() => setConnectionModalState(null)}
        onChanged={refreshProviders}
      />

      <LlmPresetEditorModal
        state={presetModalState}
        isSaving={savePresetMutation.isPending}
        isDeleting={deletePresetMutation.isPending}
        onClose={() => setPresetModalState(null)}
        onSave={async (draft) => {
          await savePresetMutation.mutateAsync(draft)
        }}
        onDelete={async (preset) => {
          await deletePresetMutation.mutateAsync(preset)
        }}
      />
    </div>
  )
}

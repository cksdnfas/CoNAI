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

const LLM_PROVIDER_OPTIONS: Array<{ value: ExternalApiProviderType; label: string; shortLabel: string }> = [
  {
    value: 'llm_openai_compatible',
    label: 'OpenAI 호환 (LM Studio, OpenRouter, vLLM, text-generation-webui 등)',
    shortLabel: 'OpenAI 호환',
  },
  {
    value: 'llm_ollama',
    label: 'Ollama',
    shortLabel: 'Ollama',
  },
]

const LLM_PRESET_SECTIONS: Array<{
  key: LlmPresetCollectionKey
  heading: string
  addLabel: string
  fieldLabel: string
  placeholder: string
  emptyMessage: string
  initialContent?: string
  expectsJson?: boolean
  mono?: boolean
}> = [
  {
    key: 'systemPromptPresets',
    heading: '시스템 프롬프트 프리셋',
    addLabel: '시스템 프롬프트 추가',
    fieldLabel: '시스템 프롬프트',
    placeholder: '역할, 규칙, 말투 같은 기본 지시를 저장해 둬.',
    emptyMessage: '저장된 시스템 프롬프트 프리셋이 아직 없어.',
  },
  {
    key: 'promptPresets',
    heading: '프롬프트 프리셋',
    addLabel: '프롬프트 추가',
    fieldLabel: '프롬프트',
    placeholder: '재사용할 기본 요청 본문을 저장해 둬.',
    emptyMessage: '저장된 프롬프트 프리셋이 아직 없어.',
  },
  {
    key: 'structuredOutputJsonPresets',
    heading: '구조화 출력 JSON 프리셋',
    addLabel: 'JSON 프리셋 추가',
    fieldLabel: '구조화 출력 JSON 양식',
    placeholder: '{\n  "title": "",\n  "summary": "",\n  "tags": []\n}',
    emptyMessage: '저장된 구조화 출력 JSON 프리셋이 아직 없어.',
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

function getDefaultModelSummary(provider: ExternalApiProviderRecord) {
  const defaultModel = normalizeOptionalString(provider.additional_config?.default_model)
  return defaultModel || '미설정'
}

function getDefaultTemperatureSummary(provider: ExternalApiProviderRecord) {
  return normalizeOptionalNumberString(provider.additional_config?.default_temperature ?? provider.additional_config?.temperature) || '자동'
}

function getDefaultMaxTokensSummary(provider: ExternalApiProviderRecord) {
  return normalizeOptionalNumberString(provider.additional_config?.default_max_tokens ?? provider.additional_config?.max_tokens) || '자동'
}

function getBaseUrlSummary(provider: ExternalApiProviderRecord) {
  return normalizeOptionalString(provider.base_url) ?? '미설정'
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
  const baseUrlSummary = getBaseUrlSummary(provider)

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
          className={cn('text-xs text-muted-foreground', baseUrlSummary === '미설정' ? 'font-medium' : 'truncate font-mono')}
          title={baseUrlSummary}
        >
          {baseUrlSummary}
        </div>,
        <div className="min-w-0 truncate text-sm font-medium text-foreground" title={getDefaultModelSummary(provider)}>{getDefaultModelSummary(provider)}</div>,
        <div className="text-center text-sm font-medium text-foreground">{getDefaultTemperatureSummary(provider)}</div>,
        <div className="text-center text-sm font-medium text-foreground">{getDefaultMaxTokensSummary(provider)}</div>,
        <SettingsStatusIcon checked={provider.is_enabled} title={provider.is_enabled ? 'active' : 'inactive'} />,
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
  return (
    <SettingsResourceTableRow
      gridClassName={LLM_PRESETS_TABLE_GRID}
      selected={selected}
      onOpenOptions={() => onOpenOptions(preset)}
      cells={[
        <div className="min-w-0 truncate font-medium text-foreground" title={preset.name}>{preset.name}</div>,
        <div className="min-w-0 truncate text-xs text-muted-foreground" title={preset.content || '비어 있음'}>
          {summarizePresetValue(preset.content)}
        </div>,
        <div className="text-center text-xs text-muted-foreground">{formatPresetUpdatedAt(preset.updatedAt)}</div>,
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
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SettingsField label="연결 이름" className="md:col-span-2">
        <Input
          variant="settings"
          value={draft.providerName}
          onChange={(event) => onChange({ providerName: event.target.value, displayName: event.target.value })}
          placeholder="예: lmstudio-local"
          readOnly={mode === 'edit'}
          disabled={mode === 'edit'}
        />
      </SettingsField>

      <SettingsField label="연결 타입">
        <Select
          variant="settings"
          value={draft.providerType}
          onChange={(event) => onChange({ providerType: event.target.value as ExternalApiProviderType })}
        >
          {LLM_PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </SettingsField>

      <SettingsField label="기본 모델">
        <Input
          variant="settings"
          value={draft.defaultModel}
          onChange={(event) => onChange({ defaultModel: event.target.value })}
          placeholder={draft.providerType === 'llm_ollama' ? '예: qwen2.5:7b' : '예: gpt-4.1-mini, local-model'}
        />
      </SettingsField>

      <SettingsField label="Base URL" className="md:col-span-2">
        <Input
          variant="settings"
          value={draft.baseUrl}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
          placeholder={buildProviderPlaceholder(draft.providerType)}
        />
      </SettingsField>

      <SettingsField label="기본 온도">
        <ScrubbableNumberInput
          variant="settings"
          step={0.1}
          min={0}
          value={draft.defaultTemperature}
          onChange={(value) => onChange({ defaultTemperature: value })}
          placeholder="예: 0.7"
        />
      </SettingsField>

      <SettingsField label="기본 최대 토큰">
        <ScrubbableNumberInput
          variant="settings"
          step={128}
          min={128}
          value={draft.defaultMaxTokens}
          onChange={(value) => onChange({ defaultMaxTokens: value })}
          placeholder="예: 1024"
        />
      </SettingsField>

      <SettingsField label="API Key (선택)">
        <Input
          variant="settings"
          type="password"
          value={draft.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder={draft.providerType === 'llm_ollama' ? '보통 비워둬도 돼' : apiKeyMasked || '새 API 키 입력'}
        />
      </SettingsField>

      <SettingsToggleRow className="md:col-span-2 justify-between gap-4">
        <span className="text-sm text-foreground">연결 활성화</span>
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
  return (
    <div className="grid gap-4">
      <SettingsField label="프리셋 이름">
        <Input
          variant="settings"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="예: item-summary-json"
        />
      </SettingsField>

      <SettingsField label={section.fieldLabel}>
        <Textarea
          variant="settings"
          rows={section.expectsJson ? 10 : 8}
          value={draft.content}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder={section.placeholder}
          className={section.mono ? 'font-mono text-xs' : undefined}
        />
      </SettingsField>

      {mode === 'edit' && draft.createdAt ? (
        <p className="text-xs text-muted-foreground">생성: {formatPresetUpdatedAt(draft.createdAt)}</p>
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
      showSnackbar({ message: 'LLM 연결을 만들었어.', tone: 'info' })
      await onChanged()
      onClose()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : 'LLM 연결 생성에 실패했어.',
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
      showSnackbar({ message: 'LLM 연결을 저장했어.', tone: 'info' })
      await onChanged()
      onClose()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : 'LLM 연결 저장에 실패했어.',
        tone: 'error',
      })
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!provider) {
        throw new Error('먼저 연결을 저장해줘.')
      }

      return await testExternalApiProvider(provider.provider_name)
    },
    onSuccess: (result) => {
      showSnackbar({ message: result.message || '연결 테스트가 끝났어.', tone: result.success ? 'info' : 'error' })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : '연결 테스트에 실패했어.',
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
      showSnackbar({ message: 'LLM 연결을 삭제했어.', tone: 'info' })
      await onChanged()
      onClose()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : 'LLM 연결 삭제에 실패했어.',
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
      title={isEditMode ? 'LLM 연결 수정' : 'LLM 연결 추가'}
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
              aria-label="연결 테스트"
              title="연결 테스트"
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

                if (window.confirm(`연결 '${provider.provider_name}' 을(를) 삭제할까?`)) {
                  void deleteMutation.mutateAsync()
                }
              }}
              disabled={deleteMutation.isPending || isSaving}
              aria-label="연결 삭제"
              title="연결 삭제"
            >
              {deleteMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </>
        ) : null}
        <Button type="button" size="icon-sm" variant="outline" onClick={onClose} disabled={isSaving} aria-label="취소" title="취소">
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          onClick={() => void (isEditMode ? updateMutation.mutateAsync() : createMutation.mutateAsync())}
          disabled={!canSave || isSaving}
          aria-label={isEditMode ? '연결 저장' : '연결 생성 저장'}
          title={isEditMode ? '연결 저장' : '연결 생성 저장'}
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
      title={isEditMode ? `${section.heading} 수정` : `${section.heading} 추가`}
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
              if (window.confirm(`프리셋 '${preset.name}' 을(를) 삭제할까?`)) {
                void onDelete(preset)
              }
            }}
            aria-label="프리셋 삭제"
            title="프리셋 삭제"
          >
            {isDeleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        ) : null}
        <Button type="button" size="icon-sm" variant="outline" onClick={onClose} disabled={isSaving || isDeleting} aria-label="취소" title="취소">
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          onClick={() => void onSave(draft)}
          disabled={!canSave || isSaving || isDeleting}
          aria-label={preset ? '프리셋 저장' : `${section.fieldLabel} 저장`}
          title={preset ? '프리셋 저장' : `${section.fieldLabel} 저장`}
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
        throw new Error('프리셋 종류를 먼저 선택해줘.')
      }

      const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === presetType)
      const currentPresets = llmPresetCollections[presetType]
      const normalizedName = draft.name.trim()
      if (!normalizedName) {
        throw new Error('프리셋 이름이 필요해.')
      }

      let content = draft.content
      if (section?.expectsJson) {
        try {
          content = normalizePresetJson(draft.content)
        } catch {
          throw new Error('구조화 출력 JSON 양식이 올바른 JSON이 아니야.')
        }
      }

      if (!content.trim()) {
        throw new Error('프리셋 내용이 비어 있어.')
      }

      const duplicate = currentPresets.find((preset) => preset.id !== draft.id && preset.name.trim().toLowerCase() === normalizedName.toLowerCase())
      if (duplicate) {
        throw new Error(`같은 이름의 프리셋이 이미 있어: ${duplicate.name}`)
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
      showSnackbar({ message: 'LLM 프리셋을 저장했어.', tone: 'info' })
      setPresetModalState(null)
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : 'LLM 프리셋 저장에 실패했어.',
        tone: 'error',
      })
    },
  })

  const deletePresetMutation = useMutation({
    mutationFn: async (preset: LlmPresetRecord) => {
      const presetType = presetModalState?.presetType
      if (!presetType) {
        throw new Error('프리셋 종류를 먼저 선택해줘.')
      }

      const nextPresets = llmPresetCollections[presetType].filter((entry) => entry.id !== preset.id)
      return await updateLlmSettings({ [presetType]: nextPresets } as Partial<LlmSettings>)
    },
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      void queryClient.invalidateQueries({ queryKey: ['llm-preset-options'] })
      showSnackbar({ message: 'LLM 프리셋을 삭제했어.', tone: 'info' })
      setPresetModalState(null)
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : 'LLM 프리셋 삭제에 실패했어.',
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
        heading="LLM 연결"
        actions={
          <Button
            type="button"
            size="icon-sm"
            onClick={() => setConnectionModalState({ mode: 'create' })}
            aria-label="연결 추가"
            title="연결 추가"
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
          <div className="px-4 py-6 text-sm text-muted-foreground">연결된 LLM이 아직 없어.</div>
        ) : (
          <SettingsResourceTable
            gridClassName={LLM_CONNECTIONS_TABLE_GRID}
            minWidthClassName="min-w-[1200px]"
            headers={['연결', 'Base URL', '기본 모델', '온도', '최대 토큰', '활성', '']}
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
            heading={section.heading}
            actions={
              <Button
                type="button"
                size="icon-sm"
                onClick={() => setPresetModalState({ mode: 'create', presetType: section.key })}
                aria-label={section.addLabel}
                title={section.addLabel}
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
              <div className="px-4 py-6 text-sm text-muted-foreground">{section.emptyMessage}</div>
            ) : (
              <SettingsResourceTable
                gridClassName={LLM_PRESETS_TABLE_GRID}
                minWidthClassName="min-w-[980px]"
                headers={['이름', section.fieldLabel, '수정', '']}
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

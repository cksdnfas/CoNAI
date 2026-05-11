import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FlaskConical, LoaderCircle, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createExternalApiProvider,
  deleteExternalApiProvider,
  testExternalApiProvider,
  updateExternalApiProvider,
  type ExternalApiProviderRecord,
  type ExternalApiProviderType,
} from '@/lib/api-external-api'
import type { LlmPresetRecord } from '@/types/settings'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { SettingsModal } from './settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsToggleRow } from './settings-primitives'
import { SettingsResourceTableRow, SettingsStatusIcon } from './settings-resource-shared'
import {
  LLM_CONNECTIONS_TABLE_GRID,
  LLM_PRESETS_TABLE_GRID,
  LLM_PRESET_SECTIONS,
  LLM_PROVIDER_OPTIONS,
  buildAdditionalConfig,
  buildEmptyDraft,
  buildEmptyPresetDraft,
  buildPresetDraft,
  buildProviderDraft,
  buildProviderPlaceholder,
  formatPresetUpdatedAt,
  getBaseUrlSummary,
  getDefaultMaxTokensSummary,
  getDefaultModelSummary,
  getDefaultTemperatureSummary,
  summarizePresetValue,
  type LlmConnectionDraft,
  type LlmConnectionModalState,
  type LlmPresetDraft,
  type LlmPresetModalState,
} from './llm-connections-tab-utils'

export function LlmConnectionListItem({
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

export function LlmPresetListItem({
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

export function LlmConnectionEditorModal({
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

export function LlmPresetEditorModal({
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

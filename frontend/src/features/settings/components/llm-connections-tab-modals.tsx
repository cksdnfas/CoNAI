import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText, FlaskConical, LoaderCircle, Plug, TriangleAlert } from 'lucide-react'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createExternalApiProvider,
  deleteExternalApiProvider,
  listExternalApiLlmModels,
  testExternalApiProvider,
  updateExternalApiProvider,
  type ExternalApiProviderRecord,
  type ExternalApiProviderType,
} from '@/lib/api-external-api'
import { MODEL_SLOTS_QUERY_KEY, listModelSlots, setDefaultModelSlot, syncConnectionModels } from '@/lib/api-codex-chat'
import type { LlmPresetRecord } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Modal, ModalBody } from '@/components/ui/modal'
import { SettingRow } from '@/components/ui/setting-row'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { ResourceRow, ResourceRowStatus } from '@/components/ui/resource-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { ConnectionModelChecklist, type ConnectionModelsDraft } from './llm-connection-models'
import {
  LLM_PRESET_SECTIONS,
  LLM_PROVIDER_OPTIONS,
  TYPESAFE_ENDPOINTS,
  buildAdditionalConfig,
  buildEmptyDraft,
  buildEmptyPresetDraft,
  buildPresetDraft,
  buildProviderDraft,
  buildProviderPlaceholder,
  getBaseUrlSummary,
  type LlmConnectionDraft,
  type LlmConnectionModalState,
  type LlmPresetDraft,
  type LlmPresetModalState,
  type LlmThinkingSwitch,
  LLM_THINKING_SWITCHES,
} from './llm-connections-tab-utils'
import { cn } from '@/lib/utils'

/** A connection (server) row; its models are listed under it. */
export function LlmConnectionListItem({
  provider,
  modelCount,
  onOpenOptions,
}: {
  provider: ExternalApiProviderRecord
  modelCount: number
  onOpenOptions: (provider: ExternalApiProviderRecord) => void
}) {
  const { t } = useI18n()
  const notSetLabel = t('llmConnectionsTab.notSet')
  const baseUrlSummary = getBaseUrlSummary(provider, notSetLabel)
  const kind = LLM_PROVIDER_OPTIONS.find((option) => option.value === provider.provider_type)

  return (
    <ResourceRow
      leading={<Plug />}
      name={provider.display_name || provider.provider_name}
      extra={(
        <>
          {kind ? <Tip content={baseUrlSummary === notSetLabel ? null : baseUrlSummary}><span><Chip size="sm" tone="muted">{t(kind.shortLabel)}</Chip></span></Tip> : null}
          {baseUrlSummary === notSetLabel ? <ResourceRowStatus>{notSetLabel}</ResourceRowStatus> : null}
          {provider.is_enabled ? null : <ResourceRowStatus>{t({ ko: '비활성', en: 'Inactive' })}</ResourceRowStatus>}
          {modelCount === 0 ? <ResourceRowStatus>{t({ ko: '모델 없음', en: 'No models' })}</ResourceRowStatus> : null}
        </>
      )}
      onOpen={() => onOpenOptions(provider)}
    />
  )
}

export function LlmPresetListItem({
  preset,
  onOpenOptions,
}: {
  preset: LlmPresetRecord
  onOpenOptions: (preset: LlmPresetRecord) => void
}) {
  return (
    <ResourceRow
      leading={<FileText />}
      name={preset.name}
      onOpen={() => onOpenOptions(preset)}
    />
  )
}

const EMPTY_MODELS: string[] = []

/** `value` after it has stayed unchanged for `delayMs`, so typing a URL does not probe the server on every keystroke. */
function useSettledValue<T>(value: T, delayMs: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, value])
  return settled
}

/** How each way of turning thinking off reads in the select and in the test's note. */
function thinkingSwitchLabel(option: LlmThinkingSwitch, t: ReturnType<typeof useI18n>['t']) {
  return option === 'reasoning_effort' ? 'reasoning_effort: none' : option === 'enable_thinking' ? 'enable_thinking: false' : t({ ko: '보내지 않음', en: 'Send nothing' })
}

function LlmConnectionFormFields({
  draft,
  mode,
  apiKeyMasked,
  onChange,
  onEndpointModel,
  sharedServer = [],
  thinkingChanged = null,
}: {
  draft: LlmConnectionDraft
  mode: 'create' | 'edit'
  apiKeyMasked?: string
  onChange: (patch: Partial<LlmConnectionDraft>) => void
  /** A TypeSafe endpoint was picked: its model should be among the connection's models. */
  onEndpointModel: (model: string) => void
  /** Profiles whose reply and judge or translation both go to this connection. */
  sharedServer?: Array<{ name: string }>
  /** The connection test replaced the way of turning thinking off: the way it replaced. */
  thinkingChanged?: LlmThinkingSwitch | null
}) {
  const { t } = useI18n()
  // One slot shared by the reply and its judge or translation: each pushes the other's prompt out of the cache.
  const sharedSlot = (Number(draft.concurrentRequests) || 1) === 1 && sharedServer.length > 0

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('llmConnectionsTab.connectionName')}>
          <Input
            variant="settings"
            value={draft.providerName}
            onChange={(event) => onChange({ providerName: event.target.value, displayName: event.target.value })}
            placeholder={t({ ko: '예: lmstudio-local', en: 'e.g. lmstudio-local' })}
            readOnly={mode === 'edit'}
            disabled={mode === 'edit'}
          />
        </Field>

        <Field label={t('llmConnectionsTab.connectionType')}>
          <Select
            variant="settings"
            value={draft.providerType}
            onChange={(event) => {
              const providerType = event.target.value as ExternalApiProviderType
              // A new judge connection starts on TypeSafe's own address and model.
              const typesafe = providerType === 'decision_typesafe' ? TYPESAFE_ENDPOINTS[0] : null
              onChange({ providerType, ...(typesafe && !draft.baseUrl.trim() ? { baseUrl: typesafe.baseUrl } : {}) })
              if (typesafe) onEndpointModel(typesafe.model)
            }}
          >
            {LLM_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.label)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t({ ko: '기본 URL', en: 'Base URL' })}>
        <div className="flex items-center gap-2">
          <Input
            variant="settings"
            value={draft.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder={buildProviderPlaceholder(draft.providerType)}
          />
          {draft.providerType === 'decision_typesafe' ? (
            <div className="flex shrink-0 gap-1">
              {TYPESAFE_ENDPOINTS.map((endpoint) => (
                <ToggleChip
                  key={endpoint.label}
                  size="sm"
                  pressed={draft.baseUrl.trim().replace(/\/+$/, '') === endpoint.baseUrl}
                  onClick={() => {
                    onChange({ baseUrl: endpoint.baseUrl })
                    onEndpointModel(endpoint.model)
                  }}
                >
                  {endpoint.label}
                </ToggleChip>
              ))}
            </div>
          ) : null}
        </div>
      </Field>

      <Field label={draft.providerType === 'decision_typesafe' ? t({ ko: 'API 키', en: 'API key' }) : t('llmConnectionsTab.apiKeyOptional')}>
        <Input
          variant="settings"
          type="password"
          value={draft.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder={draft.providerType === 'llm_ollama' ? t('llmConnectionsTab.usuallySafeToLeaveBlank') : apiKeyMasked || t('llmConnectionsTab.enterANewApiKey')}
        />
      </Field>

      <EditorGroup label={t({ ko: '요청', en: 'Requests' })}>
        <div>
          <SettingRow label={t({ ko: '제한 시간 (초)', en: 'Time limit (s)' })}>
            <NumberStepperInput
              variant="settings"
              className="w-36"
              allowEmpty
              step={30}
              min={5}
              value={draft.timeoutSeconds}
              onValueCommit={(value) => onChange({ timeoutSeconds: value })}
              aria-label={t({ ko: '제한 시간 (초)', en: 'Time limit (s)' })}
              placeholder={draft.providerType === 'decision_typesafe' ? '20' : '600'}
            />
          </SettingRow>
          {draft.providerType === 'decision_typesafe' ? null : (
            <>
              <SettingRow label={t({ ko: '동시 요청', en: 'Concurrent requests' })}>
                <div className="flex items-center gap-2">
                {sharedSlot ? (
                  <Tip content={t({ ko: '이 연결로 대화와 판단·번역을 같이 하는 프로필이 있어: {names}. 동시 요청 1이면 서로 캐시를 밀어내서 답변마다 프롬프트를 처음부터 다시 읽어. 서버를 슬롯 2개 이상으로 띄우고 여기 숫자를 맞춰.', en: 'Profiles send both their reply and their judge or translation here: {names}. With one request at a time they push each other out of the cache, so every reply reads its whole prompt again. Run the server with two or more slots and match this number.' }, { names: sharedServer.map((profile) => profile.name).join(', ') })} side="top">
                    <span className="text-warning" aria-label={t({ ko: '대화와 판단이 같은 슬롯을 써', en: 'Reply and judge share one slot' })}><TriangleAlert className="size-4" aria-hidden /></span>
                  </Tip>
                ) : null}
                <NumberStepperInput
                  variant="settings"
                  className="w-36"
                  step={1}
                  min={1}
                  max={8}
                  value={draft.concurrentRequests}
                  onValueCommit={(value) => onChange({ concurrentRequests: value })}
                  aria-label={t({ ko: '동시 요청', en: 'Concurrent requests' })}
                />
                </div>
              </SettingRow>
              <SettingRow label={thinkingChanged ? (
                <span className="flex items-center gap-2">
                  {t({ ko: '생각 끄는 방법', en: 'Turning thinking off' })}
                  <Tip content={t({ ko: '연결 테스트에서 바꿨어. {previous} 방식으론 생각이 안 꺼졌어. 저장해야 적용돼.', en: 'Changed by the connection test: {previous} did not turn thinking off. Save to apply.' }, { previous: thinkingSwitchLabel(thinkingChanged, t) })} side="top">
                    <span className="size-1.5 rounded-full bg-primary" aria-label={t({ ko: '연결 테스트에서 바꿈', en: 'Changed by the test' })} />
                  </Tip>
                </span>
              ) : t({ ko: '생각 끄는 방법', en: 'Turning thinking off' })}>
                <Select
                  variant="settings"
                  className={cn('w-56 font-mono text-xs', thinkingChanged && 'ring-1 ring-primary')}
                  aria-label={t({ ko: '생각 끄는 방법', en: 'Turning thinking off' })}
                  value={draft.thinkingSwitch}
                  onChange={(event) => onChange({ thinkingSwitch: event.target.value as LlmThinkingSwitch })}
                >
                  {LLM_THINKING_SWITCHES.map((option) => <option key={option} value={option}>{thinkingSwitchLabel(option, t)}</option>)}
                </Select>
              </SettingRow>
            </>
          )}
          {draft.providerType === 'llm_openai_compatible' ? (
            <SettingsSwitchRow
              checked={draft.promptCacheMarks}
              onCheckedChange={(checked) => onChange({ promptCacheMarks: checked })}
              label={t({ ko: '프롬프트 캐시 표시', en: 'Prompt cache marks' })}
              info={t({ ko: 'Anthropic 모델을 거치는 프록시일 때 켜.', en: 'Turn on for a proxy in front of Anthropic models.' })}
            />
          ) : null}
        </div>
      </EditorGroup>
    </div>
  )
}

function LlmPresetFormFields({
  draft,
  section,
  onChange,
}: {
  draft: LlmPresetDraft
  section: (typeof LLM_PRESET_SECTIONS)[number]
  onChange: (patch: Partial<LlmPresetDraft>) => void
}) {
  const { t } = useI18n()

  return (
    <div className="grid gap-4">
      <Field label={t('llmConnectionsTab.presetName')}>
        <Input
          variant="settings"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={t({ ko: '예: item-summary-json', en: 'e.g. item-summary-json' })}
        />
      </Field>

      <Field label={t(section.fieldLabel)}>
        <Textarea
          variant="settings"
          rows={section.expectsJson ? 10 : 8}
          value={draft.content}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder={t(section.placeholder)}
          className={section.mono ? 'font-mono text-xs' : undefined}
        />
      </Field>
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
  const confirm = useConfirm()
  const isOpen = state !== null
  const isEditMode = state?.mode === 'edit'
  const provider = state?.mode === 'edit' ? state.provider : null
  const [draft, setDraft] = useState<LlmConnectionDraft>(() => (provider ? buildProviderDraft(provider) : buildEmptyDraft()))
  /** The way of turning thinking off the connection test replaced (until the editor closes). */
  const [thinkingChanged, setThinkingChanged] = useState<LlmThinkingSwitch | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setDraft(provider ? buildProviderDraft(provider) : buildEmptyDraft())
    setThinkingChanged(null)
  }, [isOpen, provider])

  // The server's model list follows the URL, key and type being edited; a saved key is reused when none is typed.
  const probe = useSettledValue(
    { providerType: draft.providerType, baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey, providerName: provider?.provider_name ?? '' },
    600,
  )
  const modelsQuery = useQuery({
    queryKey: ['llm-connection-models', probe.providerType, probe.baseUrl, probe.apiKey, probe.providerName],
    queryFn: () => listExternalApiLlmModels({
      provider_type: probe.providerType,
      base_url: probe.baseUrl,
      api_key: probe.apiKey || undefined,
      provider_name: probe.providerName || undefined,
    }),
    enabled: isOpen && probe.providerType !== 'general' && probe.baseUrl.length > 0,
    retry: false,
    staleTime: 60_000,
  })
  const models = modelsQuery.data ?? EMPTY_MODELS

  // The connection's models: its saved rows when editing; a new connection starts on the first model the server lists.
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: isOpen })
  const saved = (slotsQuery.data ?? []).filter((slot) => provider !== null && slot.providerName === provider.provider_name)
  const [modelDraft, setModelDraft] = useState<ConnectionModelsDraft>({ models: [], defaultModel: '' })
  const modelsTouched = useRef(false)
  const modelsLoadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!isOpen) {
      modelsLoadedFor.current = null
      return
    }
    const key = provider?.provider_name ?? ''
    if (modelsLoadedFor.current === key || (provider && !slotsQuery.isSuccess)) return
    modelsLoadedFor.current = key
    modelsTouched.current = false
    setModelsChanged(false)
    setModelDraft({ models: saved.map((slot) => slot.model), defaultModel: saved.find((slot) => slot.isDefault)?.model ?? '' })
    // Runs once per opened connection, when its rows are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, provider, slotsQuery.isSuccess])
  useEffect(() => {
    if (!isOpen || models.length === 0 || modelsTouched.current) return
    setModelDraft((current) => (current.models.length > 0 ? current : { ...current, models: [models[0]] }))
  }, [isOpen, models])
  const [modelsChanged, setModelsChanged] = useState(false)
  const changeModels = (next: ConnectionModelsDraft) => {
    modelsTouched.current = true
    setModelsChanged(true)
    setModelDraft(next)
  }
  const addEndpointModel = (model: string) => setModelDraft((current) => (current.models.includes(model) ? current : { ...current, models: [...current.models, model] }))

  /** After the connection itself is saved: its models become exactly the checked ones, and a starred one the default. */
  const saveModels = async (providerName: string) => {
    const rows = await syncConnectionModels(providerName, modelDraft.models)
    const starred = rows.find((slot) => slot.model === modelDraft.defaultModel)
    if (starred && !starred.isDefault) await setDefaultModelSlot(starred.id)
  }

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
      await saveModels(draft.providerName)
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
      await saveModels(provider.provider_name)
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
      // The test also checks the way of turning thinking off; one that does not work is replaced in the draft.
      const found = result.thinking?.found
      if (result.success && found && found !== draft.thinkingSwitch) {
        setThinkingChanged(draft.thinkingSwitch)
        setDraft((current) => ({ ...current, thinkingSwitch: found }))
        showSnackbar({ message: t({ ko: '연결 확인 · 생각 끄는 방법을 바꿨어', en: 'Connected · changed the way thinking is turned off' }), tone: 'info' })
        return
      }
      if (result.success && result.thinking && found === null) {
        showSnackbar({ message: t({ ko: '연결 확인 · 생각을 끄는 방법은 찾지 못했어', en: 'Connected · no way to turn thinking off was found' }), tone: 'info' })
        return
      }
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
  const savedDraft = useMemo(() => (provider ? buildProviderDraft(provider) : buildEmptyDraft()), [provider])
  const dirty = isOpen && (modelsChanged || JSON.stringify(draft) !== JSON.stringify(savedDraft))
  const canSave = draft.providerName.trim().length > 0 && draft.baseUrl.trim().length > 0 && (dirty || !isEditMode) && !isSaving
  const save = () => (isEditMode ? updateMutation.mutate() : createMutation.mutate())

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={isEditMode ? t('llmConnectionsTab.editLlmConnection') : t('llmConnectionsTab.addLlmConnection')}
      size="normal"
      height="tall"
      dirty={dirty}
      onSave={canSave ? save : undefined}
      headerActions={(
        <Tip content={draft.isEnabled ? t({ ko: '사용 중', en: 'On' }) : t({ ko: '꺼짐', en: 'Off' })}>
          <span className="inline-flex px-1.5">
            <Switch checked={draft.isEnabled} onCheckedChange={(isEnabled) => setDraft((current) => ({ ...current, isEnabled }))} aria-label={t({ ko: '연결 사용', en: 'Connection on' })} />
          </span>
        </Tip>
      )}
    >
      <ModalBody>
        <div className="space-y-4">
          <LlmConnectionFormFields
            draft={draft}
            mode={isEditMode ? 'edit' : 'create'}
            apiKeyMasked={provider?.api_key_masked}
            onChange={(patch) => {
              if (patch.thinkingSwitch !== undefined) setThinkingChanged(null)
              setDraft((current) => ({ ...current, ...patch }))
            }}
            onEndpointModel={addEndpointModel}
            sharedServer={saved[0]?.sharedServer}
            thinkingChanged={thinkingChanged}
          />
          <ConnectionModelChecklist
            value={modelDraft}
            listed={models}
            saved={saved}
            loading={modelsQuery.isFetching}
            canStar={draft.providerType !== 'decision_typesafe'}
            onRefresh={() => void modelsQuery.refetch()}
            onChange={changeModels}
          />
        </div>
      </ModalBody>

      <EditorFooter
        onDelete={provider ? () => void (async () => {
          const confirmed = await confirm({
            title: t({ ko: '연결 삭제', en: 'Delete connection' }),
            description: t({ ko: "연결 '{providerName}' 을(를) 삭제할까?", en: "Delete connection '{providerName}'?" }, { providerName: provider.provider_name }),
            confirmLabel: t({ ko: '삭제', en: 'Delete' }),
            tone: 'destructive',
          })
          if (confirmed) deleteMutation.mutate()
        })() : undefined}
        deleteLabel={t('llmConnectionsTab.deleteConnection')}
        deleting={deleteMutation.isPending}
        onSave={save}
        canSave={canSave}
        saving={isSaving}
        saveLabel={isEditMode ? t('llmConnectionsTab.saveConnection') : t('llmConnectionsTab.createAndSaveConnection')}
      >
        {isEditMode ? (
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || isSaving}
            label={t('llmConnectionsTab.testConnection')}
          >
            {testMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          </IconButton>
        ) : null}
      </EditorFooter>
    </Modal>
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
  const confirm = useConfirm()
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

  const savedDraft = useMemo(() => (preset ? buildPresetDraft(preset) : buildEmptyPresetDraft(presetType)), [preset, presetType])
  const dirty = isOpen && JSON.stringify(draft) !== JSON.stringify(savedDraft)
  const canSave = draft.name.trim().length > 0 && (dirty || !isEditMode) && !isSaving && !isDeleting

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={isEditMode ? t({ ko: '{heading} 수정', en: 'Edit {heading}' }, { heading: t(section.heading) }) : t({ ko: '{heading} 추가', en: 'Add {heading}' }, { heading: t(section.heading) })}
      size="narrow"
      dirty={dirty}
      onSave={canSave ? () => void onSave(draft) : undefined}
    >
      <ModalBody>
        <LlmPresetFormFields
          draft={draft}
          section={section}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </ModalBody>

      <EditorFooter
        onDelete={preset ? () => void (async () => {
          const confirmed = await confirm({
            title: t({ ko: '프리셋 삭제', en: 'Delete preset' }),
            description: t({ ko: "프리셋 '{presetName}' 을(를) 삭제할까?", en: "Delete preset '{presetName}'?" }, { presetName: preset.name }),
            confirmLabel: t({ ko: '삭제', en: 'Delete' }),
            tone: 'destructive',
          })
          if (confirmed) void onDelete(preset)
        })() : undefined}
        deleteLabel={t('llmConnectionsTab.deletePreset')}
        deleting={isDeleting}
        onSave={() => void onSave(draft)}
        canSave={canSave}
        saving={isSaving}
        saveLabel={preset ? t('llmConnectionsTab.savePreset') : t({ ko: '{fieldLabel} 저장', en: 'Save {fieldLabel}' }, { fieldLabel: t(section.fieldLabel) })}
      />
    </Modal>
  )
}

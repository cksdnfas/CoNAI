import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { MODEL_SLOTS_QUERY_KEY, MODEL_USAGE_QUERY_KEY, getModelUsage, listModelSlots, setDefaultModelSlot, type ModelSlot } from '@/lib/api-codex-chat'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getExternalApiProviders } from '@/lib/api-external-api'
import { getAppSettings } from '@/lib/api-settings-general'
import { updateLlmSettings } from '@/lib/api-settings-llm'
import type { LlmPresetRecord, LlmSettings } from '@conai/shared'
import { useI18n } from '@/i18n'
import { RowGroup } from '@/components/ui/row-group'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import {
  LlmConnectionEditorModal,
  LlmConnectionListItem,
  LlmPresetEditorModal,
  LlmPresetListItem,
} from './llm-connections-tab-modals'
import {
  ModelSlotEditorModal,
  ModelSlotListItem,
  useRefreshModelSlots,
  type ModelSlotModalState,
} from './llm-model-slots'
import {
  LLM_PRESET_SECTIONS,
  normalizePresetJson,
  type LlmConnectionModalState,
  type LlmPresetDraft,
  type LlmPresetModalState,
} from './llm-connections-tab-utils'

export function LlmConnectionsTab() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [connectionModalState, setConnectionModalState] = useState<LlmConnectionModalState>(null)
  const [presetModalState, setPresetModalState] = useState<LlmPresetModalState>(null)
  const [slotModalState, setSlotModalState] = useState<ModelSlotModalState>(null)
  const refreshModelSlots = useRefreshModelSlots()

  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots })
  const usageQuery = useQuery({ queryKey: MODEL_USAGE_QUERY_KEY, queryFn: getModelUsage })
  const setDefaultMutation = useMutation({
    mutationFn: (slot: ModelSlot) => setDefaultModelSlot(slot.id),
    onSuccess: () => refreshModelSlots(),
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '기본 모델을 바꾸지 못했어.', en: 'Could not change the default model.' }), tone: 'error' })
    },
  })

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
      queryClient.invalidateQueries({ queryKey: MODEL_USAGE_QUERY_KEY }),
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
    <div className="space-y-8">
      <RowGroup
        heading={t({ ko: '모델', en: 'Models' })}
        count={slotsQuery.isSuccess ? slotsQuery.data.length : undefined}
        actions={
          <IconButton size="icon-sm" variant="ghost" onClick={() => setSlotModalState({ mode: 'create' })} label={t({ ko: '모델 추가', en: 'Add model' })}>
            <Plus className="h-4 w-4" />
          </IconButton>
        }
      >
        {slotsQuery.isLoading ? (
          <SettingsRowsSkeleton rows={2} />
        ) : (slotsQuery.data ?? []).length === 0 ? (
          <SettingsEmptyRow>{t({ ko: '아직 모델이 없어.', en: 'No models yet.' })}</SettingsEmptyRow>
        ) : (
          (slotsQuery.data ?? []).map((slot) => (
            <ModelSlotListItem
              key={slot.id}
              slot={slot}
              providers={llmProviders}
              workflowNodes={usageQuery.data?.slots.find((entry) => entry.id === slot.id)?.workflowNodes ?? 0}
              settingDefault={setDefaultMutation.isPending}
              onSetDefault={(next) => setDefaultMutation.mutate(next)}
              onOpenOptions={(next) => setSlotModalState({ mode: 'edit', slot: next })}
            />
          ))
        )}
      </RowGroup>

      <RowGroup
        heading={t('llmConnectionsTab.llmConnections')}
        count={providersQuery.isSuccess ? llmProviders.length : undefined}
        actions={
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={() => setConnectionModalState({ mode: 'create' })}
            label={t('llmConnectionsTab.addConnection')}
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        }
      >
        {providersQuery.isLoading ? (
          <SettingsRowsSkeleton rows={3} />
        ) : llmProviders.length === 0 ? (
          <SettingsEmptyRow>{t({ ko: '연결된 LLM이 아직 없어.', en: 'No connected LLMs yet.' })}</SettingsEmptyRow>
        ) : (
          llmProviders.map((provider) => (
            <LlmConnectionListItem
              key={provider.id}
              provider={provider}
              usage={usageQuery.data?.connections.find((entry) => entry.providerName === provider.provider_name)}
              onOpenOptions={(nextProvider) => setConnectionModalState({ mode: 'edit', provider: nextProvider })}
            />
          ))
        )}
      </RowGroup>

      {LLM_PRESET_SECTIONS.map((section) => {
        const presets = llmPresetCollections[section.key]

        return (
          <RowGroup
            key={section.key}
            heading={t(section.heading)}
            count={settingsQuery.isSuccess ? presets.length : undefined}
            actions={
              <IconButton
                size="icon-sm"
                variant="ghost"
                onClick={() => setPresetModalState({ mode: 'create', presetType: section.key })}
                label={t(section.addLabel)}
              >
                <Plus className="h-4 w-4" />
              </IconButton>
            }
          >
            {settingsQuery.isLoading ? (
              <SettingsRowsSkeleton rows={2} />
            ) : presets.length === 0 ? (
              <SettingsEmptyRow>{t(section.emptyMessage)}</SettingsEmptyRow>
            ) : (
              presets.map((preset) => (
                <LlmPresetListItem
                  key={preset.id}
                  preset={preset}
                  onOpenOptions={(nextPreset) => setPresetModalState({ mode: 'edit', presetType: section.key, preset: nextPreset })}
                />
              ))
            )}
          </RowGroup>
        )
      })}

      <ModelSlotEditorModal state={slotModalState} providers={llmProviders} onClose={() => setSlotModalState(null)} />

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

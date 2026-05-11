import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getExternalApiProviders } from '@/lib/api-external-api'
import { getAppSettings, updateLlmSettings } from '@/lib/api-settings'
import type { LlmPresetRecord, LlmSettings } from '@/types/settings'
import { useI18n } from '@/i18n'
import { SettingsSection } from './settings-primitives'
import { SettingsResourceTable } from './settings-resource-shared'
import {
  LlmConnectionEditorModal,
  LlmConnectionListItem,
  LlmPresetEditorModal,
  LlmPresetListItem,
} from './llm-connections-tab-modals'
import {
  LLM_CONNECTIONS_TABLE_GRID,
  LLM_PRESETS_TABLE_GRID,
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

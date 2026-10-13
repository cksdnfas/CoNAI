import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Plus } from 'lucide-react'
import type { LlmPresetRecord, LlmSettings } from '@conai/shared'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { getAppSettings } from '@/lib/api-settings-general'
import { updateLlmSettings } from '@/lib/api-settings-llm'
import { LlmPresetEditorModal } from './llm-connections-tab-modals'
import { LLM_PRESET_SECTIONS, normalizePresetJson, type LlmPresetDraft, type LlmPresetModalState } from './llm-connections-tab-utils'
import { useLlmPromptPresetsChatPage } from './use-llm-connections-chat-page'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'

/**
 * Settings › LLM › 프롬프트: the text presets workflow LLM nodes pick from (system prompts, prompts, structured output
 * JSON templates), one list with a kind chip per row.
 */
export function LlmPromptPresets() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [modalState, setModalState] = useState<LlmPresetModalState>(null)
  const settingsQuery = useQuery({ queryKey: ['app-settings'], queryFn: getAppSettings })
  const collections = settingsQuery.data?.llm ?? { systemPromptPresets: [], promptPresets: [], structuredOutputJsonPresets: [] }
  useLlmPromptPresetsChatPage(collections)

  const onSaved = (settings: Awaited<ReturnType<typeof updateLlmSettings>>, message: string) => {
    queryClient.setQueryData(['app-settings'], settings)
    void queryClient.invalidateQueries({ queryKey: ['llm-preset-options'] })
    showSnackbar({ message, tone: 'info' })
    setModalState(null)
  }

  const saveMutation = useMutation({
    mutationFn: async (draft: LlmPresetDraft) => {
      const presetType = modalState?.presetType
      if (!presetType) throw new Error(t('llmConnectionsTab.selectAPresetTypeFirst'))
      const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === presetType)
      const current = collections[presetType]
      const name = draft.name.trim()
      if (!name) throw new Error(t('llmConnectionsTab.presetNameIsRequired'))
      let content = draft.content
      if (section?.expectsJson) {
        try {
          content = normalizePresetJson(draft.content)
        } catch {
          throw new Error(t('llmConnectionsTab.structuredOutputJsonTemplateIs'))
        }
      }
      if (!content.trim()) throw new Error(t('llmConnectionsTab.presetContentIsEmpty'))
      const duplicate = current.find((preset) => preset.id !== draft.id && preset.name.trim().toLowerCase() === name.toLowerCase())
      if (duplicate) throw new Error(t({ ko: '같은 이름의 프리셋이 이미 있어: {presetName}', en: 'A preset with this name already exists: {presetName}' }, { presetName: duplicate.name }))
      const existing = current.find((preset) => preset.id === draft.id) ?? null
      const now = new Date().toISOString()
      const record: LlmPresetRecord = { id: existing?.id ?? draft.id, name, content, createdAt: existing?.createdAt ?? draft.createdAt ?? now, updatedAt: now }
      const next = existing ? current.map((preset) => (preset.id === existing.id ? record : preset)) : [...current, record]
      return await updateLlmSettings({ [presetType]: next } as Partial<LlmSettings>)
    },
    onSuccess: (settings) => onSaved(settings, t('llmConnectionsTab.llmPresetSaved')),
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToSaveLlmPreset'), tone: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (preset: LlmPresetRecord) => {
      const presetType = modalState?.presetType
      if (!presetType) throw new Error(t('llmConnectionsTab.selectAPresetTypeFirst'))
      return await updateLlmSettings({ [presetType]: collections[presetType].filter((entry) => entry.id !== preset.id) } as Partial<LlmSettings>)
    },
    onSuccess: (settings) => onSaved(settings, t('llmConnectionsTab.llmPresetDeleted')),
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToDeleteLlmPreset'), tone: 'error' }),
  })

  const rows = LLM_PRESET_SECTIONS.flatMap((section) => collections[section.key].map((preset) => ({ section, preset })))

  return (
    <>
      <RowGroup
        heading={t({ ko: '워크플로 프롬프트', en: 'Workflow prompts' })}
        count={settingsQuery.isSuccess ? rows.length : undefined}
        actions={(
          <IconButton size="icon-sm" variant="ghost" onClick={() => setModalState({ mode: 'create', presetType: LLM_PRESET_SECTIONS[0].key })} label={t({ ko: '프롬프트 프리셋 추가', en: 'Add prompt preset' })}>
            <Plus className="h-4 w-4" />
          </IconButton>
        )}
      >
        {settingsQuery.isLoading ? <SettingsRowsSkeleton rows={2} /> : rows.length === 0 ? (
          <SettingsEmptyRow>{t({ ko: '저장된 프롬프트 프리셋이 아직 없어.', en: 'No saved prompt presets yet.' })}</SettingsEmptyRow>
        ) : rows.map(({ section, preset }) => (
          <ResourceRow
            key={`${section.key}:${preset.id}`}
            leading={<FileText />}
            name={preset.name}
            extra={<Chip size="sm" tone="muted">{t(section.shortLabel)}</Chip>}
            onOpen={() => setModalState({ mode: 'edit', presetType: section.key, preset })}
          />
        ))}
      </RowGroup>

      <LlmPresetEditorModal
        state={modalState}
        isSaving={saveMutation.isPending}
        isDeleting={deleteMutation.isPending}
        onClose={() => setModalState(null)}
        onTypeChange={(presetType) => setModalState((current) => (current?.mode === 'create' ? { mode: 'create', presetType } : current))}
        onSave={async (draft) => { await saveMutation.mutateAsync(draft) }}
        onDelete={async (preset) => { await deleteMutation.mutateAsync(preset) }}
      />
    </>
  )
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { LlmPresetRecord, LlmSettings } from '@conai/shared'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { LLM_PRESET_OPTIONS_QUERY_KEY, updateLlmSettings } from '@/lib/api-settings-llm'
import { LLM_PRESET_SECTIONS, normalizePresetJson, type LlmPresetCollectionKey, type LlmPresetDraft } from './llm-connections-tab-utils'

/** Native editors and page assistants validate and persist the same preset collections. */
export function useLlmPresetMutations(collections: Pick<LlmSettings, LlmPresetCollectionKey>, { reportErrors = true }: { reportErrors?: boolean } = {}) {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const saved = (settings: Awaited<ReturnType<typeof updateLlmSettings>>, message: string) => {
    queryClient.setQueryData(['app-settings'], settings)
    void queryClient.invalidateQueries({ queryKey: LLM_PRESET_OPTIONS_QUERY_KEY })
    showSnackbar({ message, tone: 'info' })
  }
  const saveMutation = useMutation({
    mutationFn: async ({ kind, draft }: { kind: LlmPresetCollectionKey; draft: LlmPresetDraft }) => {
      const current = collections[kind]
      const name = draft.name.trim()
      if (!name) throw new Error(t('llmConnectionsTab.presetNameIsRequired'))
      let content = draft.content
      if (LLM_PRESET_SECTIONS.find((section) => section.key === kind)?.expectsJson) {
        try { content = normalizePresetJson(content) } catch { throw new Error(t('llmConnectionsTab.structuredOutputJsonTemplateIs')) }
      }
      if (!content.trim()) throw new Error(t('llmConnectionsTab.presetContentIsEmpty'))
      const duplicate = current.find((preset) => preset.id !== draft.id && preset.name.trim().toLowerCase() === name.toLowerCase())
      if (duplicate) throw new Error(t({ ko: '같은 이름의 프리셋이 이미 있어: {presetName}', en: 'A preset with this name already exists: {presetName}' }, { presetName: duplicate.name }))
      const existing = current.find((preset) => preset.id === draft.id)
      const now = new Date().toISOString()
      const record: LlmPresetRecord = { id: draft.id, name, content, createdAt: existing?.createdAt ?? draft.createdAt ?? now, updatedAt: now }
      const next = existing ? current.map((preset) => preset.id === existing.id ? record : preset) : [...current, record]
      return updateLlmSettings({ [kind]: next })
    },
    onSuccess: (settings) => saved(settings, t('llmConnectionsTab.llmPresetSaved')),
    onError: (error) => { if (reportErrors) showSnackbar({ message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToSaveLlmPreset'), tone: 'error' }) },
  })
  const deleteMutation = useMutation({
    mutationFn: ({ kind, id }: { kind: LlmPresetCollectionKey; id: string }) =>
      updateLlmSettings({ [kind]: collections[kind].filter((preset) => preset.id !== id) }),
    onSuccess: (settings) => saved(settings, t('llmConnectionsTab.llmPresetDeleted')),
    onError: (error) => { if (reportErrors) showSnackbar({ message: error instanceof Error ? error.message : t('llmConnectionsTab.failedToDeleteLlmPreset'), tone: 'error' }) },
  })
  return { saveMutation, deleteMutation }
}

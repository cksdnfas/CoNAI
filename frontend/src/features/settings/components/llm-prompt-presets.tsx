import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Plus } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { useI18n } from '@/i18n'
import { getAppSettings } from '@/lib/api-settings-general'
import { LlmPresetEditorModal } from './llm-preset-editor-modal'
import { LLM_PRESET_SECTIONS, type LlmPresetModalState } from './llm-connections-tab-utils'
import { useLlmPresetMutations } from './llm-prompt-preset-mutations'
import { useLlmPromptPresetsChatPage } from './use-llm-connections-chat-page'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'

/**
 * Settings › LLM › 프롬프트: the text presets workflow LLM nodes pick from (system prompts, prompts, structured output
 * JSON templates), one list with a kind chip per row.
 */
export function LlmPromptPresets() {
  const { t } = useI18n()
  const [modalState, setModalState] = useState<LlmPresetModalState>(null)
  const settingsQuery = useQuery({ queryKey: ['app-settings'], queryFn: getAppSettings })
  const collections = settingsQuery.data?.llm ?? { systemPromptPresets: [], promptPresets: [], structuredOutputJsonPresets: [] }
  useLlmPromptPresetsChatPage(collections)

  const { saveMutation, deleteMutation } = useLlmPresetMutations(collections)

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
          <SettingsEmptyRow>{t({ ko: '저장된 프롬프트 프리셋이 아직 없어', en: 'No saved prompt presets yet' })}</SettingsEmptyRow>
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

      {modalState ? <LlmPresetEditorModal
        state={modalState}
        isSaving={saveMutation.isPending}
        isDeleting={deleteMutation.isPending}
        onClose={() => setModalState(null)}
        onTypeChange={(presetType) => setModalState((current) => (current?.mode === 'create' ? { mode: 'create', presetType } : current))}
        onSave={(draft) => saveMutation.mutate({ kind: modalState.presetType, draft }, { onSuccess: () => setModalState(null) })}
        onDelete={(preset) => deleteMutation.mutate({ kind: modalState.presetType, id: preset.id }, { onSuccess: () => setModalState(null) })}
      /> : null}
    </>
  )
}

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus, Scale } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow, ResourceRowStatus } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { CHAT_JUDGE_PRESETS_QUERY_KEY, createChatJudgePreset, importChatJudgePresets, listChatJudgePresets, type ChatJudgePreset } from '@/lib/api-chat-judge'
import { CHAT_ADMIN_PROFILES_QUERY_KEY } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatJudgePresetEditorModal } from './chat-judge-preset-editor-modal'
import { readChatToolPresetFile } from './chat-tool-preset-file'

/** Settings › Chat › 자원: the judge presets (questions a decision model answers about each API LLM turn). */
export function ChatJudgePresetGroup() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const importRef = useRef<HTMLInputElement>(null)
  const [editor, setEditor] = useState<{ preset: ChatJudgePreset | null } | null>(null)
  const presetsQuery = useQuery({ queryKey: CHAT_JUDGE_PRESETS_QUERY_KEY, queryFn: listChatJudgePresets })
  const presets = presetsQuery.data ?? []

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_JUDGE_PRESETS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
  ])
  const importMutation = useMutation({
    mutationFn: async (file: File) => importChatJudgePresets(await readChatToolPresetFile(file)),
    onSuccess: async (created) => {
      await refresh()
      showSnackbar({ message: t({ ko: '판단 프리셋 {count}개 가져왔어. 판단 연결을 골라줘.', en: 'Imported {count} judge presets. Pick their judge connection.' }, { count: created.length }), tone: 'info' })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '판단 프리셋을 가져오지 못했어.', en: 'Could not import the judge presets.' })), tone: 'error' }),
  })
  const duplicateMutation = useMutation({
    mutationFn: (preset: ChatJudgePreset) => createChatJudgePreset({
      name: t({ ko: '{name} 복사', en: '{name} copy' }, { name: preset.name }),
      providerName: preset.providerName, model: preset.model, escalationProviderName: preset.escalationProviderName, escalationModel: preset.escalationModel,
      items: preset.items, followUp: preset.followUp,
    }),
    onSuccess: async (created) => {
      await refresh()
      setEditor({ preset: created })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '복제하지 못했어.', en: 'Could not duplicate.' })), tone: 'error' }),
  })

  return (
    <>
      <RowGroup
        headingClassName="text-resource-judge"
        heading={t({ ko: '판단 프리셋', en: 'Judge presets' })}
        count={presetsQuery.isSuccess ? presets.length : undefined}
        actions={(
          <div className="flex items-center gap-1">
            <input ref={importRef} type="file" accept=".json,application/json" className="hidden" aria-label={t({ ko: '판단 프리셋 파일', en: 'Judge preset file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) importMutation.mutate(file)
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={importMutation.isPending} onClick={() => importRef.current?.click()} label={t({ ko: 'JSON에서 가져오기', en: 'Import from JSON' })}><FileUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setEditor({ preset: null })} label={t({ ko: '판단 프리셋 추가', en: 'Add judge preset' })}><Plus /></IconButton>
          </div>
        )}
      >
        {presetsQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {presetsQuery.isSuccess && presets.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 판단 프리셋이 없어.', en: 'No judge presets yet.' })}</SettingsEmptyRow> : null}
        {presets.map((preset) => (
          <ResourceRow
            key={preset.id}
            leading={<Scale className="text-resource-judge" />}
            name={preset.name}
            meta={(
              <>
                {t({ ko: '항목 {count}', en: '{count} items' }, { count: preset.items.length })}
                {' · '}
                {preset.providerName ? <span className="font-mono">{preset.providerName}{preset.model ? ` · ${preset.model}` : ''}</span> : <ResourceRowStatus>{t({ ko: '판단 연결 없음', en: 'No judge connection' })}</ResourceRowStatus>}
                {' · '}
                {preset.profiles.length === 0
                  ? <ResourceRowStatus>{t({ ko: '연결 없음', en: 'Not linked' })}</ResourceRowStatus>
                  : <Tip content={preset.profiles.map((profile) => profile.name).join(', ')}><span>{t({ ko: '프로필 {count}', en: '{count} profiles' }, { count: preset.profiles.length })}</span></Tip>}
              </>
            )}
            onOpen={() => setEditor({ preset })}
          />
        ))}
        {presetsQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(presetsQuery.error, t({ ko: '판단 프리셋을 불러오지 못했어.', en: 'Could not load judge presets.' }))}</p> : null}
      </RowGroup>
      <ChatJudgePresetEditorModal
        open={editor !== null}
        preset={editor?.preset ?? null}
        onClose={() => setEditor(null)}
        onDuplicate={(preset) => duplicateMutation.mutate(preset)}
        duplicating={duplicateMutation.isPending}
      />
    </>
  )
}

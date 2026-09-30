import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ToggleChip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getCodexChatSettings, updateCodexChatSettings, type CodexChatScope, type CodexChatSettings } from '@/lib/api-codex-chat'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { SettingsSwitchRow } from './settings-switch-row'
import { InstantApplyHint } from './settings-section-status'
import { SETTINGS_WIDE_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

const QUERY_KEY = ['codex-chat-settings'] as const

type TranslateFn = ReturnType<typeof useI18n>['t']

function getScopeCopy(scope: CodexChatScope, t: TranslateFn) {
  switch (scope) {
    case 'read':
      return { label: t({ ko: '조회', en: 'Read' }), description: t({ ko: '이미지·프롬프트·워크플로·생성 기록을 검색하고 읽어.', en: 'Search and read images, prompts, workflows and generation history.' }) }
    case 'generate':
      return { label: t({ ko: '생성', en: 'Generate' }), description: t({ ko: 'NAI·ComfyUI·Codex 생성과 워크플로 실행을 시작하거나 취소해.', en: 'Start or cancel NAI/ComfyUI/Codex generations and workflow runs.' }) }
    case 'organize':
      return { label: t({ ko: '정리', en: 'Organize' }), description: t({ ko: '그룹을 만들고 이미지·프롬프트를 그룹에 넣거나 옮겨.', en: 'Create groups and add or move images and prompts into them.' }) }
  }
}

/** Admin settings for the Codex chat tab. Applies immediately; changing them restarts running chat sessions. */
export function CodexChatSettingsCard() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const modelListId = useId()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getCodexChatSettings })
  const modelsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000 })
  const [modelDraft, setModelDraft] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: updateCodexChatSettings,
    onSuccess: (settings: CodexChatSettings) => {
      queryClient.setQueryData(QUERY_KEY, settings)
      void queryClient.invalidateQueries({ queryKey: ['codex-chat-status'] })
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '저장하지 못했어.', en: 'Could not save.' }), tone: 'error' }),
  })

  useEffect(() => {
    setModelDraft(null)
  }, [query.data?.model])

  const settings = query.data
  const commitModel = () => {
    if (modelDraft === null || !settings || modelDraft.trim() === settings.model) {
      return
    }
    update.mutate({ model: modelDraft.trim() })
  }

  const modelLabel = t({ ko: '실행 모델', en: 'Agent model' })

  return (
    <RowGroup heading={t({ ko: 'Codex 채팅', en: 'Codex chat' })} actions={<InstantApplyHint />}>
      {query.isLoading ? <SettingsRowsSkeleton rows={3} /> : null}
      {query.isError ? <p className="py-3 text-sm text-destructive">{query.error instanceof Error ? query.error.message : t({ ko: '설정을 불러오지 못했어.', en: 'Could not load settings.' })}</p> : null}
      {settings ? (
        <>
          <SettingsSwitchRow
            checked={settings.enabled}
            disabled={update.isPending}
            onCheckedChange={(checked) => update.mutate({ enabled: checked })}
            label={t({ ko: '채팅 사용', en: 'Enable chat' })}
          />
          <SettingRow label={t({ ko: 'MCP 권한', en: 'MCP access' })}>
            <div className="flex flex-wrap gap-1.5">
              {settings.availableScopes.map((scope) => {
                const copy = getScopeCopy(scope, t)
                const pressed = settings.scopes.includes(scope)
                return (
                  <Tip key={scope} content={copy.description} side="bottom" align="start">
                    <ToggleChip
                      size="sm"
                      pressed={pressed}
                      disabled={update.isPending || (pressed && settings.scopes.length === 1)}
                      onClick={() => update.mutate({ scopes: pressed ? settings.scopes.filter((item) => item !== scope) : [...settings.scopes, scope] })}
                    >
                      {copy.label}
                    </ToggleChip>
                  </Tip>
                )
              })}
            </div>
          </SettingRow>
          <SettingRow label={modelLabel} controlClassName={SETTINGS_WIDE_CONTROL_CLASS}>
            <Input
              variant="settings"
              value={modelDraft ?? settings.model}
              onChange={(event) => setModelDraft(event.target.value)}
              onBlur={commitModel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
              list={modelListId}
              maxLength={200}
              placeholder={t({ ko: '기본값', en: 'Default' })}
              aria-label={modelLabel}
              className="min-w-0 flex-1"
            />
            <datalist id={modelListId}>
              {modelsQuery.data?.data.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </datalist>
          </SettingRow>
        </>
      ) : null}
    </RowGroup>
  )
}

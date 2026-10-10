import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { CHAT_ADMIN_SETTINGS_QUERY_KEY, CHAT_STATUS_QUERY_KEY, getChatAdminSettings, updateChatAdminSettings } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { SettingsRowsSkeleton } from './settings-rows'

/**
 * Settings › LLM › 연결: whether save_lore saves right away (기억), and what each chat answer keeps of what it was
 * sent (진단, shown from a reply's 문맥 button).
 */
export function ChatDiagnosticsSettings() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: CHAT_ADMIN_SETTINGS_QUERY_KEY, queryFn: getChatAdminSettings })
  const settingsMutation = useMutation({
    mutationFn: updateChatAdminSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(CHAT_ADMIN_SETTINGS_QUERY_KEY, settings)
      void queryClient.invalidateQueries({ queryKey: CHAT_STATUS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: ['codex-chat-thread'] })
      void queryClient.invalidateQueries({ queryKey: ['codex-chat-diagnostics'] })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const diagnostics = settingsQuery.data?.diagnostics

  return <>
    <RowGroup heading={t({ ko: '기억', en: 'Memory' })}>
      {settingsQuery.data ? (
        <SettingsSwitchRow label={t({ ko: '로어 자동 저장', en: 'Save lore automatically' })} checked={settingsQuery.data.loreAutoSave} disabled={settingsMutation.isPending}
          onCheckedChange={(loreAutoSave) => settingsMutation.mutate({ loreAutoSave })} />
      ) : settingsQuery.isError ? null : <SettingsRowsSkeleton rows={1} />}
    </RowGroup>
    <RowGroup heading={t({ ko: '진단', en: 'Diagnostics' })}>
      {diagnostics ? <>
        <SettingsSwitchRow label={t({ ko: '답변 진단', en: 'Answer diagnostics' })} checked={diagnostics.enabled} disabled={settingsMutation.isPending}
          onCheckedChange={(enabled) => settingsMutation.mutate({ diagnostics: { enabled } })} />
        <SettingsSwitchRow label={t({ ko: '원문 기록', en: 'Capture raw requests' })} checked={diagnostics.captureRaw} disabled={settingsMutation.isPending}
          onCheckedChange={(captureRaw) => settingsMutation.mutate({ diagnostics: { captureRaw } })} />
        <SettingRow label={t({ ko: '채팅당 보관', en: 'Keep per chat' })} className={!diagnostics.captureRaw ? 'opacity-60' : undefined}>
          <NumberStepperInput variant="settings" className="w-24" min={1} max={200} precision={0} value={diagnostics.captureLimit}
            aria-label={t({ ko: '채팅당 보관', en: 'Keep per chat' })} disabled={settingsMutation.isPending || !diagnostics.captureRaw}
            onValueCommit={(value) => { const captureLimit = Number(value); if (captureLimit !== diagnostics.captureLimit) settingsMutation.mutate({ diagnostics: { captureLimit } }) }} />
        </SettingRow>
      </> : settingsQuery.isError ? (
        <p className="py-3 text-sm text-destructive">{getErrorMessage(settingsQuery.error, t({ ko: '설정을 불러오지 못했어.', en: 'Could not load settings.' }))}</p>
      ) : <SettingsRowsSkeleton rows={3} />}
    </RowGroup>
  </>
}

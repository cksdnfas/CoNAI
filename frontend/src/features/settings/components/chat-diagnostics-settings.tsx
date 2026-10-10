import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LORE_KEY_LANGUAGES, LORE_KEY_LANGUAGE_MAX_LENGTH, normalizeLoreKeyLanguage } from '@conai/shared'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { CHAT_ADMIN_SETTINGS_QUERY_KEY, CHAT_STATUS_QUERY_KEY, getChatAdminSettings, updateChatAdminSettings } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { SettingsRowsSkeleton } from './settings-rows'

/**
 * Settings › LLM › 연결: whether save_lore saves right away and the lorebooks' second key language (기억), and what
 * each chat answer keeps of what it was sent (진단, shown from a reply's 문맥 button).
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
      ) : settingsQuery.isError ? null : <SettingsRowsSkeleton rows={2} />}
      {settingsQuery.data ? (
        <LoreKeyLanguageRow value={settingsQuery.data.loreKeyLanguage} disabled={settingsMutation.isPending}
          onChange={(loreKeyLanguage) => settingsMutation.mutate({ loreKeyLanguage })} />
      ) : null}
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

const CUSTOM_LANGUAGE = '\u0000custom'

/** Every lorebook's keywords: English plus this language (one list per language, both matched); none: English only. */
function LoreKeyLanguageRow({ value, disabled, onChange }: { value: string | null; disabled: boolean; onChange: (language: string | null) => void }) {
  const { t } = useI18n()
  const listed = value === null || LORE_KEY_LANGUAGES.some((item) => item.id === value)
  const [custom, setCustom] = useState(!listed)
  const [typed, setTyped] = useState(listed ? '' : value ?? '')
  useEffect(() => {
    if (!listed) { setCustom(true); setTyped(value ?? '') }
  }, [listed, value])
  const label = t({ ko: '로어북 추가 키 언어', en: 'Lorebook second key language' })
  const commitTyped = () => {
    const next = normalizeLoreKeyLanguage(typed)
    if (next && next !== value) onChange(next)
  }
  return (
    <SettingRow label={label} info={t({ ko: '모든 로어북이 영어 키에 더해 이 언어로도 키를 둬. 둘 다 대화에서 찾아.', en: 'Every lorebook keeps keywords in this language besides English; both are looked for in the chat.' })}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {custom ? <Input variant="settings" className="w-36" value={typed} maxLength={LORE_KEY_LANGUAGE_MAX_LENGTH} disabled={disabled} placeholder={t({ ko: '언어 이름', en: 'Language name' })}
          aria-label={t({ ko: '언어 이름', en: 'Language name' })} onChange={(event) => setTyped(event.target.value)} onBlur={commitTyped}
          onKeyDown={(event) => { if (event.key === 'Enter') commitTyped() }} /> : null}
        <Select variant="settings" className="w-40" value={custom ? CUSTOM_LANGUAGE : value ?? ''} disabled={disabled} aria-label={label} onChange={(event) => {
          const next = event.target.value
          setCustom(next === CUSTOM_LANGUAGE)
          if (next !== CUSTOM_LANGUAGE) onChange(next || null)
        }}>
          <option value="">{t({ ko: '없음 (영어만)', en: 'None (English only)' })}</option>
          {LORE_KEY_LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          <option value={CUSTOM_LANGUAGE}>{t({ ko: '직접 입력…', en: 'Other…' })}</option>
        </Select>
      </div>
    </SettingRow>
  )
}

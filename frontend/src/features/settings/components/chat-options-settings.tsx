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
import { getClaudeModels } from '@/lib/api-agent-cli'
import { CHAT_ADMIN_SETTINGS_QUERY_KEY, CHAT_STATUS_QUERY_KEY, getChatAdminSettings, updateChatAdminSettings, type WebResearchSettings } from '@/lib/api-codex-chat'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { SettingsRowsSkeleton } from './settings-rows'
import { useSettingsAdvanced } from './settings-advanced'

/** The chat-wide options and their save, shared by the groups below. */
function useChatOptions() {
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
  return { settingsQuery, settingsMutation }
}

/** Settings › 채팅 › 자원, by the lorebooks: whether save_lore saves right away and the lorebooks' second key language. */
export function ChatMemorySettings() {
  const { t } = useI18n()
  const { settingsQuery, settingsMutation } = useChatOptions()
  return (
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
  )
}

/** Settings › 채팅 › 자원, by the tool presets: who answers the chats' web search. */
export function ChatWebSettings() {
  const { t } = useI18n()
  const { settingsQuery, settingsMutation } = useChatOptions()
  return (
    <RowGroup heading={t({ ko: '웹 검색', en: 'Web search' })}>
      {settingsQuery.data ? (
        <WebResearchRows value={settingsQuery.data.webResearch} disabled={settingsMutation.isPending} onChange={(webResearch) => settingsMutation.mutate({ webResearch })} />
      ) : settingsQuery.isError ? null : <SettingsRowsSkeleton rows={1} />}
    </RowGroup>
  )
}

/** Settings › LLM › 연결, under the pi row: pi's codemode tool for every pi chat profile (ChatAdminSettings.piCodemode). */
export function PiCodemodeRow() {
  const { t } = useI18n()
  const { settingsQuery, settingsMutation } = useChatOptions()
  if (!settingsQuery.data) return settingsQuery.isError ? null : <SettingsRowsSkeleton rows={1} />
  return (
    <SettingsSwitchRow label={t({ ko: 'pi codemode', en: 'pi codemode' })} checked={settingsQuery.data.piCodemode} disabled={settingsMutation.isPending}
      info={t({ ko: '모든 pi 프로필의 채팅에서 모델이 짧은 스크립트로 CoNAI 도구 여러 개를 한 번에 부르고 필요한 결과만 받아. 스크립트 하나는 도구를 8번까지 불러. 작은 모델은 스크립트를 잘 못 쓸 수 있어.', en: 'In every pi profile\'s chats, the model can call several CoNAI tools in one short script and get back only what it needs. One script makes up to 8 tool calls. Small models may not write scripts well.' })}
      onCheckedChange={(piCodemode) => settingsMutation.mutate({ piCodemode })} />
  )
}

/**
 * Settings › LLM › 기록: what each chat answer keeps of what it was sent (shown from a reply's 문맥 button). Raw capture
 * and how much of it is kept are advanced.
 */
export function ChatDiagnosticsSettings() {
  const { t } = useI18n()
  const advanced = useSettingsAdvanced()
  const { settingsQuery, settingsMutation } = useChatOptions()
  const diagnostics = settingsQuery.data?.diagnostics
  return (
    <RowGroup heading={t({ ko: '진단', en: 'Diagnostics' })}>
      {diagnostics ? <>
        <SettingsSwitchRow label={t({ ko: '답변 진단', en: 'Answer diagnostics' })} checked={diagnostics.enabled} disabled={settingsMutation.isPending}
          onCheckedChange={(enabled) => settingsMutation.mutate({ diagnostics: { enabled } })} />
        {advanced ? <>
          <SettingsSwitchRow label={t({ ko: '원문 기록', en: 'Capture raw requests' })} checked={diagnostics.captureRaw} disabled={settingsMutation.isPending}
            onCheckedChange={(captureRaw) => settingsMutation.mutate({ diagnostics: { captureRaw } })} />
          <SettingRow label={t({ ko: '채팅당 보관', en: 'Keep per chat' })}>
            <NumberStepperInput variant="settings" className="w-24" min={1} max={200} precision={0} value={diagnostics.captureLimit}
              aria-label={t({ ko: '채팅당 보관', en: 'Keep per chat' })} disabled={settingsMutation.isPending || !diagnostics.captureRaw}
              onValueCommit={(value) => { const captureLimit = Number(value); if (captureLimit !== diagnostics.captureLimit) settingsMutation.mutate({ diagnostics: { captureLimit } }) }} />
          </SettingRow>
        </> : null}
      </> : settingsQuery.isError ? (
        <p className="py-3 text-sm text-destructive">{getErrorMessage(settingsQuery.error, t({ ko: '설정을 불러오지 못했어.', en: 'Could not load settings.' }))}</p>
      ) : <SettingsRowsSkeleton rows={1} />}
    </RowGroup>
  )
}

/**
 * Who answers every chat profile's web_search tool: a Codex or Claude Code run that has only its own web search. Off:
 * no profile gets the web tools. The model list is the engine's own; empty keeps its default.
 */
function WebResearchRows({ value, disabled, onChange }: { value: WebResearchSettings; disabled: boolean; onChange: (next: Partial<WebResearchSettings>) => void }) {
  const { t } = useI18n()
  const codexModels = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000, enabled: value.engine === 'codex' })
  const claudeModels = useQuery({ queryKey: ['claude-models'], queryFn: getClaudeModels, staleTime: 5 * 60 * 1000, enabled: value.engine === 'claude' })
  const models = value.engine === 'codex' ? codexModels.data?.data.models ?? [] : value.engine === 'claude' ? claudeModels.data?.models ?? [] : []
  const listed = value.model === null || models.some((model) => model.id === value.model)
  const engineLabel = t({ ko: '웹 검색 담당', en: 'Web search by' })
  const modelLabel = t({ ko: '웹 검색 모델', en: 'Web search model' })
  const limitLabel = t({ ko: '계정당 하루 검색', en: 'Searches per account a day' })
  return <>
    <SettingRow label={engineLabel}>
      <Select variant="settings" className="w-auto" aria-label={engineLabel} value={value.engine} disabled={disabled}
        onChange={(event) => onChange({ engine: event.target.value as WebResearchSettings['engine'], model: null })}>
        <option value="off">{t({ ko: '끄기', en: 'Off' })}</option>
        <option value="codex">Codex</option>
        <option value="claude">Claude Code</option>
      </Select>
    </SettingRow>
    {value.engine !== 'off' ? (
      <SettingRow label={modelLabel}>
        <Select variant="settings" className="w-auto max-w-56" aria-label={modelLabel} value={value.model ?? ''} disabled={disabled}
          onChange={(event) => onChange({ model: event.target.value || null })}>
          <option value="">{t({ ko: '기본 모델', en: 'Default model' })}</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          {!listed && value.model ? <option value={value.model}>{value.model}</option> : null}
        </Select>
      </SettingRow>
    ) : null}
    {value.engine !== 'off' ? (
      <SettingRow label={limitLabel}>
        <NumberStepperInput variant="settings" className="w-24" min={1} max={1000} precision={0} allowEmpty value={value.dailyLimit}
          placeholder={t({ ko: '제한 없음', en: 'No limit' })} aria-label={limitLabel} disabled={disabled}
          onValueCommit={(text) => { const dailyLimit = text.trim() ? Number(text) : null; if (dailyLimit !== value.dailyLimit) onChange({ dailyLimit }) }} />
      </SettingRow>
    ) : null}
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

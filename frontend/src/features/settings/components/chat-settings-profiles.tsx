import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { ResourceRow } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_ADMIN_SETTINGS_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_STATUS_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  getChatAdminSettings,
  getChatProfileDefaults,
  importChatProfileCard,
  listChatAdminProfiles,
  listModelSlots,
  updateChatAdminSettings,
  updateChatProfile,
  type ChatCardImportReport,
  type ChatProfile,
  type ChatProfileInput,
  type ModelSlot,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatProfileEditorModal } from './chat-profile-editor-modal'
import { ChatCardImportReportModal } from './chat-card-import-report'
import { InstantApplyHint } from './settings-section-status'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { SettingsSwitchRow } from './settings-switch-row'

/** `★ slot · model` when the profile uses a model slot, else the direct connection line. */
function profileModelLine(profile: ChatProfile, slots: ModelSlot[], t: ReturnType<typeof useI18n>['t']) {
  const slot = profile.modelSlotId ? slots.find((item) => item.id === profile.modelSlotId) : undefined
  if (slot) return `${slot.isDefault ? '★ ' : ''}${slot.name} · ${slot.model}`
  const model = profile.model || t({ ko: '기본 모델', en: 'default model' })
  if (profile.engine === 'claude') return `Claude Code · ${profile.model || 'sonnet'}`
  return profile.engine === 'codex' ? `Codex · ${model}` : `${profile.providerName} · ${model}`
}

/** Short chip text for the row: the model's name, else the engine or connection. The full line is its tooltip. */
function profileModelChip(profile: ChatProfile, slots: ModelSlot[]) {
  const slot = profile.modelSlotId ? slots.find((item) => item.id === profile.modelSlotId) : undefined
  if (slot) return `${slot.isDefault ? '★ ' : ''}${slot.name}`
  if (profile.engine === 'claude') return 'Claude Code'
  return profile.engine === 'codex' ? 'Codex' : profile.providerName
}

/** The one tool chip of a profile: the allowed-tool count, else just "tools". */
function profileToolChip(profile: ChatProfile, t: ReturnType<typeof useI18n>['t']) {
  if (Array.isArray(profile.toolAllowlist)) return t({ ko: '도구 {count}', en: '{count} tools' }, { count: profile.toolAllowlist.length })
  return t({ ko: '도구', en: 'Tools' })
}

/** Settings › Chat › 프로필: the chat switch and the chat profiles (Codex and API LLM). */
export function ChatSettingsProfiles() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<{ profile: ChatProfile | null; draft?: ChatProfileInput } | null>(null)
  // A card import: what came over and what did not, shown before its draft opens.
  const [imported, setImported] = useState<{ draft: ChatProfileInput; report: ChatCardImportReport } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const settingsQuery = useQuery({ queryKey: CHAT_ADMIN_SETTINGS_QUERY_KEY, queryFn: getChatAdminSettings })
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles })
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots })
  const defaultsQuery = useQuery({ queryKey: ['codex-chat-profile-defaults'], queryFn: getChatProfileDefaults, staleTime: Infinity })

  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const importMutation = useMutation({
    mutationFn: importChatProfileCard,
    onSuccess: ({ importReport, ...draft }) => {
      // A card's own lorebook is added to the shared lorebooks and linked to the draft.
      if (draft.lorebookIds?.length) void queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      if (importReport && (importReport.converted.length || importReport.dropped.length)) setImported({ draft, report: importReport })
      else setEditor({ profile: null, draft })
    },
    onError,
  })
  const settingsMutation = useMutation({
    mutationFn: updateChatAdminSettings,
    onSuccess: (settings, patch) => {
      queryClient.setQueryData(CHAT_ADMIN_SETTINGS_QUERY_KEY, settings)
      void queryClient.invalidateQueries({ queryKey: CHAT_STATUS_QUERY_KEY })
      if (patch.diagnostics) {
        void queryClient.invalidateQueries({ queryKey: ['codex-chat-thread'] })
        void queryClient.invalidateQueries({ queryKey: ['codex-chat-diagnostics'] })
      }
    },
    onError,
  })
  const toggleMutation = useMutation({
    mutationFn: ({ profileId, isEnabled }: { profileId: number; isEnabled: boolean }) => updateChatProfile(profileId, { isEnabled }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
      ])
    },
    onError,
  })

  const profiles = profilesQuery.data ?? []
  const slots = slotsQuery.data ?? []

  return (
    <div className="space-y-8">
      <RowGroup heading={t({ ko: '채팅', en: 'Chat' })} actions={<InstantApplyHint />}>
        {settingsQuery.data ? (
          <SettingsSwitchRow
            checked={settingsQuery.data.enabled}
            disabled={settingsMutation.isPending}
            onCheckedChange={(enabled) => settingsMutation.mutate({ enabled })}
            label={t({ ko: '채팅 사용', en: 'Enable chat' })}
          />
        ) : settingsQuery.isError ? (
          <p className="py-3 text-sm text-destructive">{getErrorMessage(settingsQuery.error, t({ ko: '설정을 불러오지 못했어.', en: 'Could not load settings.' }))}</p>
        ) : (
          <SettingsRowsSkeleton rows={1} />
        )}
      </RowGroup>

      <RowGroup heading={t({ ko: '진단', en: 'Diagnostics' })}>
        {settingsQuery.data ? <>
          <SettingsSwitchRow label={t({ ko: '답변 진단', en: 'Answer diagnostics' })} checked={settingsQuery.data.diagnostics.enabled} disabled={settingsMutation.isPending}
            onCheckedChange={(enabled) => settingsMutation.mutate({ diagnostics: { enabled } })} />
          <SettingsSwitchRow label={t({ ko: '원문 기록', en: 'Capture raw requests' })} checked={settingsQuery.data.diagnostics.captureRaw} disabled={settingsMutation.isPending}
            onCheckedChange={(captureRaw) => settingsMutation.mutate({ diagnostics: { captureRaw } })} />
          <SettingRow label={t({ ko: '채팅당 보관', en: 'Keep per chat' })} className={!settingsQuery.data.diagnostics.captureRaw ? 'opacity-60' : undefined}>
            <NumberStepperInput variant="settings" className="w-24" min={1} max={200} precision={0} value={settingsQuery.data.diagnostics.captureLimit}
              aria-label={t({ ko: '채팅당 보관', en: 'Keep per chat' })} disabled={settingsMutation.isPending || !settingsQuery.data.diagnostics.captureRaw}
              onValueCommit={(value) => { const captureLimit = Number(value); if (captureLimit !== settingsQuery.data?.diagnostics.captureLimit) settingsMutation.mutate({ diagnostics: { captureLimit } }) }} />
          </SettingRow>
        </> : settingsQuery.isError ? (
          <p className="py-3 text-sm text-destructive">{getErrorMessage(settingsQuery.error, t({ ko: '설정을 불러오지 못했어.', en: 'Could not load settings.' }))}</p>
        ) : <SettingsRowsSkeleton rows={3} />}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '채팅 프로필', en: 'Chat profiles' })}
        count={profilesQuery.isSuccess ? profiles.length : undefined}
        actions={(
          <div className="flex items-center gap-1">
            <input ref={importRef} type="file" accept=".png,.json,image/png,application/json" className="hidden" aria-label={t({ ko: '캐릭터 카드 파일', en: 'Character card file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) importMutation.mutate(file)
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={importMutation.isPending} onClick={() => importRef.current?.click()} label={t({ ko: '캐릭터 카드 가져오기', en: 'Import character card' })}><FileUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setEditor({ profile: null })} label={t({ ko: '프로필 추가', en: 'Add profile' })}>
              <Plus />
            </IconButton>
          </div>
        )}
      >
        {profilesQuery.isLoading ? <SettingsRowsSkeleton rows={2} /> : null}
        {profilesQuery.isSuccess && profiles.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 프로필이 없어.', en: 'No profiles yet.' })}</SettingsEmptyRow> : null}
        {profiles.map((profile) => (
          <ResourceRow
            key={profile.id}
            className="min-h-14"
            leading={<ChatProfileAvatar name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="lg" />}
            name={profile.name}
            extra={(
              <Tip content={profileModelLine(profile, slots, t)}>
                <span className="min-w-0"><Chip size="sm" tone="muted" className="max-w-48"><span className="truncate">{profileModelChip(profile, slots)}</span></Chip></span>
              </Tip>
            )}
            trailing={(
              <>
                {profile.mcpEnabled ? (
                  <Tip content={profile.mcpScopes.map((scope) => getChatScopeCopy(scope, t).label).join(' · ')}>
                    <span className="hidden max-w-32 shrink-0 truncate rounded-sm bg-fill px-2 py-0.5 text-xs text-muted-foreground sm:inline">{profileToolChip(profile, t)}</span>
                  </Tip>
                ) : null}
                <Switch
                  className="ml-1"
                  checked={profile.isEnabled}
                  disabled={toggleMutation.isPending}
                  onCheckedChange={(isEnabled) => toggleMutation.mutate({ profileId: profile.id, isEnabled })}
                  aria-label={t({ ko: '사용', en: 'On' })}
                />
              </>
            )}
            onOpen={() => setEditor({ profile })}
          />
        ))}
        {profilesQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(profilesQuery.error, t({ ko: '프로필을 불러오지 못했어.', en: 'Could not load profiles.' }))}</p> : null}
      </RowGroup>

      <ChatCardImportReportModal
        report={imported?.report ?? null}
        onClose={() => {
          if (imported) setEditor({ profile: null, draft: imported.draft })
          setImported(null)
        }}
      />
      <ChatProfileEditorModal open={editor !== null} profile={editor?.profile ?? null} initialDraft={editor?.draft} defaults={defaultsQuery.data} onClose={() => setEditor(null)} />
    </div>
  )
}

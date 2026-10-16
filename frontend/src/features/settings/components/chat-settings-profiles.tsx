import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FileUp, Plus } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { ChatHealthDot, ChatHealthTip, useChatHealth } from '@/features/codex-chat/chat-health'
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
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { ChatCardImportReportModal } from './chat-card-import-report'
import { InstantApplyHint } from './settings-section-status'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'

/** An API LLM profile's model row: its own, else the chat representative model it falls back to. */
function profileModelRow(profile: ChatProfile, slots: ModelSlot[]) {
  if (profile.engine !== 'llm') return undefined
  return slots.find((item) => item.id === profile.modelSlotId) ?? slots.find((item) => item.isDefault)
}

/** `connection · model` (through `대표 · name` when the profile picked a representative model), else the engine and its model. */
function profileModelLine(profile: ChatProfile, slots: ModelSlot[], t: ReturnType<typeof useI18n>['t']) {
  const slot = profileModelRow(profile, slots)
  const reaches = slot?.kind === 'route' ? ` (${slot.model ? `${slot.providerLabel} · ${slot.model}` : t({ ko: '비어 있음', en: 'empty' })})` : ''
  if (slot) return `${slot.label}${reaches}${profile.llmRuntime === 'pi' ? ' · pi' : ''}`
  if (profile.engine === 'claude') return `Claude Code · ${profile.model || 'sonnet'}`
  if (profile.engine === 'codex') return `Codex · ${profile.model || t({ ko: '기본 모델', en: 'default model' })}`
  return t({ ko: '모델 없음', en: 'No model' })
}

/** Short chip text for the row: the model, else the engine. The full line is its tooltip. */
function profileModelChip(profile: ChatProfile, slots: ModelSlot[]) {
  const slot = profileModelRow(profile, slots)
  if (slot) return slot.model || slot.label
  if (profile.engine === 'claude') return 'Claude Code'
  return profile.engine === 'codex' ? 'Codex' : '—'
}

/** The one tool chip of a profile: the allowed-tool count, else just "tools". */
function profileToolChip(profile: ChatProfile, t: ReturnType<typeof useI18n>['t']) {
  if (Array.isArray(profile.toolAllowlist)) return t({ ko: '도구 {count}', en: '{count} tools' }, { count: profile.toolAllowlist.length })
  return t({ ko: '도구', en: 'Tools' })
}

/**
 * A copy of a profile to open in the editor: every setting, under a name not taken yet. A profile that wrote its own
 * reply suggestions leaves that to the copy's default; nothing is saved until the editor saves.
 */
function copyDraft(profile: ChatProfile, profiles: ChatProfile[], t: ReturnType<typeof useI18n>['t']): ChatProfileInput {
  const base = t({ ko: '{name} 사본', en: '{name} copy' }, { name: profile.name })
  const taken = new Set(profiles.map((entry) => entry.name))
  let name = base
  for (let count = 2; taken.has(name); count += 1) name = `${base} ${count}`
  return { ...profile, name, suggestProfileId: profile.suggestProfileId === profile.id ? null : profile.suggestProfileId }
}

/** Settings › Chat › 프로필: the chat switch and the chat profiles (Codex and API LLM). */
export function ChatSettingsProfiles() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<{ profile: ChatProfile | null; draft?: ChatProfileInput; copyOf?: number } | null>(null)
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
    onSuccess: (settings) => {
      queryClient.setQueryData(CHAT_ADMIN_SETTINGS_QUERY_KEY, settings)
      void queryClient.invalidateQueries({ queryKey: CHAT_STATUS_QUERY_KEY })
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
  const healthOf = useChatHealth()

  // A connected chat can open the editor for a new or listed profile; it fills and saves from there.
  useChatPageRegistration({
    kind: 'settings', title: t({ ko: '설정 · 채팅 프로필', en: 'Settings · Chat profiles' }), resourceId: 'chat', priority: 5, fields: [],
    data: { section: 'chat', profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name, tagline: profile.tagline, engine: profile.engine, isEnabled: profile.isEnabled })) },
    actions: [
      pageAction('profile.open_create', t({ ko: '새 프로필 편집기 열기', en: 'Open new profile editor' }), t({ ko: '빈 프로필 편집기를 열어. 열린 편집기가 바로 돌아오니 이어서 profile.draft로 채워.', en: 'Open an empty profile editor; it comes back so you can fill it with profile.draft next.' })),
      ...(profiles.length ? [
        pageAction('profile.open_edit', t({ ko: '프로필 편집기 열기', en: 'Open profile editor' }), t({ ko: '목록(data.profiles)의 프로필 편집기를 열어.', en: 'Open the editor of a listed profile (data.profiles).' }), pageObject({ id: pageChoice(profiles.map((profile) => profile.id)) }, ['id'])),
        pageAction('profile.copy', t({ ko: '프로필 복사', en: 'Copy profile' }), t({ ko: '목록 프로필의 사본 초안을 열어. 저장해야 생겨.', en: 'Open a copy of a listed profile as a new draft; saved only from the editor.' }), pageObject({ id: pageChoice(profiles.map((profile) => profile.id)) }, ['id'])),
      ] : []),
    ],
    apply: () => {},
    applyAction: (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'profile.open_create') { setEditor({ profile: null }); return }
      const profile = profiles.find((entry) => entry.id === Number(args.id))
      if (!profile) throw new Error('목록에 없는 프로필이야.')
      if (id === 'profile.copy') { setEditor({ profile: null, draft: copyDraft(profile, profiles, t), copyOf: profile.id }); return }
      setEditor({ profile })
    },
  }, { preserveOnSearchChange: true })

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
            leading={<ChatHealthDot down={healthOf(profile.id)}><ChatProfileAvatar name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="lg" /></ChatHealthDot>}
            name={profile.name}
            extra={(
              <Tip content={healthOf(profile.id) ? <ChatHealthTip down={healthOf(profile.id)!} /> : profileModelLine(profile, slots, t)}>
                <span className="min-w-0"><Chip size="sm" tone={healthOf(profile.id) ? 'destructive' : 'muted'} className="max-w-48"><span className="truncate">{profileModelChip(profile, slots)}</span></Chip></span>
              </Tip>
            )}
            trailing={(
              <>
                {profile.mcpEnabled ? (
                  <Tip content={profile.mcpScopes.map((scope) => getChatScopeCopy(scope, t).label).join(' · ')}>
                    <Chip tone="muted" className="hidden max-w-32 sm:inline-flex"><span className="truncate">{profileToolChip(profile, t)}</span></Chip>
                  </Tip>
                ) : null}
                <IconButton size="icon-sm" variant="ghost" onClick={() => setEditor({ profile: null, draft: copyDraft(profile, profiles, t), copyOf: profile.id })} label={t({ ko: '복사', en: 'Copy' })}>
                  <Copy />
                </IconButton>
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
      <ChatProfileEditorModal open={editor !== null} profile={editor?.profile ?? null} initialDraft={editor?.draft} copyOf={editor?.copyOf} defaults={defaultsQuery.data} onClose={() => setEditor(null)} />
    </div>
  )
}

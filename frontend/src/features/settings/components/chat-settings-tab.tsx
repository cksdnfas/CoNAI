import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, FileUp, Pencil, Plus, RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { ChatFlagEditorModal, ChatFlagRows, useChatFlags } from '@/features/codex-chat/chat-flags'
import { ChatUserProfileEditorModal, ChatUserProfileRows, useChatUserProfiles } from '@/features/codex-chat/chat-user-profiles'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_ADMIN_SETTINGS_QUERY_KEY,
  CHAT_FLAG_LIMITS,
  CHAT_USER_PROFILE_LIMITS,
  CHAT_LOREBOOKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_STATUS_QUERY_KEY,
  getChatAdminSettings,
  getChatProfileDefaults,
  importChatLorebook,
  importChatProfileCard,
  listChatAdminProfiles,
  listChatLorebooks,
  updateChatAdminSettings,
  updateChatProfile,
  type ChatFlag,
  type ChatUserProfile,
  type ChatLorebook,
  type ChatProfile,
  type ChatProfileInput,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatLorebookEditorModal } from './chat-lorebook-editor-modal'
import { ChatProfileEditorModal } from './chat-profile-editor-modal'
import { InstantApplyHint } from './settings-section-status'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { SettingsSwitchRow } from './settings-switch-row'

function profileModelLine(profile: ChatProfile, t: ReturnType<typeof useI18n>['t']) {
  const model = profile.model || t({ ko: '기본 모델', en: 'default model' })
  return profile.engine === 'codex' ? `Codex · ${model}` : `${profile.providerName} · ${model}`
}

/** Settings › Chat: the chat switch, chat profiles (Codex and API LLM), your own chat flags, and the shared lorebooks profiles link. */
export function ChatSettingsTab() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<{ profile: ChatProfile | null; draft?: ChatProfileInput } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [lorebookEditor, setLorebookEditor] = useState<{ lorebook: ChatLorebook | null } | null>(null)
  const lorebookImportRef = useRef<HTMLInputElement>(null)
  /** Set while a file is picked to refresh that book; null picks a new book. */
  const lorebookTargetRef = useRef<number | null>(null)
  const [flagEditor, setFlagEditor] = useState<{ flag: ChatFlag | null } | null>(null)
  const [userProfileEditor, setUserProfileEditor] = useState<{ profile: ChatUserProfile | null } | null>(null)

  const settingsQuery = useQuery({ queryKey: CHAT_ADMIN_SETTINGS_QUERY_KEY, queryFn: getChatAdminSettings })
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles })
  const lorebooksQuery = useQuery({ queryKey: CHAT_LOREBOOKS_QUERY_KEY, queryFn: listChatLorebooks })
  const flagsQuery = useChatFlags()
  const userProfilesQuery = useChatUserProfiles()
  const defaultsQuery = useQuery({ queryKey: ['codex-chat-profile-defaults'], queryFn: getChatProfileDefaults, staleTime: Infinity })

  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const importMutation = useMutation({
    mutationFn: importChatProfileCard,
    onSuccess: (draft) => {
      // A card's own lorebook is added to the shared lorebooks and linked to the draft.
      if (draft.lorebookIds?.length) void queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      setEditor({ profile: null, draft })
    },
    onError,
  })
  const lorebookImportMutation = useMutation({
    mutationFn: ({ file, lorebookId }: { file: File; lorebookId: number | null }) => importChatLorebook(file, lorebookId ?? undefined),
    onSuccess: async (lorebook, { lorebookId }) => {
      await queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      showSnackbar({
        message: lorebookId
          ? t({ ko: '{name} 업데이트했어. 항목 {count}개.', en: 'Updated {name}: {count} entries.' }, { name: lorebook.name, count: lorebook.entries.length })
          : t({ ko: '{name} 가져왔어. 항목 {count}개.', en: 'Imported {name}: {count} entries.' }, { name: lorebook.name, count: lorebook.entries.length }),
        tone: 'info',
      })
    },
    onError,
  })
  const pickLorebookFile = (lorebookId: number | null) => {
    lorebookTargetRef.current = lorebookId
    lorebookImportRef.current?.click()
  }
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
  const lorebooks = lorebooksQuery.data ?? []
  const flags = flagsQuery.data ?? []
  const userProfiles = userProfilesQuery.data ?? []

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
          <div key={profile.id} className="flex min-h-16 items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <ChatProfileAvatar name={profile.name} avatar={profile.avatar} engine={profile.engine} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{profile.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{profileModelLine(profile, t)}</div>
            </div>
            {profile.mcpEnabled ? (
              <div className="hidden shrink-0 gap-1 sm:flex">
                {profile.mcpScopes.map((scope) => (
                  <span key={scope} className="rounded-sm bg-fill px-2 py-0.5 text-xs text-muted-foreground">{getChatScopeCopy(scope, t).label}</span>
                ))}
              </div>
            ) : null}
            <Switch
              checked={profile.isEnabled}
              disabled={toggleMutation.isPending}
              onCheckedChange={(isEnabled) => toggleMutation.mutate({ profileId: profile.id, isEnabled })}
              aria-label={t({ ko: '사용', en: 'On' })}
            />
            <IconButton size="icon-sm" variant="ghost" onClick={() => setEditor({ profile })} label={t({ ko: '편집', en: 'Edit' })}>
              <Pencil />
            </IconButton>
          </div>
        ))}
        {profilesQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(profilesQuery.error, t({ ko: '프로필을 불러오지 못했어.', en: 'Could not load profiles.' }))}</p> : null}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '사용자 프로필', en: 'User profiles' })}
        actions={(
          <IconButton size="icon-sm" variant="ghost" disabled={userProfiles.length >= CHAT_USER_PROFILE_LIMITS.perAccount} onClick={() => setUserProfileEditor({ profile: null })} label={t({ ko: '사용자 프로필 추가', en: 'Add user profile' })}>
            <Plus />
          </IconButton>
        )}
      >
        {userProfilesQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {userProfilesQuery.isSuccess && userProfiles.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 사용자 프로필이 없어.', en: 'No user profiles yet.' })}</SettingsEmptyRow> : null}
        <ChatUserProfileRows profiles={userProfiles} onEdit={(profile) => setUserProfileEditor({ profile })} />
        {userProfilesQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(userProfilesQuery.error, t({ ko: '사용자 프로필을 불러오지 못했어.', en: 'Could not load user profiles.' }))}</p> : null}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '플래그', en: 'Flags' })}
        actions={(
          <IconButton size="icon-sm" variant="ghost" disabled={flags.length >= CHAT_FLAG_LIMITS.perAccount} onClick={() => setFlagEditor({ flag: null })} label={t({ ko: '플래그 추가', en: 'Add flag' })}>
            <Plus />
          </IconButton>
        )}
      >
        {flagsQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {flagsQuery.isSuccess && flags.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 플래그가 없어.', en: 'No flags yet.' })}</SettingsEmptyRow> : null}
        <ChatFlagRows flags={flags} onEdit={(flag) => setFlagEditor({ flag })} />
        {flagsQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(flagsQuery.error, t({ ko: '플래그를 불러오지 못했어.', en: 'Could not load flags.' }))}</p> : null}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '로어북', en: 'Lorebooks' })}
        actions={(
          <div className="flex items-center gap-1">
            <input ref={lorebookImportRef} type="file" accept=".json,.lorebook,.png,application/json,image/png" className="hidden" aria-label={t({ ko: '로어북 파일', en: 'Lorebook file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) lorebookImportMutation.mutate({ file, lorebookId: lorebookTargetRef.current })
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={lorebookImportMutation.isPending} onClick={() => pickLorebookFile(null)} label={t({ ko: '로어북 가져오기', en: 'Import lorebook' })}><FileUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setLorebookEditor({ lorebook: null })} label={t({ ko: '로어북 추가', en: 'Add lorebook' })}><Plus /></IconButton>
          </div>
        )}
      >
        {lorebooksQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {lorebooksQuery.isSuccess && lorebooks.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 로어북이 없어.', en: 'No lorebooks yet.' })}</SettingsEmptyRow> : null}
        {lorebooks.map((lorebook) => (
          <div key={lorebook.id} className="flex min-h-14 items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <BookOpen className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{lorebook.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {t({ ko: '항목 {count}개', en: '{count} entries' }, { count: lorebook.entries.length })}
                {' · '}
                {lorebook.profiles.length > 0 ? (
                  <Tip content={lorebook.profiles.map((profile) => profile.name).join(', ')}>
                    <span>{t({ ko: '프로필 {count}개', en: '{count} profiles' }, { count: lorebook.profiles.length })}</span>
                  </Tip>
                ) : t({ ko: '연결 없음', en: 'Not linked' })}
              </div>
            </div>
            <IconButton size="icon-sm" variant="ghost" disabled={lorebookImportMutation.isPending} onClick={() => pickLorebookFile(lorebook.id)} label={t({ ko: '파일로 업데이트', en: 'Update from file' })}><RefreshCw /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setLorebookEditor({ lorebook })} label={t({ ko: '편집', en: 'Edit' })}><Pencil /></IconButton>
          </div>
        ))}
        {lorebooksQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(lorebooksQuery.error, t({ ko: '로어북을 불러오지 못했어.', en: 'Could not load lorebooks.' }))}</p> : null}
      </RowGroup>

      <ChatFlagEditorModal open={flagEditor !== null} flag={flagEditor?.flag ?? null} onClose={() => setFlagEditor(null)} />
      <ChatUserProfileEditorModal open={userProfileEditor !== null} profile={userProfileEditor?.profile ?? null} onClose={() => setUserProfileEditor(null)} />
      <ChatLorebookEditorModal open={lorebookEditor !== null} lorebook={lorebookEditor?.lorebook ?? null} onClose={() => setLorebookEditor(null)} />
      <ChatProfileEditorModal open={editor !== null} profile={editor?.profile ?? null} initialDraft={editor?.draft} defaults={defaultsQuery.data} onClose={() => setEditor(null)} />
    </div>
  )
}

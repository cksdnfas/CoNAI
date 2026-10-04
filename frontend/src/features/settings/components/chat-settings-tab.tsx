import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_ADMIN_SETTINGS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_STATUS_QUERY_KEY,
  getChatAdminSettings,
  getChatProfileDefaults,
  listChatAdminProfiles,
  updateChatAdminSettings,
  updateChatProfile,
  type ChatProfile,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatProfileEditorModal } from './chat-profile-editor-modal'
import { LlmConnectionsTab } from './llm-connections-tab'
import { InstantApplyHint } from './settings-section-status'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { SettingsSwitchRow } from './settings-switch-row'

function profileModelLine(profile: ChatProfile, t: ReturnType<typeof useI18n>['t']) {
  const model = profile.model || t({ ko: '기본 모델', en: 'default model' })
  return profile.engine === 'codex' ? `Codex · ${model}` : `${profile.providerName} · ${model}`
}

/** Settings › Chat: the chat switch, chat profiles (Codex and API LLM) and the LLM connections they use. */
export function ChatSettingsTab() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<{ profile: ChatProfile | null } | null>(null)

  const settingsQuery = useQuery({ queryKey: CHAT_ADMIN_SETTINGS_QUERY_KEY, queryFn: getChatAdminSettings })
  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles })
  const defaultsQuery = useQuery({ queryKey: ['codex-chat-profile-defaults'], queryFn: getChatProfileDefaults, staleTime: Infinity })

  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
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
          <IconButton size="icon-sm" variant="ghost" onClick={() => setEditor({ profile: null })} label={t({ ko: '프로필 추가', en: 'Add profile' })}>
            <Plus />
          </IconButton>
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

      <LlmConnectionsTab />

      <ChatProfileEditorModal open={editor !== null} profile={editor?.profile ?? null} defaults={defaultsQuery.data} onClose={() => setEditor(null)} />
    </div>
  )
}

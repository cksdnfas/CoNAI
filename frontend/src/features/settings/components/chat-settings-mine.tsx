import { useState } from 'react'
import { Plus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { ChatFlagEditorModal, ChatFlagRows, useChatFlags } from '@/features/codex-chat/chat-flags'
import { ChatUserProfileEditorModal, ChatUserProfileRows, useChatUserProfiles } from '@/features/codex-chat/chat-user-profiles'
import { useI18n } from '@/i18n'
import { CHAT_FLAG_LIMITS, CHAT_USER_PROFILE_LIMITS, type ChatFlag, type ChatUserProfile } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'

/** Settings › Chat › 내 설정: the signed-in account's own user profiles and flags. */
export function ChatSettingsMine() {
  const { t } = useI18n()
  const [flagEditor, setFlagEditor] = useState<{ flag: ChatFlag | null } | null>(null)
  const [userProfileEditor, setUserProfileEditor] = useState<{ profile: ChatUserProfile | null } | null>(null)
  const flagsQuery = useChatFlags()
  const userProfilesQuery = useChatUserProfiles()
  const flags = flagsQuery.data ?? []
  const userProfiles = userProfilesQuery.data ?? []

  return (
    <div className="space-y-8">
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

      <ChatFlagEditorModal open={flagEditor !== null} flag={flagEditor?.flag ?? null} onClose={() => setFlagEditor(null)} />
      <ChatUserProfileEditorModal open={userProfileEditor !== null} profile={userProfileEditor?.profile ?? null} onClose={() => setUserProfileEditor(null)} />
    </div>
  )
}

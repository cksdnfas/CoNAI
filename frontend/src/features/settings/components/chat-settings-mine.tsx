import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { SETTINGS_ROW_BY_ID, type ChatPageData } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { ChatFlagEditorModal, ChatFlagRows, useChatFlagRoom, useChatFlags } from '@/features/codex-chat/chat-flags'
import { ChatUserProfileEditorModal, ChatUserProfileRows, useChatUserProfiles } from '@/features/codex-chat/chat-user-profiles'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { CODEX_CHAT_THREADS_QUERY_KEY } from '@/features/codex-chat/codex-chat-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import {
  CHAT_FLAG_LIMITS, CHAT_FLAGS_QUERY_KEY, CHAT_USER_PROFILE_LIMITS, CHAT_USER_PROFILES_QUERY_KEY, createChatFlag, createChatUserProfile, deleteChatFlag, deleteChatUserProfile,
  resetChatFlag, restoreChatFlag, updateChatFlag, updateChatUserProfile, type ChatFlag, type ChatUserProfile,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { SettingsContents } from './settings-navigation'
import { ChatFilledLabel } from './settings-filled-label'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import type { useChatOptionsPageParts } from './chat-options-page'

/** Settings › Chat › 내 설정: the signed-in account's own user profiles, and its flags (with the admins' shared ones). */
export function ChatSettingsMine({ sharedFlags = false, options }: { sharedFlags?: boolean; options?: ReturnType<typeof useChatOptionsPageParts> }) {
  const { t } = useI18n()
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  const [flagEditor, setFlagEditor] = useState<{ flag: ChatFlag | null } | null>(null)
  const [userProfileEditor, setUserProfileEditor] = useState<{ profile: ChatUserProfile | null } | null>(null)
  const flagsQuery = useChatFlags(true, { includeHidden: true })
  const userProfilesQuery = useChatUserProfiles()
  const flags = (flagsQuery.data ?? []).filter((flag) => isAdmin ? flag.shared === sharedFlags : !sharedFlags)
  const userProfiles = userProfilesQuery.data ?? []
  const hasFlagRoom = useChatFlagRoom(flags)
  const canAddFlag = hasFlagRoom && (!isAdmin || sharedFlags)
  const queryClient = useQueryClient()

  // A connected chat reads and writes the account's own user profiles and flags; every change is a review card.
  const chatData: Record<string, ChatPageData> = {
    ...(!sharedFlags ? { userProfiles: userProfiles.map((profile) => ({ id: profile.id, name: profile.name, persona: profile.persona, isDefault: profile.isDefault, modelSlotId: profile.modelSlotId })) } : {}),
    ...options?.data,
    flags: flags.map((flag) => ({ id: flag.id, icon: flag.icon, name: flag.name, content: flag.content, shared: flag.shared, edited: flag.edited, hidden: flag.hidden })),
  }
  const saveUserProfile = async (args: Record<string, ChatPageData>) => {
    const current = typeof args.id === 'number' ? userProfiles.find((profile) => profile.id === args.id) : undefined
    if (typeof args.id === 'number' && !current) throw new Error('목록에 없는 사용자 프로필이야.')
    if (args.operation === 'delete') {
      if (!current) throw new Error('지울 사용자 프로필의 id가 필요해.')
      await deleteChatUserProfile(current.id)
    } else {
      const name = (typeof args.name === 'string' ? args.name : current?.name ?? '').trim()
      if (!name) throw new Error('사용자 프로필 이름이 필요해.')
      const input = { name, persona: typeof args.persona === 'string' ? args.persona : current?.persona ?? '', avatar: current?.avatar ?? null, isDefault: typeof args.isDefault === 'boolean' ? args.isDefault : current?.isDefault ?? false }
      await (current ? updateChatUserProfile(current.id, input) : createChatUserProfile(input))
    }
    await Promise.all([queryClient.invalidateQueries({ queryKey: CHAT_USER_PROFILES_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })])
  }
  const saveFlag = async (args: Record<string, ChatPageData>) => {
    if (isAdmin && !sharedFlags) throw new Error('관리자의 공용 플래그는 설정 → 채팅에서 관리해줘.')
    const current = typeof args.id === 'number' ? flags.find((flag) => flag.id === args.id) : undefined
    if (typeof args.id === 'number' && !current) throw new Error('목록에 없는 플래그야.')
    if (args.operation === 'save') {
      const name = (typeof args.name === 'string' ? args.name : current?.name ?? '').trim()
      const content = typeof args.content === 'string' ? args.content : current?.content ?? ''
      if (!name || !content.trim()) throw new Error('플래그 이름과 내용이 필요해.')
      const input = { icon: typeof args.icon === 'string' ? args.icon : current?.icon ?? '', name, content }
      await (current ? updateChatFlag(current.id, input) : createChatFlag(input))
    } else {
      if (!current) throw new Error('플래그 id가 필요해.')
      await (args.operation === 'delete' ? deleteChatFlag(current.id) : args.operation === 'restore' ? restoreChatFlag(current.id) : resetChatFlag(current.id))
    }
    await queryClient.invalidateQueries({ queryKey: CHAT_FLAGS_QUERY_KEY })
  }
  useChatPageRegistration({
    kind: 'settings', title: sharedFlags ? t({ ko: '설정 · 채팅', en: 'Settings · Chat' }) : t({ ko: '설정 · 내 채팅 설정', en: 'Settings · My chat settings' }), resourceId: sharedFlags ? 'chat' : 'mine', priority: 5, fields: [], data: chatData,
    actions: [
      ...options?.actions ?? [],
      pageAction('settings.user_profile', t({ ko: '{name} 저장·삭제', en: 'Save or delete {name}' }, { name: t(SETTINGS_ROW_BY_ID['mine.persona'].label) }), t({
        ko: 'data.userProfiles(채팅에서 내가 누구인지). save: id 있으면 넘긴 것만 수정, 없으면 추가. 아바타·제안 모델은 사람이 편집기에서.',
        en: 'data.userProfiles (who the account is in chats). save: with id edits what is passed, without adds. Avatar and suggestion model stay in the editor.',
      }), pageObject({ operation: pageChoice(['save', 'delete']), id: pageNumber(0, undefined, true), name: pageText(CHAT_USER_PROFILE_LIMITS.name), persona: pageText(CHAT_USER_PROFILE_LIMITS.persona), isDefault: { type: 'boolean' } }, ['operation']), 'save'),
      pageAction('settings.flag', t({ ko: '{name} 저장·삭제', en: 'Save or delete {name}' }, { name: t(SETTINGS_ROW_BY_ID[sharedFlags ? 'chat.flags' : 'mine.flags'].label) }), sharedFlags ? t(SETTINGS_ROW_BY_ID['chat.flags'].description) : t({
        ko: 'data.flags(채팅마다 켜면 메시지에 붙는 지시문). save: id 있으면 수정(공용이면 내 사본), 없으면 추가. icon: 이모지나 lucide:<이름>. restore: 숨긴 공용 꺼내기, reset: 공용 원문으로.',
        en: 'data.flags (instructions switched on per chat). save: with id edits (a shared one becomes an own copy), without adds. icon: emoji or lucide:<name>. restore: unhide a shared one, reset: back to the shared text.',
      }), pageObject({ operation: pageChoice(['save', 'delete', 'restore', 'reset']), id: pageNumber(0, undefined, true), icon: pageText(60), name: pageText(CHAT_FLAG_LIMITS.name), content: pageText(CHAT_FLAG_LIMITS.content) }, ['operation']), 'save'),
    ].filter((action) => sharedFlags ? action.id !== 'settings.user_profile' : !isAdmin || action.id !== 'settings.flag'),
    apply: () => {},
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      const optionSave = options?.apply(id, args)
      if (optionSave) return optionSave
      const normalized = args.id === 0 ? { ...args, id: null } : args
      if (id === 'settings.user_profile' && !sharedFlags) return saveUserProfile(normalized)
      if (id === 'settings.flag') return saveFlag(normalized)
      throw new Error('이 화면에 없는 작업이야.')
    },
  }, { preserveOnSearchChange: true })

  return (
    <div className="space-y-8">
      {!sharedFlags ? <SettingsContents groups={[{ id: 'persona', label: t({ ko: '페르소나', en: 'Personas' }) }, { id: 'flags', label: t({ ko: '플래그', en: 'Flags' }) }]} /> : null}
      {!sharedFlags ? (
      <RowGroup
        data-settings-group="persona"
        heading={<ChatFilledLabel fieldId="mine.persona" />}
        count={userProfilesQuery.isSuccess ? userProfiles.length : undefined}
        actions={(
          <IconButton size="icon-sm" variant="ghost" disabled={userProfiles.length >= CHAT_USER_PROFILE_LIMITS.perAccount} onClick={() => setUserProfileEditor({ profile: null })} label={t({ ko: '사용자 프로필 추가', en: 'Add user profile' })}>
            <Plus />
          </IconButton>
        )}
      >
        {userProfilesQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {userProfilesQuery.isSuccess && userProfiles.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 사용자 프로필이 없어', en: 'No user profiles yet' })}</SettingsEmptyRow> : null}
        <ChatUserProfileRows profiles={userProfiles} onEdit={(profile) => setUserProfileEditor({ profile })} />
        {userProfilesQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(userProfilesQuery.error, t({ ko: '사용자 프로필을 불러오지 못했어.', en: 'Could not load user profiles.' }))}</p> : null}
      </RowGroup>
      ) : null}

      <RowGroup
        data-settings-group="flags"
        heading={<ChatFilledLabel fieldId={sharedFlags ? 'chat.flags' : 'mine.flags'} />}
        count={flagsQuery.isSuccess ? flags.length : undefined}
        actions={(
          !isAdmin || sharedFlags ? <IconButton size="icon-sm" variant="ghost" disabled={!canAddFlag} onClick={() => setFlagEditor({ flag: null })} label={t({ ko: '플래그 추가', en: 'Add flag' })}>
            <Plus />
          </IconButton> : null
        )}
      >
        {isAdmin && !sharedFlags ? <Button asChild variant="ghost" size="sm"><Link to="/settings?section=chat&group=flags">{t({ ko: '공용 플래그는 앱 관리 → 채팅에서 바꿔 → 열기', en: 'Shared flags live in App management → Chat → Open' })}</Link></Button> : null}
        {flagsQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {flagsQuery.isSuccess && flags.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 플래그가 없어', en: 'No flags yet' })}</SettingsEmptyRow> : null}
        <ChatFlagRows flags={flags} onEdit={(flag) => setFlagEditor({ flag })} />
        {flagsQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(flagsQuery.error, t({ ko: '플래그를 불러오지 못했어.', en: 'Could not load flags.' }))}</p> : null}
      </RowGroup>

      <ChatFlagEditorModal open={flagEditor !== null} flag={flagEditor?.flag ?? null} onClose={() => setFlagEditor(null)} />
      <ChatUserProfileEditorModal open={userProfileEditor !== null} profile={userProfileEditor?.profile ?? null} onClose={() => setUserProfileEditor(null)} />
    </div>
  )
}

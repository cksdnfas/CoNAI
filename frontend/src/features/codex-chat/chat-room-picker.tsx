import { useMemo } from 'react'
import { RowPicker, type RowPickerItem } from '@/components/ui/row-picker'
import { useI18n } from '@/i18n'
import type { ChatProfileSummary, CodexChatThread } from '@/lib/api-codex-chat'
import { GroupAvatarStack } from './chat-group'
import { ChatProfileAvatar } from './chat-profile-avatar'

/** A room's name as the chat list gives it: its title, else the character it talks to. */
export function chatRoomName(thread: Pick<CodexChatThread, 'id' | 'title' | 'profile_id'>, profilesById: ReadonlyMap<number, ChatProfileSummary>, untitled: string) {
  return thread.title.trim() || (thread.profile_id !== null ? profilesById.get(thread.profile_id)?.name : undefined) || untitled
}

/** The face of a room: its character, or the first members of a group. */
export function ChatRoomFace({ thread, profilesById, size = 'md', ringClassName = 'ring-surface-high' }: {
  thread: Pick<CodexChatThread, 'kind' | 'profile_id' | 'member_profile_ids'>
  profilesById: ReadonlyMap<number, ChatProfileSummary>
  size?: 'sm' | 'md'
  /** The surface behind a group's overlapping faces. */
  ringClassName?: string
}) {
  if (thread.kind === 'group') {
    const members = (thread.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? [])
    return <GroupAvatarStack profiles={members} size={size === 'md' ? 'sm' : 'xs'} ringClassName={ringClassName} />
  }
  const profile = thread.profile_id !== null ? profilesById.get(thread.profile_id) : undefined
  return profile
    ? <ChatProfileAvatar name={profile.name} profile={profile} engine={profile.engine} size={size} />
    : <span className={size === 'md' ? 'size-8 rounded-full bg-surface-highest' : 'size-6 rounded-full bg-surface-highest'} aria-hidden="true" />
}

/** Pick one chat room by its face, its people and its latest line (pinned first, then the latest activity). */
export function ChatRoomPicker({ threads, profilesById, value, onChange, disabled }: {
  threads: CodexChatThread[]
  profilesById: ReadonlyMap<number, ChatProfileSummary>
  value: string
  onChange: (threadId: string) => void
  disabled?: boolean
}) {
  const { t, formatDate } = useI18n()
  const items = useMemo<RowPickerItem[]>(() => {
    const untitled = t({ ko: '새 채팅', en: 'New chat' })
    const today = new Date()
    const whenLabel = (date: Date) => date.toDateString() === today.toDateString()
      ? formatDate(date, { hour: 'numeric', minute: '2-digit' })
      : formatDate(date, date.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' })
    // The server lists the latest activity first; pinned rooms go on top and the archive to the end, as in the chat list.
    const order = (thread: CodexChatThread) => (thread.archived ? 2 : thread.pinned ? 0 : 1)
    return [...threads].sort((a, b) => order(a) - order(b)).map((thread) => {
      const name = chatRoomName(thread, profilesById, untitled)
      const people = thread.kind === 'group'
        ? (thread.member_profile_ids ?? []).flatMap((id) => profilesById.get(id)?.name ?? []).join(', ')
        : thread.profile_id !== null ? profilesById.get(thread.profile_id)?.name ?? '' : ''
      const preview = thread.preview ? thread.preview.text || (thread.preview.media ? t({ ko: '이미지', en: 'Image' }) : thread.preview.files ? t({ ko: '파일', en: 'File' }) : '') : ''
      const movedAt = new Date(`${thread.updated_date.replace(' ', 'T')}Z`)
      return {
        id: String(thread.id),
        media: <ChatRoomFace thread={thread} profilesById={profilesById} />,
        title: <>
          <span className="truncate">{name}</span>
          {thread.kind === 'group' ? <span className="shrink-0 rounded-[3px] bg-surface-highest px-1 text-2xs font-semibold text-muted-foreground">{t({ ko: '그룹 {count}', en: 'Group {count}' }, { count: thread.member_profile_ids?.length ?? 0 })}</span> : null}
          {thread.archived ? <span className="shrink-0 text-2xs font-normal text-muted-foreground">{t({ ko: '보관됨', en: 'Archived' })}</span> : null}
        </>,
        subtitle: [people, preview.replace(/\s+/g, ' ')].filter(Boolean).join(' · ') || undefined,
        trailing: Number.isNaN(movedAt.getTime()) ? undefined : whenLabel(movedAt),
        searchText: `${name} ${people} ${preview}`,
      }
    })
  }, [formatDate, profilesById, t, threads])
  return (
    <RowPicker
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={t({ ko: '채팅방', en: 'Room' })}
      placeholder={t({ ko: '채팅방 고르기', en: 'Pick a room' })}
      searchPlaceholder={t({ ko: '방 찾기', en: 'Find a room' })}
      emptyLabel={t({ ko: '맞는 방 없음', en: 'No matching room' })}
    />
  )
}

/** Pick one character by its face. */
export function ChatProfilePicker({ profiles, value, onChange, disabled }: {
  profiles: ChatProfileSummary[]
  value: string
  onChange: (profileId: string) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const items = useMemo<RowPickerItem[]>(() => profiles.map((profile) => ({
    id: String(profile.id),
    media: <ChatProfileAvatar name={profile.name} profile={profile} engine={profile.engine} size="md" />,
    title: <span className="truncate">{profile.name}</span>,
    subtitle: profile.tagline.trim() || profile.modelLabel || undefined,
    searchText: `${profile.name} ${profile.tagline}`,
  })), [profiles])
  return (
    <RowPicker
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={t({ ko: '캐릭터', en: 'Character' })}
      placeholder={t({ ko: '캐릭터 고르기', en: 'Pick a character' })}
      searchPlaceholder={t({ ko: '캐릭터 찾기', en: 'Find a character' })}
      emptyLabel={t({ ko: '맞는 캐릭터 없음', en: 'No matching character' })}
    />
  )
}

import { useMemo, useState } from 'react'
import { Chip } from '@/components/ui/chip'
import { RowPicker, type RowPickerItem } from '@/components/ui/row-picker'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ChatProfileConnectionDown, ChatProfileSummary, CodexChatThreadSummary } from '@/lib/api-codex-chat'
import { ChatHealthDot } from './chat-health'
import { GroupAvatarStack } from './chat-group'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { parseServerDate } from '@/lib/server-time'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { ChatRoomPageMore, useChatRoomPages, useChatRoomSummaries } from './use-chat-room-directory'

/** A room's name as the chat list gives it: its title, else the character it talks to. */
export function chatRoomName(thread: Pick<CodexChatThreadSummary, 'id' | 'title' | 'profile_id'>, profilesById: ReadonlyMap<number, ChatProfileSummary>, untitled: string) {
  return thread.title.trim() || (thread.profile_id !== null ? profilesById.get(thread.profile_id)?.name : undefined) || untitled
}

export function chatRoomPreviewText(thread: CodexChatThreadSummary, t: ReturnType<typeof useI18n>['t']) {
  const preview = thread.preview
  return preview ? preview.text || (preview.media ? t({ ko: '이미지', en: 'Image' }) : preview.files ? t({ ko: '파일', en: 'File' }) : '') : ''
}

export function chatRoomActivityLabel(date: Date, formatDate: ReturnType<typeof useI18n>['formatDate'], t: ReturnType<typeof useI18n>['t'], relativeDays = false) {
  const today = new Date()
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000)
  if (days === 0 || (relativeDays && days < 0)) return formatDate(date, { hour: 'numeric', minute: '2-digit' })
  if (relativeDays && days === 1) return t({ ko: '어제', en: 'Yesterday' })
  if (relativeDays && days < 7) return formatDate(date, { weekday: 'short' })
  return formatDate(date, date.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' })
}

/** The face of a room: its character, or the first members of a group. */
export function ChatRoomFace({ down = null, variant = 'picker', ...props }: {
  thread: Pick<CodexChatThreadSummary, 'kind' | 'profile_id' | 'member_profile_ids'>
  profilesById: ReadonlyMap<number, ChatProfileSummary>
  size?: 'sm' | 'md'
  /** The surface behind a group's overlapping faces. */
  ringClassName?: string
  down?: ChatProfileConnectionDown | null
  variant?: 'picker' | 'thread'
}) {
  const missing = variant === 'thread' && props.thread.kind !== 'group' && !props.profilesById.has(props.thread.profile_id ?? -1)
  return <ChatHealthDot down={missing ? null : down}><RoomFace {...props} variant={variant} /></ChatHealthDot>
}

function RoomFace({ thread, profilesById, size = 'md', ringClassName = 'ring-surface-high', variant }: {
  thread: Pick<CodexChatThreadSummary, 'kind' | 'profile_id' | 'member_profile_ids'>
  profilesById: ReadonlyMap<number, ChatProfileSummary>
  size?: 'sm' | 'md'; ringClassName?: string
  variant: 'picker' | 'thread'
}) {
  if (thread.kind === 'group') {
    const members = (thread.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? [])
    if (variant === 'thread') return <GroupAvatarStack profiles={members} size={size === 'md' ? 'sm' : 'xs'} ringClassName={ringClassName} />
    if (size !== 'md' || members.length < 2) return <GroupAvatarStack profiles={members} size="xs" ringClassName={ringClassName} />
    // Two faces corner to corner, in the same square as a single face, so names line up down a list.
    const [first, second] = members
    return (
      <span className="relative size-8 shrink-0" aria-hidden="true">
        <ChatProfileAvatar name={first.name} profile={first} engine={first.engine} size="xs" className="absolute top-0 left-0" />
        <ChatProfileAvatar name={second.name} profile={second} engine={second.engine} size="xs" className={cn('absolute right-0 bottom-0 ring-2', ringClassName)} />
      </span>
    )
  }
  const profile = thread.profile_id !== null ? profilesById.get(thread.profile_id) : undefined
  if (!profile && variant === 'thread') return <span className={size === 'md' ? 'size-8' : 'size-6'} aria-hidden="true" />
  return profile
    ? <ChatProfileAvatar name={profile.name} avatar={variant === 'thread' ? profile.avatar : undefined} profile={profile} engine={profile.engine} size={size} />
    : <span className={size === 'md' ? 'size-8 rounded-full bg-surface-highest' : 'size-6 rounded-full bg-surface-highest'} aria-hidden="true" />
}

/** Pick one chat room by its face, its people and its latest line (pinned first, then the latest activity). */
export function ChatRoomPicker({ profilesById, value, onChange, disabled, kind }: {
  profilesById: ReadonlyMap<number, ChatProfileSummary>
  value: string
  onChange: (threadId: string) => void
  disabled?: boolean
  kind?: 'direct' | 'group'
}) {
  const { t, formatDate } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search)
  const page = useChatRoomPages({ archive: 'all', pinnedFirst: true, kind, query }, open)
  const selected = useChatRoomSummaries(value ? [Number(value)] : [], !page.rooms.some((room) => String(room.id) === value))
  const threads = useMemo(() => [...page.rooms, ...(selected.data ?? []).filter((room) => !page.rooms.some((loaded) => loaded.id === room.id))], [page.rooms, selected.data])
  const pageIds = new Set(page.rooms.map((room) => String(room.id)))
  const items = useMemo<RowPickerItem[]>(() => {
    const untitled = t({ ko: '새 채팅', en: 'New chat' })
    const whenLabel = (date: Date) => chatRoomActivityLabel(date, formatDate, t)
    // The server lists the latest activity first; pinned rooms go on top and the archive to the end, as in the chat list.
    const order = (thread: CodexChatThreadSummary) => (thread.archived ? 2 : thread.pinned ? 0 : 1)
    return [...threads].sort((a, b) => order(a) - order(b)).map((thread) => {
      const name = chatRoomName(thread, profilesById, untitled)
      const people = thread.kind === 'group'
        ? (thread.member_profile_ids ?? []).flatMap((id) => profilesById.get(id)?.name ?? []).join(', ')
        : thread.profile_id !== null ? profilesById.get(thread.profile_id)?.name ?? '' : ''
      const preview = chatRoomPreviewText(thread, t)
      const movedAt = parseServerDate(thread.updated_date)
      return {
        id: String(thread.id),
        media: <ChatRoomFace thread={thread} profilesById={profilesById} />,
        title: <>
          <span className="truncate">{name}</span>
          {thread.kind === 'group' ? <Chip size="sm" tone="muted">{t({ ko: '그룹 {count}', en: 'Group {count}' }, { count: thread.member_profile_ids?.length ?? 0 })}</Chip> : null}
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
      items={items.filter((item) => pageIds.has(item.id))}
      pickedItem={items.find((item) => item.id === value)}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={t({ ko: '채팅방', en: 'Room' })}
      placeholder={t({ ko: '채팅방 고르기', en: 'Pick a room' })}
      searchPlaceholder={t({ ko: '방 찾기', en: 'Find a room' })}
      emptyLabel={t({ ko: '맞는 방이 없어', en: 'No matching room' })}
      onOpenChange={setOpen}
      onSearchChange={setSearch}
      footer={<ChatRoomPageMore page={page} />}
    />
  )
}

/** Pick one character by its face. */
export function ChatProfileSelect({ profiles, value, onChange, disabled }: {
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
      emptyLabel={t({ ko: '맞는 캐릭터가 없어', en: 'No matching character' })}
    />
  )
}

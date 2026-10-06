import { ListRow } from '@/components/ui/list-row'
import { useI18n } from '@/i18n'
import type { ChatProfileSummary, CodexChatThread } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { GroupAvatarStack } from './chat-group'
import { ChatProfileAvatar } from './chat-profile-avatar'

/**
 * The chats as the server lists them (latest activity first): the face each talks to, its title and when it last moved.
 * `dense` is the page's side column; the panel's list screen uses roomier rows.
 */
export function ChatThreadList({ threads, profilesById, activeThreadId, runningThreadIds, disabled, dense = false, onSelect }: {
  threads: CodexChatThread[]
  profilesById: Map<number, ChatProfileSummary>
  activeThreadId: number | null
  /** Chats with a reply on its way (a dot on the row). */
  runningThreadIds: ReadonlySet<number>
  /** A reply is on its way: only the chat it belongs to stays open. */
  disabled: boolean
  dense?: boolean
  onSelect: (threadId: number) => void
}) {
  const { t, formatDate } = useI18n()
  const untitled = t({ ko: '새 채팅', en: 'New chat' })
  const today = new Date()
  // The clock today, the day otherwise.
  const whenLabel = (date: Date) => date.toDateString() === today.toDateString()
    ? formatDate(date, { hour: 'numeric', minute: '2-digit' })
    : formatDate(date, date.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' })
  return <>{threads.map((entry) => {
    const entryProfile = entry.profile_id ? profilesById.get(entry.profile_id) : undefined
    const movedAt = new Date(`${entry.updated_date.replace(' ', 'T')}Z`)
    return (
      <ListRow key={entry.id} asChild interactive size={dense ? 'sm' : 'lg'} selected={entry.id === activeThreadId}>
        <button type="button" onClick={() => onSelect(entry.id)} disabled={disabled && entry.id !== activeThreadId} className={cn('w-full disabled:opacity-50', dense ? 'gap-2' : 'gap-3 px-3')}>
          {entry.kind === 'group'
            ? <GroupAvatarStack profiles={(entry.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? [])} size={dense ? 'xs' : 'sm'} ringClassName="ring-background" />
            : entryProfile ? <ChatProfileAvatar name={entryProfile.name} avatar={entryProfile.avatar} engine={entryProfile.engine} size={dense ? 'xs' : 'md'} /> : null}
          <span className={cn('min-w-0 flex-1 truncate', !dense && 'font-semibold')}>{entry.title || untitled}</span>
          {runningThreadIds.has(entry.id) ? <span role="img" aria-label={t({ ko: '답변 중', en: 'Replying' })} className="size-1.5 shrink-0 rounded-full bg-success motion-safe:animate-pulse" /> : null}
          {Number.isNaN(movedAt.getTime()) ? null : <time className="shrink-0 text-2xs tabular-nums text-muted-foreground" dateTime={movedAt.toISOString()}>{whenLabel(movedAt)}</time>}
        </button>
      </ListRow>
    )
  })}</>
}

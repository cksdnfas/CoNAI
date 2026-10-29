import { AlarmClock, Archive, ArchiveRestore, Bell, BellOff, Check, MoreHorizontal, Pencil, Pin, PinOff, SquareCheck } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { ChatProfileConnectionDown, ChatProfileSummary, CodexChatThreadSummary } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { parseServerDate } from '@/lib/server-time'
import { ChatRoomFace, chatRoomActivityLabel, chatRoomPreviewText } from './chat-room-picker'
import { ChatTaskRing } from './chat-task-ui'
import { UnreadCount } from './chat-unread-count'
import type { ChatListPatch } from './chat-thread-list'

export function ChatThreadRow({ entry, profilesById, draft, nested, dense, checked, selecting, active, running, routine, down, onSelect, onUpdate, onTogglePick, onRename }: {
  entry: CodexChatThreadSummary; profilesById: Map<number, ChatProfileSummary>; draft?: string
  nested: boolean; dense: boolean; checked: boolean; selecting: boolean; active: boolean; running: boolean; routine: boolean
  down: ChatProfileConnectionDown | null
  onSelect: (id: number) => void; onUpdate: (id: number, patch: ChatListPatch) => void
  onTogglePick: (id: number) => void; onRename: (id: number, title: string) => void
}) {
  const { t, formatDate } = useI18n()
  const entryProfile = entry.profile_id ? profilesById.get(entry.profile_id) : undefined
  const movedAt = parseServerDate(entry.updated_date)
  const time = Number.isNaN(movedAt.getTime()) ? null : <time className="text-2xs tabular-nums text-muted-foreground" dateTime={movedAt.toISOString()}>{chatRoomActivityLabel(movedAt, formatDate, t, true)}</time>
  const text = chatRoomPreviewText(entry, t)
  const who = entry.preview?.role === 'user' ? t({ ko: '나', en: 'Me' }) : entry.kind === 'group' ? null : entryProfile?.name
  const preview = draft?.trim() ? <><span className="text-secondary-text">{t({ ko: '초안', en: 'Draft' })}</span> {draft.replace(/\s+/g, ' ')}</> : text && who ? `${who}: ${text}` : text
  return <div className={cn('relative', nested && (dense ? 'pl-5' : 'pl-8'))}>
    <ListRow asChild interactive size={dense ? 'md' : 'lg'} selected={selecting ? checked : active}>
      <button type="button" aria-pressed={selecting ? checked : undefined} aria-current={!selecting && active ? 'true' : undefined} onClick={() => selecting ? onTogglePick(entry.id) : onSelect(entry.id)} className={cn('w-full', dense ? 'gap-2' : 'gap-3 px-3', !selecting && (dense ? 'pr-9' : 'pr-11'))}>
        <span className="relative flex shrink-0">
          <span className={cn('flex', selecting && 'opacity-0')}><ChatRoomFace thread={entry} profilesById={profilesById} size={dense ? 'sm' : 'md'} ringClassName="ring-background" down={down} variant="thread" /></span>
          <span aria-hidden className={cn('absolute inset-0 grid place-items-center', !selecting && 'hidden')}>
            <span className={cn('grid size-4 place-items-center rounded-sm border-2', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/70')}>
              {checked ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate', dense ? 'font-medium' : 'font-semibold')}>{entry.title || t({ ko: '새 채팅', en: 'New chat' })}</span>
            {entry.pinned ? <Pin aria-label={t({ ko: '고정됨', en: 'Pinned' })} className="size-3 shrink-0 text-muted-foreground" /> : null}
            {routine ? <AlarmClock aria-label={t({ ko: '루틴', en: 'Routine' })} className="size-3 shrink-0 text-muted-foreground" /> : null}
            {entry.notify_enabled === false ? <BellOff aria-label={t({ ko: '알림 꺼짐', en: 'Muted' })} className="size-3 shrink-0 text-muted-foreground" /> : null}
          </span>
          {dense ? <span className="flex min-w-0 items-center gap-1.5">
            {preview ? <span className="min-w-0 truncate text-xs text-muted-foreground">{preview}</span> : null}
            <span className="ml-auto shrink-0">{time}</span>
          </span> : preview ? <span className="block truncate text-xs text-muted-foreground">{preview}</span> : null}
        </span>
        <span className={cn('flex shrink-0', dense ? 'items-center gap-2' : 'flex-col items-end gap-1')}>
          <span className="flex items-center gap-2">
            {entry.task ? <ChatTaskRing summary={entry.task} /> : null}
            {entry.running || running ? <span role="img" aria-label={t({ ko: '답변 중', en: 'Replying' })} className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" /> : null}
            {dense ? null : time}
          </span>
          {entry.unread_count ? <UnreadCount count={entry.unread_count} /> : null}
        </span>
      </button>
    </ListRow>
    {selecting ? null : <DropdownMenu>
      <Tip content={t({ ko: '채팅 관리', en: 'Manage chat' })}><DropdownMenuTrigger asChild>
        <IconButton variant="ghost" size="icon-xs" tooltip={false} label={t({ ko: '채팅 관리', en: 'Manage chat' })} className="absolute right-2 top-1/2 -translate-y-1/2"><MoreHorizontal /></IconButton>
      </DropdownMenuTrigger></Tip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={() => onTogglePick(entry.id)}><SquareCheck />{t({ ko: '선택', en: 'Select' })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onUpdate(entry.id, { pinned: !entry.pinned })}>{entry.pinned ? <PinOff /> : <Pin />}{entry.pinned ? t({ ko: '고정 해제', en: 'Unpin' }) : t({ ko: '고정', en: 'Pin' })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onUpdate(entry.id, { notify: entry.notify_enabled === false })}>{entry.notify_enabled === false ? <Bell /> : <BellOff />}{entry.notify_enabled === false ? t({ ko: '알림 켜기', en: 'Turn on notifications' }) : t({ ko: '알림 끄기', en: 'Mute notifications' })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRename(entry.id, entry.title || '')}><Pencil />{t({ ko: '이름 바꾸기', en: 'Rename' })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onUpdate(entry.id, { archived: !entry.archived })}>{entry.archived ? <ArchiveRestore /> : <Archive />}{entry.archived ? t({ ko: '보관 해제', en: 'Unarchive' }) : t({ ko: '보관', en: 'Archive' })}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>
}

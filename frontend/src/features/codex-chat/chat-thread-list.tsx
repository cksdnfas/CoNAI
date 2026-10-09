import { useEffect, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, GitBranch, ListChecks, MoreHorizontal, Pencil, Pin, PinOff, SquareCheck, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { ChatProfileSummary, CodexChatThread } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { GroupAvatarStack } from './chat-group'
import { ChatDeleteDialog } from './chat-delete-dialog'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { UnreadCount } from './chat-unread-count'
import { ChatTaskRing } from './chat-task-ui'

export type ChatListPatch = { title?: string; pinned?: boolean; archived?: boolean }
export type ChatBulkAction = 'archive' | 'unarchive' | 'delete'

/**
 * The chats: pinned first, then the latest activity (as the server lists them). Each row shows the face it talks to,
 * its title, when it last moved, how many replies are unread and (roomy rows) the latest message or the unsent text. Branches kept before an edit
 * fold under the chat they came from; archived chats wait behind the archive row at the end.
 * `dense` is the page's side column; the panel's list screen uses roomier rows.
 *
 * Several chats are picked with "Select" in the row menu; while any is picked the faces turn into checks, a row click
 * ticks it, and a floating bar archives or deletes them (Esc lets go).
 */
export function ChatThreadList({ threads, profilesById, activeThreadId, runningThreadIds, drafts, dense = false, onSelect, onUpdate, onBulk }: {
  threads: CodexChatThread[]
  profilesById: Map<number, ChatProfileSummary>
  activeThreadId: number | null
  /** Chats with a reply on its way (a dot on the row). */
  runningThreadIds: ReadonlySet<number>
  /** Unsent composer text per chat, shown instead of the latest message. */
  drafts: Record<number, string>
  dense?: boolean
  onSelect: (threadId: number) => void
  onUpdate: (threadId: number, patch: ChatListPatch) => void
  /** Archive, unarchive or delete the picked chats; resolves true when all of them went through. */
  onBulk: (threadIds: number[], action: ChatBulkAction, backupDate?: string) => Promise<boolean>
}) {
  const { t, formatDate, formatNumber } = useI18n()
  const [openBranches, setOpenBranches] = useState<ReadonlySet<number>>(() => new Set())
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Chats that went away (deleted elsewhere) drop out of the selection.
  const pickedIds = threads.filter((entry) => picked.has(entry.id)).map((entry) => entry.id)
  const selecting = pickedIds.length > 0
  const togglePick = (threadId: number) => setPicked((current) => {
    const next = new Set(current)
    if (next.has(threadId)) next.delete(threadId)
    else next.add(threadId)
    return next
  })
  const clearPicks = () => setPicked(new Set())
  useEffect(() => {
    if (!selecting) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !confirmingDelete) setPicked(new Set()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting, confirmingDelete])
  const untitled = t({ ko: '새 채팅', en: 'New chat' })
  const today = new Date()
  // The clock today, the day otherwise.
  const whenLabel = (date: Date) => date.toDateString() === today.toDateString()
    ? formatDate(date, { hour: 'numeric', minute: '2-digit' })
    : formatDate(date, date.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' })

  const listed = threads.filter((entry) => !entry.archived)
  const archived = threads.filter((entry) => entry.archived)

  /** One section: its top rows (pinned first) and the kept-before-an-edit branches under each. */
  const arrange = (section: CodexChatThread[]) => {
    const ids = new Set(section.map((entry) => entry.id))
    const branches = new Map<number, CodexChatThread[]>()
    const top: CodexChatThread[] = []
    for (const entry of section) {
      const parent = entry.branch_purpose === 'preserve' ? entry.branched_from_thread_id ?? null : null
      if (parent !== null && ids.has(parent)) branches.set(parent, [...(branches.get(parent) ?? []), entry])
      else top.push(entry)
    }
    return { top: top.sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0)), branches }
  }

  const previewOf = (entry: CodexChatThread) => {
    const draft = drafts[entry.id]
    if (draft?.trim()) return <><span className="text-secondary-text">{t({ ko: '초안', en: 'Draft' })}</span> {draft.replace(/\s+/g, ' ')}</>
    const preview = entry.preview
    if (!preview) return null
    return preview.text || (preview.media ? t({ ko: '이미지', en: 'Image' }) : preview.files ? t({ ko: '파일', en: 'File' }) : null)
  }

  const row = (entry: CodexChatThread, nested = false) => {
    const entryProfile = entry.profile_id ? profilesById.get(entry.profile_id) : undefined
    const movedAt = new Date(`${entry.updated_date.replace(' ', 'T')}Z`)
    const preview = dense ? null : previewOf(entry)
    const checked = picked.has(entry.id)
    return (
      <div key={entry.id} className={cn('relative', nested && (dense ? 'pl-5' : 'pl-8'))}>
        <ListRow asChild interactive size={dense ? 'sm' : 'lg'} selected={selecting ? checked : entry.id === activeThreadId}>
          <button
            type="button"
            aria-pressed={selecting ? checked : undefined}
            // While picking, a row click ticks it.
            onClick={() => (selecting ? togglePick(entry.id) : onSelect(entry.id))}
            // Room for the row menu, which sits on the row's end.
            className={cn('w-full', dense ? 'gap-2' : 'gap-3 px-3', !selecting && (dense ? 'pr-9' : 'pr-11'))}
          >
            <span className="relative flex shrink-0">
              <span className={cn('flex', selecting && 'opacity-0')}>
              {entry.kind === 'group'
                ? <GroupAvatarStack profiles={(entry.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? [])} size={dense ? 'xs' : 'sm'} ringClassName="ring-background" />
                : entryProfile ? <ChatProfileAvatar name={entryProfile.name} avatar={entryProfile.avatar} profile={entryProfile} engine={entryProfile.engine} size={dense ? 'xs' : 'md'} /> : <span className={dense ? 'size-5' : 'size-8'} />}
              </span>
              <span
                aria-hidden
                className={cn('absolute inset-0 grid place-items-center', !selecting && 'hidden')}
              >
                <span className={cn('grid size-4 place-items-center rounded-[5px] border-[1.5px]', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/70')}>
                  {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn('truncate', !dense && 'font-semibold')}>{entry.title || untitled}</span>
                {entry.pinned ? <Pin aria-label={t({ ko: '고정됨', en: 'Pinned' })} className="size-3 shrink-0 text-muted-foreground" /> : null}
              </span>
              {preview ? <span className="block truncate text-xs text-muted-foreground">{preview}</span> : null}
            </span>
            {/* Time on top, the unread count under it (side by side in the dense list). */}
            <span className={cn('flex shrink-0', dense ? 'items-center gap-2' : 'flex-col items-end gap-1')}>
              <span className="flex items-center gap-2">
                {entry.task ? <ChatTaskRing summary={entry.task} /> : null}
                {runningThreadIds.has(entry.id) ? <span role="img" aria-label={t({ ko: '답변 중', en: 'Replying' })} className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" /> : null}
                {Number.isNaN(movedAt.getTime()) ? null : <time className="text-2xs tabular-nums text-muted-foreground" dateTime={movedAt.toISOString()}>{whenLabel(movedAt)}</time>}
              </span>
              {entry.unread_count ? <UnreadCount count={entry.unread_count} /> : null}
            </span>
          </button>
        </ListRow>
        {selecting ? null : <DropdownMenu>
          <Tip content={t({ ko: '채팅 관리', en: 'Manage chat' })}>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="icon-xs"
                tooltip={false}
                label={t({ ko: '채팅 관리', en: 'Manage chat' })}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => togglePick(entry.id)}><SquareCheck />{t({ ko: '선택', en: 'Select' })}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onUpdate(entry.id, { pinned: !entry.pinned })}>
              {entry.pinned ? <PinOff /> : <Pin />}{entry.pinned ? t({ ko: '고정 해제', en: 'Unpin' }) : t({ ko: '고정', en: 'Pin' })}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming({ id: entry.id, title: entry.title || '' })}><Pencil />{t({ ko: '이름 바꾸기', en: 'Rename' })}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onUpdate(entry.id, { archived: !entry.archived })}>
              {entry.archived ? <ArchiveRestore /> : <Archive />}{entry.archived ? t({ ko: '보관 해제', en: 'Unarchive' }) : t({ ko: '보관', en: 'Archive' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
    )
  }

  /** A folding row ("kept branches 2", "archive 5"): shows or hides what follows it. */
  const foldRow = (key: string, open: boolean, onToggle: () => void, icon: ReactNode, label: string, count: number, nested = false) => (
    <ListRow key={key} asChild interactive size="sm">
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn('w-full gap-2 text-xs text-muted-foreground', nested ? (dense ? 'pl-7' : 'pl-14') : dense ? '' : 'px-3')}>
        {icon}
        <span className="flex-1">{label} <span className="tabular-nums">{formatNumber(count)}</span></span>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
    </ListRow>
  )

  const section = (entries: CodexChatThread[]) => {
    const { top, branches } = arrange(entries)
    return top.map((entry) => {
      const kept = branches.get(entry.id) ?? []
      if (kept.length === 0) return row(entry)
      // The open chat never hides inside a folded group.
      const open = openBranches.has(entry.id) || kept.some((branch) => branch.id === activeThreadId)
      const toggle = () => setOpenBranches((current) => {
        const next = new Set(current)
        if (next.has(entry.id)) next.delete(entry.id)
        else next.add(entry.id)
        return next
      })
      return (
        <div key={entry.id}>
          {row(entry)}
          {foldRow(`branches-${entry.id}`, open, toggle, <GitBranch className="size-3.5" />, t({ ko: '수정 전 분기', en: 'Kept before edits' }), kept.length, true)}
          {open ? kept.map((branch) => row(branch, true)) : null}
        </div>
      )
    })
  }

  const archiveShown = archiveOpen || archived.some((entry) => entry.id === activeThreadId)
  // "All" is every chat the list shows now (folded branches included; the archive only while it is open).
  const shownIds = [...listed, ...(archiveShown ? archived : [])].map((entry) => entry.id)
  const allPickedArchived = selecting && pickedIds.every((id) => threads.find((entry) => entry.id === id)?.archived)
  const runBulk = async (action: ChatBulkAction, backupDate?: string) => {
    setBulkBusy(true)
    const ok = await onBulk(pickedIds, action, backupDate)
    setBulkBusy(false)
    setConfirmingDelete(false)
    if (ok) clearPicks()
  }
  const renameTitle = renaming?.title.replace(/\s+/g, ' ').trim() ?? ''
  const saveRename = () => {
    if (!renaming || !renameTitle) return
    onUpdate(renaming.id, { title: renameTitle })
    setRenaming(null)
  }

  return <>
    {section(listed)}
    {archived.length > 0 ? <>
      {foldRow('archive', archiveShown, () => setArchiveOpen((current) => !current), <Archive className="size-3.5" />, t({ ko: '보관함', en: 'Archive' }), archived.length)}
      {archiveShown ? section(archived) : null}
    </> : null}
    {selecting ? (
      <div className="sticky bottom-2 z-10 mx-1 mt-2 flex items-center gap-0.5 rounded-lg border border-line bg-surface-high py-1 pl-3 pr-1 shadow-[var(--elevation-2)]">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t({ ko: '{count}개 선택', en: '{count} selected' }, { count: formatNumber(pickedIds.length) })}</span>
        <IconButton variant="ghost" size="icon-sm" disabled={bulkBusy} onClick={() => setPicked(new Set(shownIds))} label={t({ ko: '전체 선택', en: 'Select all' })}><ListChecks /></IconButton>
        <IconButton variant="ghost" size="icon-sm" disabled={bulkBusy} onClick={() => void runBulk(allPickedArchived ? 'unarchive' : 'archive')} label={allPickedArchived ? t({ ko: '보관 해제', en: 'Unarchive' }) : t({ ko: '보관', en: 'Archive' })}>
          {allPickedArchived ? <ArchiveRestore /> : <Archive />}
        </IconButton>
        <IconButton variant="ghost" size="icon-sm" disabled={bulkBusy} className="text-destructive" onClick={() => setConfirmingDelete(true)} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton>
        <IconButton variant="ghost" size="icon-sm" disabled={bulkBusy} onClick={clearPicks} label={t({ ko: '선택 해제', en: 'Clear selection' })}><X /></IconButton>
      </div>
    ) : null}
    <ChatDeleteDialog open={confirmingDelete} count={pickedIds.length} book={null} pending={bulkBusy} onClose={() => setConfirmingDelete(false)} onConfirm={(choice) => void runBulk('delete', choice.backupDate)} />
    <Modal open={renaming !== null} onClose={() => setRenaming(null)} title={t({ ko: '이름 바꾸기', en: 'Rename' })} widthClassName="max-w-sm">
      <ModalBody>
        <Input
          autoFocus
          value={renaming?.title ?? ''}
          maxLength={60}
          aria-label={t({ ko: '채팅 이름', en: 'Chat name' })}
          onChange={(event) => setRenaming((current) => current ? { ...current, title: event.target.value } : current)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) saveRename() }}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button size="sm" disabled={!renameTitle} onClick={saveRename}>{t({ ko: '저장', en: 'Save' })}</Button>
      </ModalFooter>
    </Modal>
  </>
}

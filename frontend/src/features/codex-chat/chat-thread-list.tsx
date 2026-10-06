import { useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, GitBranch, MoreHorizontal, Pencil, Pin, PinOff } from 'lucide-react'
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
import { ChatProfileAvatar } from './chat-profile-avatar'

export type ChatListPatch = { title?: string; pinned?: boolean; archived?: boolean }

/**
 * The chats: pinned first, then the latest activity (as the server lists them). Each row shows the face it talks to,
 * its title, when it last moved and (roomy rows) the latest message or the unsent text. Branches kept before an edit
 * fold under the chat they came from; archived chats wait behind the archive row at the end.
 * `dense` is the page's side column; the panel's list screen uses roomier rows.
 */
export function ChatThreadList({ threads, profilesById, activeThreadId, runningThreadIds, drafts, dense = false, onSelect, onUpdate }: {
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
}) {
  const { t, formatDate, formatNumber } = useI18n()
  const [openBranches, setOpenBranches] = useState<ReadonlySet<number>>(() => new Set())
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null)
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
    return (
      <div key={entry.id} className={cn('group/row relative', nested && (dense ? 'pl-5' : 'pl-8'))}>
        <ListRow asChild interactive size={dense ? 'sm' : 'lg'} selected={entry.id === activeThreadId}>
          <button type="button" onClick={() => onSelect(entry.id)} className={cn('w-full', dense ? 'gap-2 pointer-coarse:pr-9' : 'gap-3 px-3 pointer-coarse:pr-11')}>
            {entry.kind === 'group'
              ? <GroupAvatarStack profiles={(entry.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? [])} size={dense ? 'xs' : 'sm'} ringClassName="ring-background" />
              : entryProfile ? <ChatProfileAvatar name={entryProfile.name} avatar={entryProfile.avatar} engine={entryProfile.engine} size={dense ? 'xs' : 'md'} /> : null}
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn('truncate', !dense && 'font-semibold')}>{entry.title || untitled}</span>
                {entry.pinned ? <Pin aria-label={t({ ko: '고정됨', en: 'Pinned' })} className="size-3 shrink-0 text-muted-foreground" /> : null}
              </span>
              {preview ? <span className="block truncate text-xs text-muted-foreground">{preview}</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-2 group-hover/row:invisible">
              {runningThreadIds.has(entry.id) ? <span role="img" aria-label={t({ ko: '답변 중', en: 'Replying' })} className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" /> : null}
              {Number.isNaN(movedAt.getTime()) ? null : <time className="text-2xs tabular-nums text-muted-foreground" dateTime={movedAt.toISOString()}>{whenLabel(movedAt)}</time>}
            </span>
          </button>
        </ListRow>
        <DropdownMenu>
          <Tip content={t({ ko: '채팅 관리', en: 'Manage chat' })}>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="icon-xs"
                tooltip={false}
                label={t({ ko: '채팅 관리', en: 'Manage chat' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => onUpdate(entry.id, { pinned: !entry.pinned })}>
              {entry.pinned ? <PinOff /> : <Pin />}{entry.pinned ? t({ ko: '고정 해제', en: 'Unpin' }) : t({ ko: '고정', en: 'Pin' })}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming({ id: entry.id, title: entry.title || '' })}><Pencil />{t({ ko: '이름 바꾸기', en: 'Rename' })}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onUpdate(entry.id, { archived: !entry.archived })}>
              {entry.archived ? <ArchiveRestore /> : <Archive />}{entry.archived ? t({ ko: '보관 해제', en: 'Unarchive' }) : t({ ko: '보관', en: 'Archive' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

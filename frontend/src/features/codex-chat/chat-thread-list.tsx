import { useEffect, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, CheckCheck, ChevronDown, ChevronRight, GitBranch, Trash2, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Panel } from '@/components/ui/panel'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { useI18n } from '@/i18n'
import type { ChatProfileSummary, CodexChatThreadSummary } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { ChatDeleteDialog } from './chat-delete-dialog'
import { useChatHealth } from './chat-health'
import { ChatThreadRow } from './chat-thread-row'
import { useCodexChatDrafts } from './codex-chat-context'
import { parseServerDate } from '@/lib/server-time'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { activeChatRoomOptions, ChatRoomPageMore, compareChatRoomActivity, useChatBranchParents, useChatRoomPages, useChatRoomSummaries } from './use-chat-room-directory'

export type ChatListPatch = { title?: string; pinned?: boolean; archived?: boolean; notify?: boolean }
export type ChatBulkAction = 'archive' | 'unarchive' | 'delete'

/** The chats tab's date headings, in list order: pinned chats, then by the day they last moved. */
type DateBucket = 'pinned' | 'today' | 'yesterday' | 'week' | 'older'
const DATE_BUCKETS: DateBucket[] = ['pinned', 'today', 'yesterday', 'week', 'older']
const DAY_MS = 86_400_000

function compareChatThreads(a: CodexChatThreadSummary, b: CodexChatThreadSummary) {
  return compareChatRoomActivity(a, b, true)
}

/**
 * The chats: pinned first, then the latest activity (as the server lists them), under date headings on the chats tab.
 * Each row shows the face it talks to, its title, when it last moved, how many replies are unread and the latest line
 * (whose it is) or the unsent text. Branches kept before an edit
 * fold under the chat they came from; archived chats wait behind the archive row at the end. Rooms an automation made
 * for itself (board calls, routines, workflow nodes) sit on their own 자동화 tab, shown once there is one; agent and
 * plugin rooms are grouped under their own headings there. A muted chat (bell off) keeps its row count but leaves the
 * shell badge.
 * `dense` is the page's side column; the panel's list screen uses roomier rows.
 *
 * Several chats are picked with "Select" in the row menu; while any is picked the faces turn into checks, a row click
 * ticks it, and a floating bar archives or deletes them (Esc lets go).
 */
export function ChatThreadList({ query = '', profilesById, activeThreadId, runningThreadIds, routineThreadIds, dense = false, onSelect, onUpdate, onBulk }: {
  query?: string
  profilesById: Map<number, ChatProfileSummary>
  activeThreadId: number | null
  /** Chats with a reply on its way (a dot on the row). */
  runningThreadIds: ReadonlySet<number>
  /** Chats an automation routine wakes (a small clock on the row). */
  routineThreadIds?: ReadonlySet<number>
  dense?: boolean
  onSelect: (threadId: number) => void
  onUpdate: (threadId: number, patch: ChatListPatch) => void
  /** Archive, unarchive or delete the picked chats; resolves true when all of them went through. */
  onBulk: (threadIds: number[], action: ChatBulkAction, backupDate?: string) => Promise<boolean>
}) {
  const { t, formatNumber } = useI18n()
  const drafts = useCodexChatDrafts()
  const healthOf = useChatHealth()
  // A room is cut off only when no member can answer; it shows the first member's reason.
  const groupDown = (memberIds: number[]) => memberIds.length > 0 && memberIds.every((id) => healthOf(id)) ? healthOf(memberIds[0]) : null
  const [openBranches, setOpenBranches] = useState<ReadonlySet<number>>(() => new Set())
  const [archiveOpen, setArchiveOpen] = useState(false)
  const search = useDebouncedValue(query)
  const activePage = useChatRoomPages(activeChatRoomOptions(search))
  const archivePage = useChatRoomPages({ archive: 'archived', pinnedFirst: true, query: search }, archiveOpen)
  const loadedRooms = [...activePage.rooms, ...(archiveOpen ? archivePage.rooms : [])]
  const selected = useChatRoomSummaries(activeThreadId === null ? [] : [activeThreadId], !loadedRooms.some((room) => room.id === activeThreadId))
  const activeRoom = loadedRooms.find((room) => room.id === activeThreadId) ?? selected.data?.[0]
  // Deep links and search results can select a room before its directory page has been opened.
  const contextRooms = !search.trim() && activeRoom ? [activeRoom, ...loadedRooms] : loadedRooms
  const parents = useChatBranchParents(contextRooms)
  const threads = [...new Map([...(parents.data ?? []), ...contextRooms].map((room) => [room.id, room])).values()]
    .sort(compareChatThreads)
  const [tab, setTab] = useState<'chats' | 'automation'>('chats')
  // Opening a chat from elsewhere (a link, the board) shows the tab it is on.
  const activeTab = activeRoom?.automation ? 'automation' : 'chats'
  useEffect(() => { setTab(activeTab) }, [activeThreadId, activeTab])
  useEffect(() => { if (activeRoom?.archived) setArchiveOpen(true) }, [activeRoom?.archived])
  const shownTab = activePage.hasAutomation ? tab : 'chats'
  const inTab = threads.filter((entry) => (shownTab === 'automation') === Boolean(entry.automation))
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
  const today = new Date()
  /** Calendar days from `date` to today (0: today). */
  const daysAgo = (date: Date) => Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / DAY_MS)
  const bucketLabel: Record<DateBucket, string> = {
    pinned: t({ ko: '고정됨', en: 'Pinned' }), today: t({ ko: '오늘', en: 'Today' }), yesterday: t({ ko: '어제', en: 'Yesterday' }),
    week: t({ ko: '지난 7일', en: 'Previous 7 days' }), older: t({ ko: '이전', en: 'Earlier' }),
  }
  const bucketOf = (entry: CodexChatThreadSummary): DateBucket => {
    if (entry.pinned) return 'pinned'
    const movedAt = parseServerDate(entry.updated_date)
    if (Number.isNaN(movedAt.getTime())) return 'older'
    const days = daysAgo(movedAt)
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : 'older'
  }

  const listed = inTab.filter((entry) => !entry.archived)
  const archived = archiveOpen ? inTab.filter((entry) => entry.archived) : []

  /** One section: its top rows (pinned first) and the kept-before-an-edit branches under each. */
  const arrange = (section: CodexChatThreadSummary[]) => {
    const ids = new Set(section.map((entry) => entry.id))
    const branches = new Map<number, CodexChatThreadSummary[]>()
    const top: CodexChatThreadSummary[] = []
    for (const entry of section) {
      const parent = !entry.pinned && entry.branch_purpose === 'preserve' ? entry.branched_from_thread_id ?? null : null
      if (parent !== null && ids.has(parent)) branches.set(parent, [...(branches.get(parent) ?? []), entry])
      else top.push(entry)
    }
    return { top: top.sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0)), branches }
  }

  const rename = (id: number, title: string) => setRenaming({ id, title })
  const row = (entry: CodexChatThreadSummary, nested = false) => <ChatThreadRow
    key={entry.id} entry={entry} profilesById={profilesById} draft={drafts[entry.id]}
    nested={nested} dense={dense} checked={picked.has(entry.id)} selecting={selecting} active={entry.id === activeThreadId}
    running={runningThreadIds.has(entry.id)} routine={routineThreadIds?.has(entry.id) ?? false}
    down={entry.kind === 'group' ? groupDown(entry.member_profile_ids ?? []) : healthOf(entry.profile_id)}
    onSelect={onSelect} onUpdate={onUpdate} onTogglePick={togglePick} onRename={rename}
  />

  /** A folding row ("kept branches 2", "archive 5"): shows or hides what follows it. */
  const foldRow = (key: string, open: boolean, onToggle: () => void, icon: ReactNode, label: string, count?: number, nested = false) => (
    <ListRow key={key} asChild interactive size="sm">
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn('w-full gap-2 text-xs text-muted-foreground', nested ? (dense ? 'pl-7' : 'pl-14') : dense ? '' : 'px-3')}>
        {icon}
        <span className="flex-1">{label} {count === undefined ? null : <span className="tabular-nums">{formatNumber(count)}</span>}</span>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
    </ListRow>
  )

  /** `byDate`: the top rows go under the date headings (their branches stay under them). */
  const section = (entries: CodexChatThreadSummary[], byDate = false) => {
    const { top, branches } = arrange(entries)
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    const activeParents = new Set<number>()
    let current = activeThreadId === null ? undefined : byId.get(activeThreadId)
    while (current && !current.pinned && current.branch_purpose === 'preserve' && current.branched_from_thread_id && !activeParents.has(current.branched_from_thread_id)) {
      activeParents.add(current.branched_from_thread_id)
      current = byId.get(current.branched_from_thread_id)
    }
    const render = (entry: CodexChatThreadSummary, nested = false): ReactNode => {
      const kept = branches.get(entry.id) ?? []
      if (kept.length === 0) return row(entry, nested)
      // The open chat never hides inside a folded group.
      const open = openBranches.has(entry.id) || activeParents.has(entry.id)
      const toggle = () => setOpenBranches((current) => {
        const next = new Set(current)
        if (next.has(entry.id)) next.delete(entry.id)
        else next.add(entry.id)
        return next
      })
      return (
        <div key={entry.id}>
          {row(entry, nested)}
          {foldRow(`branches-${entry.id}`, open, toggle, <GitBranch className="size-3.5" />, t({ ko: '수정 전 분기', en: 'Kept before edits' }), kept.length, true)}
          {open ? kept.map((branch) => render(branch, true)) : null}
        </div>
      )
    }
    if (!byDate) return top.map((entry) => render(entry))
    const buckets = new Map<DateBucket, CodexChatThreadSummary[]>()
    for (const entry of top) {
      const key = bucketOf(entry)
      buckets.set(key, [...(buckets.get(key) ?? []), entry])
    }
    return DATE_BUCKETS.flatMap((key) => {
      const rows = buckets.get(key)
      return rows ? [<RowGroup key={key} heading={bucketLabel[key]} className="mt-3">
        {rows.map((entry) => render(entry))}
      </RowGroup>] : []
    })
  }

  /**
   * The chats tab files its rows under date headings (`byDate`, not the archive); the 자동화 tab files agent rooms,
   * plugin rooms and the user's own automation (routines, workflows, boards) under their own headings.
   */
  const grouped = (entries: CodexChatThreadSummary[], byDate = false) => {
    if (shownTab !== 'automation') return section(entries, byDate)
    const groups = [
      { key: 'agent', heading: t({ ko: '에이전트', en: 'Agents' }), entries: entries.filter((entry) => entry.automation === 'agent') },
      { key: 'plugin', heading: t({ ko: '플러그인', en: 'Plugins' }), entries: entries.filter((entry) => entry.automation === 'plugin') },
      { key: 'user', heading: t({ ko: '내 자동화', en: 'My automation' }), entries: entries.filter((entry) => entry.automation !== 'agent' && entry.automation !== 'plugin') },
    ].filter((group) => group.entries.length > 0)
    if (groups.length <= 1) return section(entries)
    return <div className="space-y-6">
      {groups.map((group) => <RowGroup key={group.key} heading={group.heading}>{section(group.entries)}</RowGroup>)}
    </div>
  }

  const archiveShown = archiveOpen || archived.some((entry) => entry.id === activeThreadId)
  const hasArchive = shownTab === 'automation' ? activePage.hasArchivedAutomation : activePage.hasArchivedChats
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
    {activePage.hasAutomation ? (
      <SegmentedControl
        size="xs"
        fullWidth
        semantics="tabs"
        // w-auto, not fullWidth's w-full: w-full plus mx-3 is 24px wider than the list and scrolls it sideways.
        className={cn('mb-1 w-auto', !dense && 'mx-3')}
        value={shownTab}
        onChange={(value) => { setTab(value as 'chats' | 'automation'); clearPicks() }}
        ariaLabel={t({ ko: '채팅 종류', en: 'Chat kind' })}
        items={[
          { value: 'chats', label: t({ ko: '대화', en: 'Chats' }) },
          { value: 'automation', label: t({ ko: '자동화', en: 'Automation' }) },
        ]}
      />
    ) : null}
    {query.trim() ? <p className="px-3 py-1 text-xs text-muted-foreground">{t({ ko: '방 이름 · 캐릭터', en: 'Rooms · characters' })}</p> : null}
    {grouped(listed, true)}
    {parents.isError ? <Button variant="ghost" size="xs" onClick={() => void parents.refetch()}>{t({ ko: '분기 원본 다시 불러오기', en: 'Retry branch parents' })}</Button> : null}
    <ChatRoomPageMore page={activePage} />
    {hasArchive ? <>
      {foldRow('archive', archiveShown, () => setArchiveOpen((current) => !current), <Archive className="size-3.5" />, t({ ko: '보관된 채팅', en: 'Archived chats' }))}
      {archiveShown ? <>{grouped(archived)}<ChatRoomPageMore page={archivePage} /></> : null}
    </> : null}
    {selecting ? (
      <Panel treatment="floating" padding="toolbar" className="sticky bottom-2 z-10 mx-1 mt-2 flex items-center gap-0.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t({ ko: '{count}개 선택', en: '{count} selected' }, { count: formatNumber(pickedIds.length) })}</span>
        <IconButton variant="ghost" size="icon-sm" disabled={bulkBusy} onClick={() => setPicked(new Set(shownIds))} label={t({ ko: '전체 선택', en: 'Select all' })}><CheckCheck /></IconButton>
        <IconButton variant="ghost" size="icon-sm" disabled={bulkBusy} onClick={() => void runBulk(allPickedArchived ? 'unarchive' : 'archive')} label={allPickedArchived ? t({ ko: '보관 해제', en: 'Unarchive' }) : t({ ko: '보관', en: 'Archive' })}>
          {allPickedArchived ? <ArchiveRestore /> : <Archive />}
        </IconButton>
        <IconButton variant="destructive-ghost" size="icon-sm" disabled={bulkBusy} onClick={() => setConfirmingDelete(true)} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton>
        <IconButton variant="ghost" size="icon-sm" disabled={bulkBusy} onClick={clearPicks} label={t({ ko: '선택 해제', en: 'Clear selection' })}><X /></IconButton>
      </Panel>
    ) : null}
    <ChatDeleteDialog open={confirmingDelete} count={pickedIds.length} book={null} pending={bulkBusy} onClose={() => setConfirmingDelete(false)} onConfirm={(choice) => void runBulk('delete', choice.backupDate)} />
    <Modal open={renaming !== null} onClose={() => setRenaming(null)} title={t({ ko: '이름 바꾸기', en: 'Rename' })} size="sm">
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

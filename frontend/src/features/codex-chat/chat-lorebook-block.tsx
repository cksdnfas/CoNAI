import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookPlus, BookUp, ChevronDown, ChevronRight, Ellipsis, FileText, FolderOpen, Merge, Plus } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { ChatLoreEntryFields, loreBookFilesQueryKey, newLoreEntry, type LoreFilePlace } from '@/features/settings/components/chat-profile-lorebook'
import { useI18n } from '@/i18n'
import {
  CHAT_LOREBOOKS_QUERY_KEY,
  CHAT_STATUS_QUERY_KEY,
  OWN_LOREBOOKS_QUERY_KEY,
  getCodexChatStatus,
  getThreadLorebooks,
  keepThreadLorebook,
  listOwnLorebooks,
  loreEntryTitle,
  saveThreadLorebook,
  threadLorebooksQueryKey,
  updateCodexChatThreadContext,
  updateOwnLorebook,
  type ChatLoreEntry,
  type ThreadLoreBook,
} from '@/lib/api-codex-chat'
import { listStoredFolders } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { LorebookMergeDialog } from './lorebook-merge-dialog'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey, useCodexChat } from './codex-chat-context'

const CHAT_BOOK = 'chat'
const LOREBOOK_ROOT_FOLDER = '로어북'

type EditTarget = { book: typeof CHAT_BOOK | ThreadLoreBook; entry: ChatLoreEntry; isNew: boolean }
type MergeTarget = { entryIds?: string[]; targetId?: number | null }

function fileCount(entries: ChatLoreEntry[]) {
  return entries.filter((entry) => entry.file).length
}

/**
 * The context tab's lorebooks (A): the chat's own book first and open, then the books its requests attach — account
 * books linked to this chat, the profile's (a room: the members') books, global books — folded. An entry opens the
 * entry editor (B); a chat book entry can be promoted into an account book through the merge dialog (D).
 */
export function LorebookBlock({ threadId, profiles, loreAutoSave }: {
  threadId: number
  /** The chat's profile, or a room's members: whose model a merge can ask, and whose account book an entry is promoted into. */
  profiles: Array<{ id: number; name: string }>
  /** The chat's own lore auto-save switch (null: the chat settings). */
  loreAutoSave: 0 | 1 | null | undefined
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const chat = useCodexChat()
  const [expanded, setExpanded] = useState<Set<number | typeof CHAT_BOOK>>(() => new Set([CHAT_BOOK]))
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [merging, setMerging] = useState<MergeTarget | null>(null)

  const booksQuery = useQuery({ queryKey: threadLorebooksQueryKey(threadId), queryFn: () => getThreadLorebooks(threadId) })
  const ownQuery = useQuery({ queryKey: OWN_LOREBOOKS_QUERY_KEY, queryFn: listOwnLorebooks })
  const data = booksQuery.data
  const chatBook = data?.chatBook ?? null
  const chatEntries = chatBook?.entries ?? []
  const books = data?.books ?? []
  const linkedIds = data?.linkedIds ?? []
  const linkable = (ownQuery.data ?? []).filter((book) => book.kind === 'account' && !books.some((attached) => attached.id === book.id))
  // 승격: into the profile's first account book (a room: the first member's that has one).
  const promoteBook = books.find((book) => book.via === 'profile' && book.kind === 'account') ?? null
  const promoteName = promoteBook ? promoteBook.profiles[0]?.name ?? promoteBook.name : null

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: threadLorebooksQueryKey(threadId) }),
      queryClient.invalidateQueries({ queryKey: OWN_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY }),
    ])
  }
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })

  const entriesMutation = useMutation({
    mutationFn: ({ book, entries }: { book: EditTarget['book']; entries: ChatLoreEntry[] }) => (book === CHAT_BOOK ? saveThreadLorebook(threadId, entries) : updateOwnLorebook(book.id, { entries })),
    onSuccess: async () => {
      setEditing(null)
      await refresh()
    },
    onError,
  })
  const keepMutation = useMutation({
    mutationFn: () => keepThreadLorebook(threadId),
    onSuccess: async (book) => {
      showSnackbar({ message: t({ ko: '내 로어북 {name}(으)로 보관했어.', en: 'Kept as your lorebook {name}.' }, { name: book.name }), tone: 'info' })
      await refresh()
    },
    onError,
  })
  const linksMutation = useMutation({
    mutationFn: (lorebookIds: number[]) => updateCodexChatThreadContext(threadId, { lorebookIds }),
    onSuccess: refresh,
    onError,
  })
  const statusQuery = useQuery({ queryKey: CHAT_STATUS_QUERY_KEY, queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })
  const autoSaveMutation = useMutation({
    mutationFn: (value: boolean | null) => updateCodexChatThreadContext(threadId, { loreAutoSave: value }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) }),
        queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }),
      ])
    },
    onError,
  })
  const settingsDefault = statusQuery.data?.loreAutoSave
  const followLabel = settingsDefault === undefined
    ? t({ ko: '설정 따름', en: 'Settings' })
    : t({ ko: '설정 따름 ({state})', en: 'Settings ({state})' }, { state: settingsDefault ? t({ ko: '켬', en: 'on' }) : t({ ko: '끔', en: 'off' }) })

  const entriesOf = (book: EditTarget['book']) => (book === CHAT_BOOK ? chatEntries : book.entries)
  const saveEntry = (target: EditTarget, entry: ChatLoreEntry) => {
    const entries = entriesOf(target.book)
    entriesMutation.mutate({ book: target.book, entries: target.isNew ? [...entries, entry] : entries.map((item) => (item.id === entry.id ? entry : item)) })
  }
  const deleteEntry = (target: EditTarget) => entriesMutation.mutate({ book: target.book, entries: entriesOf(target.book).filter((item) => item.id !== target.entry.id) })
  const toggle = (key: number | typeof CHAT_BOOK) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const openFolder = async () => {
    try {
      const root = (await listStoredFolders()).find((folder) => folder.parentId === null && folder.name === LOREBOOK_ROOT_FOLDER)
      navigate(root ? `/files?folder=${encodeURIComponent(root.id)}` : '/files')
    } catch (error) {
      onError(error)
    }
  }

  const kindLabel = (book: ThreadLoreBook) => book.kind === 'global'
    ? t({ ko: '글로벌', en: 'Global' })
    : book.via === 'thread' ? t({ ko: '계정 · 이 채팅에', en: 'Account · this chat' }) : t({ ko: '프로필', en: 'Profile' })
  const countLabel = (entries: ChatLoreEntry[]) => {
    const files = fileCount(entries)
    return files > 0 ? t({ ko: '{count} · 자료 {files}', en: '{count} · {files} files' }, { count: entries.length, files }) : String(entries.length)
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-line py-2.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-sm">{t({ ko: '로어북', en: 'Lorebooks' })}</span>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <Tip content={t({ ko: '계정 로어북 연결', en: 'Link an account lorebook' })}>
              <DropdownMenuTrigger asChild>
                <IconButton variant="ghost" size="icon-sm" disabled={linksMutation.isPending} label={t({ ko: '계정 로어북 연결', en: 'Link an account lorebook' })} tooltip={false}><BookPlus /></IconButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="min-w-48">
              {linkable.map((book) => (
                <DropdownMenuItem key={book.id} onSelect={() => linksMutation.mutate([...linkedIds, book.id])}>
                  <span className="min-w-0 flex-1 truncate">{book.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{book.entries.length}</span>
                </DropdownMenuItem>
              ))}
              {linkable.length === 0 ? <DropdownMenuItem disabled>{t({ ko: '연결할 계정 로어북이 없어', en: 'No account lorebook to link' })}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton variant="ghost" size="icon-sm" disabled={chatEntries.length === 0} onClick={() => setMerging({})} label={t({ ko: '계정 로어북에 병합', en: 'Merge into an account lorebook' })}><Merge /></IconButton>
          <IconButton variant="ghost" size="icon-sm" onClick={() => void openFolder()} label={t({ ko: '파일 폴더 열기', en: 'Open the files folder' })}><FolderOpen /></IconButton>
        </div>
      </div>

      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{t({ ko: '로어 자동 저장', en: 'Save lore automatically' })}</span>
        <SegmentedControl
          size="xs"
          value={loreAutoSave === 1 ? 'on' : loreAutoSave === 0 ? 'off' : 'settings'}
          onChange={(mode) => autoSaveMutation.mutate(mode === 'settings' ? null : mode === 'on')}
          ariaLabel={t({ ko: '로어 자동 저장', en: 'Save lore automatically' })}
          items={[
            { value: 'settings', label: followLabel, disabled: autoSaveMutation.isPending },
            { value: 'on', label: t({ ko: '켬', en: 'On' }), disabled: autoSaveMutation.isPending },
            { value: 'off', label: t({ ko: '끔', en: 'Off' }), disabled: autoSaveMutation.isPending },
          ]}
        />
      </div>

      <div className="flex flex-col">
        <BookRow
          name={t({ ko: '이 채팅', en: 'This chat' })}
          kind={t({ ko: '채팅', en: 'Chat' })}
          accent
          count={countLabel(chatEntries)}
          open={expanded.has(CHAT_BOOK)}
          onToggle={() => toggle(CHAT_BOOK)}
          actions={(
            <>
              {chatBook ? <IconButton variant="ghost" size="icon-xs" disabled={keepMutation.isPending} onClick={() => keepMutation.mutate()} label={t({ ko: '내 로어북으로 보관', en: 'Keep as my lorebook' })}><BookUp /></IconButton> : null}
              <IconButton variant="ghost" size="icon-xs" disabled={chatEntries.length >= 500} onClick={() => setEditing({ book: CHAT_BOOK, entry: newLoreEntry(chatEntries.length), isNew: true })} label={t({ ko: '항목 추가', en: 'Add entry' })}><Plus /></IconButton>
            </>
          )}
        />
        {expanded.has(CHAT_BOOK) ? chatEntries.map((entry) => <EntryRow key={entry.id} entry={entry} onOpen={() => setEditing({ book: CHAT_BOOK, entry, isNew: false })} />) : null}
        {books.map((book) => {
          const editable = book.kind !== 'global'
          return (
            <div key={book.id} className="contents">
              <BookRow
                name={book.name}
                kind={kindLabel(book)}
                kindTip={book.via === 'profile' && book.profiles.length > 0 ? book.profiles.map((profile) => profile.name).join(', ') : undefined}
                count={countLabel(book.entries)}
                open={expanded.has(book.id)}
                onToggle={() => toggle(book.id)}
                actions={book.via === 'thread' ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '더 보기', en: 'More' })}><Ellipsis /></IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => linksMutation.mutate(linkedIds.filter((id) => id !== book.id))}>{t({ ko: '연결 해제', en: 'Unlink' })}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : undefined}
              />
              {expanded.has(book.id) ? book.entries.map((entry) => <EntryRow key={entry.id} entry={entry} onOpen={editable ? () => setEditing({ book, entry, isNew: false }) : undefined} />) : null}
            </div>
          )
        })}
      </div>

      <LoreEntryModal
        target={editing}
        usage={editing ? data?.entryUsage?.[`${editing.book === CHAT_BOOK ? chatBook?.id : editing.book.id}:${editing.entry.id}`] : undefined}
        onSource={(sourceThreadId, messageId) => {
          setEditing(null)
          chat?.selectThread(sourceThreadId)
          chat?.setView('chat')
          chat?.focusMessage(messageId)
        }}
        filePlace={!editing ? { kind: 'global' } : editing.book === CHAT_BOOK ? { kind: 'owned', folderId: chatBook?.folderId ?? null } : editing.book.kind === 'global' ? { kind: 'global' } : { kind: 'owned', folderId: editing.book.folderId }}
        promoteLabel={editing?.book === CHAT_BOOK && !editing.isNew ? (promoteName ? t({ ko: '승격 → {name}', en: 'Promote → {name}' }, { name: promoteName }) : t({ ko: '승격', en: 'Promote' })) : null}
        saving={entriesMutation.isPending}
        onSave={(entry) => editing && saveEntry(editing, entry)}
        onDelete={() => editing && deleteEntry(editing)}
        onPromote={() => {
          if (!editing) return
          setMerging({ entryIds: [editing.entry.id], targetId: promoteBook?.id ?? null })
          setEditing(null)
        }}
        onClose={() => setEditing(null)}
      />
      {chatBook ? (
        <LorebookMergeDialog
          open={merging !== null}
          sourceId={chatBook.id}
          targetId={merging?.targetId ?? null}
          entryIds={merging?.entryIds}
          profiles={profiles}
          defaultProfileId={profiles[0]?.id ?? null}
          onMerged={(result) => {
            setMerging(null)
            if (result) showSnackbar({ message: t({ ko: '{name}에 병합했어.', en: 'Merged into {name}.' }, { name: result.book.name }), tone: 'info' })
            void refresh()
            void queryClient.invalidateQueries({ queryKey: loreBookFilesQueryKey(result?.book.folderId ?? null) })
          }}
          onClose={() => setMerging(null)}
        />
      ) : null}
    </div>
  )
}

function BookRow({ name, kind, kindTip, accent, count, open, onToggle, actions }: {
  name: string
  kind: string
  kindTip?: string
  accent?: boolean
  count: string
  open: boolean
  onToggle: () => void
  actions?: React.ReactNode
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="flex min-h-9 items-center gap-1 border-t border-line first:border-t-0">
      {/* eslint-disable-next-line no-restricted-syntax -- a full-width disclosure row; Button would pad and centre it */}
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <Chevron className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        <Tip content={kindTip}>
          <span className={cn('shrink-0 text-2xs font-bold tracking-wide', accent ? 'text-primary' : 'text-muted-foreground')}>{kind}</span>
        </Tip>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{count}</span>
      </button>
      {actions}
    </div>
  )
}

function EntryRow({ entry, onOpen }: { entry: ChatLoreEntry; onOpen?: () => void }) {
  const { t } = useI18n()
  const fileName = entry.file ? entry.file.split('/').pop() : null
  const body = (
    <>
      <span className={cn('min-w-0 flex-1 truncate text-xs font-semibold', !entry.enabled && 'text-muted-foreground line-through')}>{loreEntryTitle(entry) || t({ ko: '새 항목', en: 'New entry' })}</span>
      {fileName ? <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs text-muted-foreground"><FileText className="size-3" aria-hidden />{fileName}</span> : null}
      {entry.constant ? <span className="shrink-0 text-2xs font-bold text-primary">{t({ ko: '상시', en: 'Always' })}</span> : null}
    </>
  )
  const className = 'flex items-center gap-2 border-t border-line py-1.5 pl-5 text-left'
  // The entry's text shows in a tooltip, not as a second line.
  const preview = entry.content ? (entry.content.length > 240 ? `${entry.content.slice(0, 240)}…` : entry.content) : null
  return onOpen
    // eslint-disable-next-line no-restricted-syntax -- a full-width entry row; Button would pad and centre it
    ? <Tip content={preview} side="left"><button type="button" onClick={onOpen} className={cn(className, 'w-full hover:bg-fill outline-none focus-visible:ring-2 focus-visible:ring-ring/40')}>{body}</button></Tip>
    : <Tip content={preview} side="left"><div className={className}>{body}</div></Tip>
}

/** B: one entry in the shared entry editor, as a modal (지우기 · 승격 · 저장). */
function LoreEntryModal({ target, filePlace, promoteLabel, saving, onSave, onDelete, onPromote, onClose, usage, onSource }: {
  usage?: { turnsAgo?: number; sourceMessageId?: number | null }
  onSource: (threadId: number, messageId: number) => void
  target: EditTarget | null
  filePlace: LoreFilePlace
  /** Chat book entries: "승격 → <name>". */
  promoteLabel: string | null
  saving: boolean
  onSave: (entry: ChatLoreEntry) => void
  onDelete: () => void
  onPromote: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<ChatLoreEntry | null>(null)
  const [openedFor, setOpenedFor] = useState<EditTarget | null>(null)
  // A new target starts the draft over (the modal stays mounted).
  if (target !== openedFor) {
    setOpenedFor(target)
    setDraft(target ? { ...target.entry } : null)
  }
  const entry = draft ?? target?.entry ?? null
  const dirty = Boolean(target && entry && JSON.stringify(entry) !== JSON.stringify(target.entry))
  const canSave = Boolean(entry && target) && !saving && Boolean(entry?.content.trim() || entry?.file) && (dirty || Boolean(target?.isNew))
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={entry ? loreEntryTitle(entry) || t({ ko: '새 항목', en: 'New entry' }) : ''}
      size="narrow"
      dirty={dirty}
      onSave={canSave && entry ? () => onSave(entry) : undefined}
      headerActions={entry ? <Switch checked={entry.enabled} onCheckedChange={(enabled) => setDraft((current) => current ? { ...current, enabled } : current)} aria-label={t({ ko: '로어 사용', en: 'Enable lore' })} /> : null}
      description={entry && (entry.source || usage?.turnsAgo !== undefined) ? <div className="flex items-center gap-3 text-xs">
        {entry.source ? usage?.sourceMessageId ? <Button variant="ghost" size="xs" className="h-auto p-0 text-primary" onClick={() => onSource(entry.source!.threadId, usage.sourceMessageId!)}>{t({ ko: '출처 답변', en: 'Source reply' })}</Button> : <span className="text-muted-foreground/50">{t({ ko: '출처 없음', en: 'Source unavailable' })}</span> : null}
        {usage?.turnsAgo !== undefined ? <span>{t({ ko: '최근 사용 · {count}턴 전', en: 'Last used · {count} turns ago' }, { count: usage.turnsAgo })}</span> : null}
      </div> : undefined}
    >
      {entry && target ? (
        <>
          <ModalBody>
            <ChatLoreEntryFields entry={entry} filePlace={filePlace} onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))} />
          </ModalBody>
          <EditorFooter onDelete={target.isNew ? undefined : onDelete} deleting={saving} onSave={() => onSave(entry)} canSave={canSave} saving={saving}>
            {promoteLabel ? <IconButton size="icon-sm" variant="ghost" disabled={saving} onClick={onPromote} label={promoteLabel}><BookUp /></IconButton> : null}
          </EditorFooter>
        </>
      ) : null}
    </Modal>
  )
}

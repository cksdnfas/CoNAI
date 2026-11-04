import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { useLocation, useNavigate, useSearchParams, type Location } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, BookUser, Download, Languages, RefreshCw, Trash2 } from 'lucide-react'
import { loreKeyLanguageLabel, sortLoreKeysByLanguage } from '@conai/shared'
import { EditorTitleInput } from '@/components/common/editor-page'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { FieldInfo } from '@/components/ui/field'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SwitchLine } from '@/components/ui/switch-line'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  OWN_LOREBOOKS_QUERY_KEY,
  ChatEditorResolution,
  chatLorebookQueryKey,
  createChatLorebook,
  createOwnLorebook,
  getChatLorebook,
  getOwnLorebook,
  importChatLorebook,
  isChatRevisionConflict,
  mergeLoreEntries,
  latestLoreEntryConflicts,
  loreEntryTitle,
  ownLorebookQueryKey,
  updateChatLorebook,
  updateOwnLorebook,
  type ChatLoreEntry,
  type ChatLorebook,
  type OwnedChatLorebook,
} from '@/lib/api-codex-chat'
import { ApiRequestError } from '@/lib/api-request'
import { getErrorMessage } from '@/lib/error-message'
import { useChatAdminLinks } from '@/features/codex-chat/chat-admin-location'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useEditorPageGuard } from '../use-unsaved-settings-guard'
import { ChatLorebookEditor, lacksLanguageKeys, newLoreEntry, useLoreKeyLanguage } from './chat-profile-lorebook'
import { ChatLoreKeyFillDialog } from './chat-lore-key-fill-dialog'
import { downloadChatLorebookFile } from './chat-lorebook-file'
import { useChatResourceDelete } from './use-chat-resource-actions'
import { CHAT_DOCK_INSET, useSettingsEditorChatPage } from './use-settings-editor-chat-page'

type Book = ChatLorebook | OwnedChatLorebook
type BookDraft = { name: string; entries: ChatLoreEntry[] }
type EditorDraft = BookDraft & { lorebook: Book | null; connectsChats: boolean }
type EditorActivity = { busy: boolean; importing: boolean }
type LorebookEditorHandle = {
  rename: (name: string) => void
  save: () => void
  close: () => void
  fill: () => void
  exportFile: () => void
  updateFile: () => void
  remove: () => void
}

const storedConnects = (book: Book | null) => book?.connectsChats !== false

export function mergeBookDraft(previous: Book, latest: Book, draft: BookDraft) {
  const nameEdited = draft.name !== previous.name
  const merged = mergeLoreEntries(previous.entries, latest.entries, draft.entries)
  const conflicts = { name: nameEdited && latest.name !== previous.name && latest.name !== draft.name, entries: merged.conflicts }
  return {
    draft: { name: nameEdited ? draft.name : latest.name, entries: merged.entries },
    conflicts,
  }
}

export function latestBookConflicts(latest: Book, draft: BookDraft, conflicts: { name: boolean; entries: string[] }): BookDraft {
  return { name: conflicts.name ? latest.name : draft.name, entries: latestLoreEntryConflicts(draft.entries, latest.entries, conflicts.entries) }
}

/** The `?lorebook=` of a book's editor modal: a shared book by id, an account book as `account-<id>`, or a new one of either kind. */
export function lorebookKey(target: Pick<Book, 'id' | 'kind'> | 'new' | 'new-account') {
  return typeof target === 'string' ? target : target.kind === 'account' ? `account-${target.id}` : String(target.id)
}
function parseLorebookKey(raw: string | null): { kind: 'global' | 'account'; id: number | null } | null {
  if (raw === 'new') return { kind: 'global', id: null }
  if (raw === 'new-account') return { kind: 'account', id: null }
  const account = raw?.match(/^account-(\d+)$/)
  if (account && Number.isSafeInteger(Number(account[1])) && Number(account[1]) > 0) return { kind: 'account', id: Number(account[1]) }
  return raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? { kind: 'global', id: Number(raw) } : null
}

/** Leaving the open book (its address changes). */
function leavesLorebook(current: Location, next: Location) {
  if (current.pathname !== next.pathname) return true
  const before = new URLSearchParams(current.search)
  const after = new URLSearchParams(next.search)
  const from = before.get('lorebook')
  const to = after.get('lorebook')
  return from !== to || before.get('tab') !== after.get('tab') || before.get('section') !== after.get('section')
}

/**
 * A URL-backed modal over either host's lorebook list. Saving reaches every profile that links the book.
 */
export function ChatLorebookEditorModal() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const links = useChatAdminLinks()
  const [params] = useSearchParams()
  const raw = params.get('lorebook')
  const created = useRef<string | null>(null)
  const [session, setSession] = useState({ address: raw, key: 0 })
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [activity, setActivity] = useState<EditorActivity>({ busy: false, importing: false })
  const editor = useRef<LorebookEditorHandle>(null)
  const keyLanguage = useLoreKeyLanguage()
  const listParams = new URLSearchParams(params)
  listParams.delete('lorebook')
  const listSearch = listParams.toString()
  const listPath = `${location.pathname}${listSearch ? `?${listSearch}` : ''}`
  const back = () => navigate(listPath)
  const target = parseLorebookKey(raw)
  const sharedQuery = useQuery({ queryKey: chatLorebookQueryKey(target?.id ?? 0), queryFn: ({ signal }) => getChatLorebook(target!.id!, signal), enabled: target?.kind === 'global' && target.id !== null })
  const ownQuery = useQuery({ queryKey: ownLorebookQueryKey(target?.id ?? 0), queryFn: ({ signal }) => getOwnLorebook(target!.id!, signal), enabled: target?.kind === 'account' && target.id !== null })
  const query = target?.kind === 'account' ? ownQuery : sharedQuery
  const found = !target || target.id === null ? null : query.data ?? null
  const notFound = query.error instanceof ApiRequestError && query.error.status === 404
  const ready = target !== null && (target.id === null || found !== null)
  if (session.address !== raw) {
    const adoptingCreated = created.current !== null && raw === created.current
    setSession({ address: raw, key: adoptingCreated ? session.key : session.key + 1 })
    created.current = null
    if (!adoptingCreated) setDraft(null)
  } else if (ready && !draft) {
    // Detail refreshes do not replace a draft already opened at this address.
    setDraft({ lorebook: found, name: found?.name ?? '', entries: found?.entries ?? [], connectsChats: storedConnects(found) })
  }
  const current = ready ? draft : null
  const lorebook = current?.lorebook ?? null
  const owned = (lorebook?.kind ?? target?.kind) === 'account'
  const dirty = current !== null && (current.name !== (lorebook?.name ?? '') || (owned && current.connectsChats !== storedConnects(lorebook)) || current.entries.length !== (lorebook?.entries.length ?? 0) || current.entries.some((entry, index) => entry !== lorebook?.entries[index] && JSON.stringify(entry) !== JSON.stringify(lorebook?.entries[index])))
  const missing = current && keyLanguage ? current.entries.filter((entry) => lacksLanguageKeys(entry, keyLanguage)) : []
  const linkedProfiles = lorebook?.profiles.length ?? 0
  return (
    <Modal
      open size="xl" height="tall" sidePanelInset={CHAT_DOCK_INSET} closeOnBack={false}
      dirty={dirty} onClose={() => { if (current) editor.current?.close(); else back() }}
      onSave={current ? () => editor.current?.save() : undefined}
      title={current ? <div className="flex min-w-0 flex-1 items-center gap-2">
        <EditorTitleInput as="span" value={current.name} label={t({ ko: '로어북 이름', en: 'Lorebook name' })} placeholder={owned ? t({ ko: '새 계정 로어북', en: 'New account lorebook' }) : t({ ko: '새 로어북', en: 'New lorebook' })} maxLength={80} invalid={!current.name.trim()} readOnly={activity.importing} onChange={(name) => editor.current?.rename(name)} />
        <ChatFilledLabel fieldId="name"><span className="sr-only">{t({ ko: '이름', en: 'Name' })}</span></ChatFilledLabel>
      </div> : t({ ko: '로어북', en: 'Lorebook' })}
      leading={current ? owned ? <BookUser /> : <BookOpen /> : undefined}
      status={current ? <>
        <Chip tone="muted" size="sm">{owned ? t({ ko: '내 계정 로어북', en: 'Account lorebook' }) : t({ ko: '공용 로어북', en: 'Shared lorebook' })}</Chip>
        <Chip tone="muted" size="sm">{t({ ko: '항목 {count}개', en: '{count} entries' }, { count: current.entries.length })}</Chip>
        <Chip tone="muted" size="sm">{keyLanguage ? t({ ko: '키워드 · EN + {language}', en: 'Keywords · EN + {language}' }, { language: loreKeyLanguageLabel(keyLanguage) }) : t({ ko: '키워드 · EN', en: 'Keywords · EN' })}</Chip>
        {linkedProfiles ? <Chip tone="primary" size="sm">{t({ ko: '프로필 {count}개에서 사용', en: 'Used by {count} profiles' }, { count: linkedProfiles })}</Chip> : null}
      </> : undefined}
      actions={current ? <ActionMenuButton label={t({ ko: '로어북 작업', en: 'Lorebook actions' })} entries={[
        keyLanguage ? { key: 'fill', label: missing.length ? t({ ko: '빠진 {language} 키 채우기 {count}', en: 'Fill missing {language} keywords ({count})' }, { language: loreKeyLanguageLabel(keyLanguage), count: missing.length }) : t({ ko: '빠진 {language} 키 없음', en: 'No {language} keywords missing' }, { language: loreKeyLanguageLabel(keyLanguage) }), icon: Languages, disabled: missing.length === 0 || activity.busy, onSelect: () => editor.current?.fill() } : null,
        { key: 'export', label: t({ ko: '내보내기', en: 'Export' }), icon: Download, disabled: activity.importing, onSelect: () => editor.current?.exportFile() },
        lorebook && !owned ? { key: 'file', label: t({ ko: '파일로 업데이트', en: 'Update from file' }), icon: RefreshCw, disabled: activity.busy, onSelect: () => editor.current?.updateFile() } : null,
        lorebook ? '-' : null,
        lorebook ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: activity.busy, onSelect: () => editor.current?.remove() } : null,
      ]} /> : undefined}
    >
      {current ? <LorebookEditor
        key={session.key}
        ref={editor}
        draft={current}
        setDraft={(update) => setDraft((draft) => draft ? update(draft) : draft)}
        owned={owned}
        dirty={dirty}
        keyLanguage={keyLanguage}
        missing={missing}
        onActivityChange={setActivity}
        listPath={listPath}
        onSaved={(saved, allowNavigation) => {
          if (target!.id !== null) return
          const address = lorebookKey(saved)
          const path = links.lorebook(address)
          // Router navigation is transitional; keep the current session until the created address actually lands.
          created.current = address
          allowNavigation(path, () => navigate(path, { replace: true }))
        }}
      /> : <ModalBody>
        {target && query.isPending ? <LoadingState variant="inline" /> : target && query.isError && !notFound
          ? <ErrorState title={t({ ko: '로어북을 불러오지 못했어', en: 'Could not load the lorebook' })} error={query.error} onRetry={() => void query.refetch()} />
          : <EmptyState icon={BookOpen} title={t({ ko: '로어북을 찾지 못했어', en: 'Lorebook not found' })} action={<Button variant="secondary" size="sm" onClick={back}>{t({ ko: '로어북 목록', en: 'Lorebook list' })}</Button>} />}
      </ModalBody>}
    </Modal>
  )
}

function LorebookEditor({ ref, draft, setDraft, owned, dirty, keyLanguage, missing, onActivityChange, listPath, onSaved }: {
  ref: Ref<LorebookEditorHandle>
  draft: EditorDraft
  setDraft: (update: (current: EditorDraft) => EditorDraft) => void
  owned: boolean
  dirty: boolean
  keyLanguage: string | null
  missing: ChatLoreEntry[]
  onActivityChange: (activity: EditorActivity) => void
  listPath: string
  onSaved: (saved: Book, allowNavigation: ReturnType<typeof useEditorPageGuard>['allowNavigation']) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const { lorebook, name, entries, connectsChats } = draft
  const [fillOpen, setFillOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importing = useRef(false)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const nameRef = useRef(name)
  nameRef.current = name
  const connectsRef = useRef(connectsChats)
  connectsRef.current = connectsChats
  const folderId = lorebook && 'folderId' in lorebook ? lorebook.folderId : null
  const back = () => navigate(listPath)
  const { mounted, allowNavigation } = useEditorPageGuard(dirty, t({ ko: '로어북에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This lorebook has unsaved changes that will be lost.' }), leavesLorebook)
  const takeSaved = (book: Book, submitted: { name: string; entries: ChatLoreEntry[]; connectsChats: boolean }) => {
    setDraft((current) => ({
      lorebook: book,
      name: current.name === submitted.name ? book.name : current.name,
      entries: current.entries === submitted.entries ? book.entries : current.entries,
      connectsChats: current.connectsChats === submitted.connectsChats ? storedConnects(book) : current.connectsChats,
    }))
  }

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: OWN_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: async () => {
      let submitted = { name, entries, connectsChats }
      if (entries.length > 500) throw new Error(t({ ko: '항목이 500개를 넘었어. 줄인 뒤 저장해.', en: 'There are more than 500 entries. Remove some before saving.' }))
      if (!lorebook) {
        const saved = await (owned ? createOwnLorebook(submitted) : createChatLorebook({ name, entries }))
        return { saved, submitted }
      }
      const write = (base: Book, value: BookDraft & { connectsChats: boolean }) => {
        if (value.entries.length > 500) throw new Error(t({ ko: '합친 항목이 500개를 넘었어. 줄인 뒤 저장해.', en: 'The merged book exceeds 500 entries. Remove some before saving.' }))
        // The switch goes out only when it differs from the stored book, so a save never resets someone else's change.
        return owned
          ? updateOwnLorebook(base.id, { name: value.name, entries: value.entries, ...(value.connectsChats !== storedConnects(base) ? { connectsChats: value.connectsChats } : {}), revision: base.revision })
          : updateChatLorebook(base.id, { name: value.name, entries: value.entries, revision: base.revision })
      }
      try {
        return { saved: await write(lorebook, submitted), submitted }
      } catch (error) {
        if (!isChatRevisionConflict(error)) throw error
        const latest = error.current as Book
        if (!mounted.current) throw error
        const conflictDraft = { name: nameRef.current, entries: entriesRef.current }
        const merged = mergeBookDraft(lorebook, latest, conflictDraft)
        // A boolean has no partial merge: an edited switch wins, an untouched one takes the latest.
        const mergedConnects = connectsRef.current !== storedConnects(lorebook) ? connectsRef.current : storedConnects(latest)
        if (merged.conflicts.name || merged.conflicts.entries.length) {
          const titles = new Map([...lorebook.entries, ...latest.entries, ...conflictDraft.entries].map((entry) => [entry.id, loreEntryTitle(entry) || entry.id]))
          const fields = [...(merged.conflicts.name ? [t({ ko: '이름', en: 'name' })] : []), ...merged.conflicts.entries.map((id) => `“${titles.get(id)}”`)].join(' · ')
          const load = await confirm({
            title: t({ ko: '로어북이 다른 곳에서 바뀌었어', en: 'The lorebook changed elsewhere' }),
            description: t({ ko: '{fields} 변경이 겹쳤어. 이 항목만 고르고, 나머지는 합칠게.', en: 'Conflicting changes: {fields}. Choose only these; all other changes are merged.' }, { fields }),
            confirmLabel: t({ ko: '최신 불러오기', en: 'Load latest' }),
            cancelLabel: t({ ko: '덮어쓰기', en: 'Overwrite' }),
          })
          if (nameRef.current !== conflictDraft.name || entriesRef.current !== conflictDraft.entries) throw new ChatEditorResolution(t({ ko: '편집이 바뀌었어. 다시 저장해.', en: 'The draft changed. Save again.' }), error)
          if (load) {
            const resolved = latestBookConflicts(latest, merged.draft, merged.conflicts)
            nameRef.current = resolved.name
            entriesRef.current = resolved.entries
            setDraft((current) => ({ ...current, lorebook: latest, ...resolved }))
            throw new ChatEditorResolution(t({ ko: '최신 로어북을 불러왔어.', en: 'Loaded the latest lorebook.' }), error)
          }
          const overwrite = await confirm({
            title: t({ ko: '다른 쪽 {fields} 변경을 버릴까?', en: 'Discard the other {fields} changes?' }, { fields }),
            confirmLabel: t({ ko: '덮어쓰기', en: 'Overwrite' }),
            cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
            tone: 'destructive',
          })
          if (nameRef.current !== conflictDraft.name || entriesRef.current !== conflictDraft.entries) throw new ChatEditorResolution(t({ ko: '편집이 바뀌었어. 다시 저장해.', en: 'The draft changed. Save again.' }), error)
          if (!overwrite) throw new ChatEditorResolution(t({ ko: '저장을 멈췄어.', en: 'Save stopped.' }), error)
        }
        if (!mounted.current) throw error
        submitted = { ...merged.draft, connectsChats: mergedConnects }
        nameRef.current = submitted.name
        entriesRef.current = submitted.entries
        connectsRef.current = submitted.connectsChats
        setDraft(() => ({ lorebook: latest, ...submitted }))
        return { saved: await write(latest, submitted), submitted }
      }
    },
    onSuccess: async ({ saved, submitted }) => {
      await refresh()
      if (!mounted.current) return
      if (!saved) { allowNavigation(listPath, back); return }
      takeSaved(saved, submitted)
      queryClient.setQueryData(owned ? ownLorebookQueryKey(saved.id) : chatLorebookQueryKey(saved.id), saved)
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }), tone: 'info' })
      onSaved(saved, allowNavigation)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: error instanceof ChatEditorResolution ? 'info' : 'error' }),
  })
  const deleteMutation = useChatResourceDelete(() => {
    if (mounted.current) allowNavigation(listPath, back)
  })
  // A newer file replaces the shared book's entries; the editor takes the stored result.
  const fileMutation = useMutation({
    mutationFn: (file: File) => importChatLorebook(file, lorebook?.id),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      if (!mounted.current) return
      setDraft((current) => ({ ...current, lorebook: updated, name: updated.name, entries: updated.entries }))
      showSnackbar({ message: t({ ko: '{name} 업데이트했어. 항목 {count}개.', en: 'Updated {name}: {count} entries.' }, { name: updated.name, count: updated.entries.length }), tone: 'info' })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '파일로 업데이트하지 못했어.', en: 'Could not update from the file.' })), tone: 'error' }),
    onSettled: () => { importing.current = false },
  })

  const canSave = Boolean(name.trim()) && !saveMutation.isPending && !fileMutation.isPending && !deleteMutation.isPending && (dirty || !lorebook)
  const assertImportFinished = () => {
    if (importing.current || fileMutation.isPending) throw new Error(t({ ko: '파일 업데이트가 끝난 뒤 편집해줘.', en: 'Wait for the file update before editing.' }))
  }
  // A connected chat reads the book, adds or replaces entries (draft) and asks to save it with a card.
  useSettingsEditorChatPage({
    open: true,
    title: lorebook ? t({ ko: '로어북 편집 · {name}', en: 'Edit lorebook · {name}' }, { name: lorebook.name }) : t({ ko: '로어북 추가', en: 'Add lorebook' }),
    resourceId: `lorebook:${lorebook?.id ?? 'new'}`,
    localRevision: JSON.stringify([entries, keyLanguage, lorebook?.revision]),
    dirty,
    fields: fileMutation.isPending ? [] : [
      { id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: name },
      ...(owned ? [{ id: 'connectsChats', label: t({ ko: '다른 채팅과 대화 기록 연결 (끄면 로어만 공유)', en: 'Connect chats through this book (off: lore only)' }), type: 'boolean' as const, value: connectsChats }] : []),
    ],
    data: {
      kind: owned ? 'account' : 'global',
      keyLanguage,
      entries: entries.slice(0, 200).map((entry) => ({ id: entry.id, title: entry.title ?? '', keys: entry.keys, localKeys: entry.localKeys ?? [], content: entry.content.slice(0, 2000), language: entry.language ?? null, translation: entry.translation ? { ...entry.translation, content: entry.translation.content.slice(0, 2000) } : null, enabled: entry.enabled, constant: entry.constant, ...(entry.excludeRecursion ? { excludeRecursion: true } : {}), ...(entry.preventRecursion ? { preventRecursion: true } : {}) })),
      selected: { name, entries: entries.length },
    },
    apply: (patch) => {
      assertImportFinished()
      setDraft((current) => ({
        ...current,
        ...(patch.name !== undefined ? { name: String(patch.name) } : {}),
        ...(owned && patch.connectsChats !== undefined ? { connectsChats: patch.connectsChats === true } : {}),
      }))
    },
    actions: fileMutation.isPending ? [] : [pageAction('lorebook.entries', t({ ko: '로어북 항목 채우기', en: 'Fill lorebook entries' }), t({ ko: '항목을 뒤에 더하거나(append) 전부 바꿔(replace). 저장하지 않아. keys는 이 단어가 대화에 나오면 content가 들어가는 영어 키워드, localKeys는 같은 키워드를 keyLanguage(로어북 추가 언어)로 쓴 것, constant는 항상 넣기. exclude/preventRecursion은 재귀 스캔에서 안 걸림/안 부름.', en: 'Append entries or replace them all; nothing is saved. keys are English keywords that trigger the content when they appear in the chat, localKeys the same keywords in keyLanguage (the lorebooks’ other language); constant always includes it. exclude/preventRecursion: not triggered by / not triggering others in recursive scans.' }), pageObject({
      mode: pageChoice(['append', 'replace']),
      entries: pageArray(pageObject({ title: pageText(120), keys: pageArray(pageText(100), 20), localKeys: pageArray(pageText(100), 20), content: pageText(8000), language: pageChoice(['en', 'ko', 'ja', 'zh']), translation: pageObject({ language: pageChoice(['en', 'ko', 'ja', 'zh']), title: pageText(80), keys: pageArray(pageText(100), 20), content: pageText(8000) }, ['language', 'title', 'keys', 'content']), constant: { type: 'boolean' }, enabled: { type: 'boolean' }, excludeRecursion: { type: 'boolean' }, preventRecursion: { type: 'boolean' } }, ['keys', 'content']), 50, 1),
    }, ['mode', 'entries']))],
    applyAction: (id, args) => {
      assertImportFinished()
      if (id !== 'lorebook.entries' || !Array.isArray(args.entries)) throw new Error('로어북 편집기에 없는 작업이야.')
      const before = entriesRef.current
      const base = args.mode === 'replace' ? [] : before
      const added = args.entries.map((raw, index) => {
        const entry = raw as Partial<ChatLoreEntry> & { keys: string[]; content: string }
        return sortLoreKeysByLanguage({ ...newLoreEntry(base.length + index), title: entry.title ?? '', keys: entry.keys, localKeys: entry.localKeys ?? [], content: entry.content, ...(entry.language ? { language: entry.language } : {}), ...(entry.translation ? { translation: entry.translation } : {}), constant: entry.constant === true, enabled: entry.enabled !== false, ...(entry.excludeRecursion ? { excludeRecursion: true } : {}), ...(entry.preventRecursion ? { preventRecursion: true } : {}) }, entry.language ? null : keyLanguage)
      })
      const next = [...base, ...added]
      setDraft((current) => ({ ...current, entries: next }))
      return { isCurrent: () => !importing.current && entriesRef.current === next, restore: () => { assertImportFinished(); setDraft((current) => ({ ...current, entries: before })) } }
    },
    save: canSave ? () => { assertImportFinished(); return saveMutation.mutateAsync() } : undefined,
  })

  const handleRevert = async () => {
    const confirmed = await confirm({
      title: t({ ko: '변경 되돌리기', en: 'Revert changes' }),
      description: t({ ko: '저장하지 않은 변경을 모두 되돌릴까?', en: 'Revert every unsaved change?' }),
      confirmLabel: t({ ko: '되돌리기', en: 'Revert' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    })
    if (confirmed) setDraft((current) => ({ ...current, name: lorebook?.name ?? '', entries: lorebook?.entries ?? [], connectsChats: storedConnects(lorebook) }))
  }

  const save = () => { if (canSave) saveMutation.mutate() }
  const busy = saveMutation.isPending || fileMutation.isPending || deleteMutation.isPending
  useLayoutEffect(() => {
    onActivityChange({ busy, importing: fileMutation.isPending })
  }, [busy, fileMutation.isPending, onActivityChange])
  useImperativeHandle(ref, () => ({
    rename: (name) => { if (!importing.current) setDraft((current) => ({ ...current, name })) },
    save,
    close: () => allowNavigation(listPath, back),
    fill: () => setFillOpen(true),
    exportFile: () => downloadChatLorebookFile(name, entries),
    updateFile: () => fileRef.current?.click(),
    remove: () => { if (lorebook) void deleteMutation.mutate({ kind: 'lorebook', resource: lorebook }) },
  }))

  return (
    <>
      <ModalBody>
      <fieldset disabled={fileMutation.isPending} className="contents" aria-busy={fileMutation.isPending || undefined}>
        {owned ? (
          <SwitchLine
            label={<ChatFilledLabel fieldId="connectsChats">
              {t({ ko: '다른 채팅과 대화 기록 연결', en: 'Connect chats through this book' })}
              <FieldInfo>{t({ ko: '켜면 이 책을 함께 쓰는 채팅끼리 지난 대화를 서로 찾아 읽어. 세계관처럼 설정만 나눠 쓰는 책은 꺼 두면 로어만 들어가고 대화는 섞이지 않아.', en: 'On: chats sharing this book can search each other’s past talk. Turn it off for a setting book shared by separate chats: they get the lore, never each other’s talk.' })}</FieldInfo>
            </ChatFilledLabel>}
            checked={connectsChats}
            onCheckedChange={(connectsChats) => setDraft((current) => ({ ...current, connectsChats }))}
          />
        ) : null}
        <ChatLorebookEditor entries={entries} onChange={(entries) => { if (!importing.current) setDraft((current) => ({ ...current, entries })) }} filePlace={owned ? { kind: 'owned', folderId } : { kind: 'global' }} keyLanguage={keyLanguage} />
      </fieldset>
      </ModalBody>
      <EditorFooter onSave={save} canSave={canSave} saving={saveMutation.isPending} onRevert={() => void handleRevert()} canRevert={dirty && !busy}>
        {!name.trim() ? <Text variant="caption" tone="muted" aria-live="polite">{t({ ko: '이름을 적어야 저장할 수 있어', en: 'Needs a name to save' })}</Text> : null}
      </EditorFooter>
      {keyLanguage ? <ChatLoreKeyFillDialog open={fillOpen} language={keyLanguage} entries={missing} onClose={() => setFillOpen(false)} onApply={(keys) => { if (!importing.current) setDraft((current) => ({ ...current, entries: current.entries.map((entry) => keys[entry.id] ? { ...entry, localKeys: [...new Set([...(entry.localKeys ?? []), ...keys[entry.id]])].slice(0, 20) } : entry) })) }} /> : null}
      <input ref={fileRef} type="file" accept=".json,.lorebook,.png,application/json,image/png" className="hidden" aria-label={t({ ko: '로어북 파일', en: 'Lorebook file' })} onChange={async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        if (dirty && !await confirm({
          title: t({ ko: '파일로 업데이트', en: 'Update from file' }),
          description: t({ ko: '저장하지 않은 변경을 버리고 파일 내용으로 바꿀까?', en: 'Discard unsaved changes and replace them with the file?' }),
          confirmLabel: t({ ko: '업데이트', en: 'Update' }),
          cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
          tone: 'destructive',
        })) return
        importing.current = true
        fileMutation.mutate(file)
      }} />
    </>
  )
}

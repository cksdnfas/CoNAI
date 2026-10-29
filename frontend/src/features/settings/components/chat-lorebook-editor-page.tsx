import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, type Location } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Languages, RefreshCw, Trash2 } from 'lucide-react'
import { loreKeyLanguageLabel, sortLoreKeysByLanguage } from '@conai/shared'
import { EditorPage } from '@/components/common/editor-page'
import type { PathCrumb } from '@/components/common/path-breadcrumbs'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Field } from '@/components/ui/field'
import { FloatingSaveBar } from '@/components/ui/floating-save-bar'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  OWN_LOREBOOKS_QUERY_KEY,
  ChatEditorResolution,
  chatLorebookQueryKey,
  createChatLorebook,
  createOwnLorebook,
  deleteChatLorebook,
  deleteOwnLorebook,
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
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useEditorPageGuard } from '../use-unsaved-settings-guard'
import { ChatLorebookEditor, lacksLanguageKeys, newLoreEntry, useLoreKeyLanguage } from './chat-profile-lorebook'
import { ChatLoreKeyFillDialog } from './chat-lore-key-fill-dialog'
import { useSettingsEditorChatPage } from './use-settings-editor-chat-page'

type Book = ChatLorebook | OwnedChatLorebook
type BookDraft = { name: string; entries: ChatLoreEntry[] }

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

/** The lorebook list of 채팅 자원, where the editor page returns to. */
export const LOREBOOKS_PATH = '/chat/resources?tab=lorebooks'
/** A lorebook's editor page: a shared book by id, an account book as `account-<id>`, or a new one of either kind. */
export function lorebookEditorPath(target: Pick<Book, 'id' | 'kind'> | 'new' | 'new-account') {
  const key = typeof target === 'string' ? target : target.kind === 'account' ? `account-${target.id}` : String(target.id)
  return `${LOREBOOKS_PATH}&lorebook=${key}`
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
  return from !== to || before.get('tab') !== after.get('tab')
}

const lorebookCrumbs = (t: ReturnType<typeof useI18n>['t'], navigate: ReturnType<typeof useNavigate>): PathCrumb[] => [
  { key: 'resources', label: t({ ko: '채팅 자원', en: 'Chat resources' }), onClick: () => navigate('/chat/resources') },
  { key: 'lorebooks', label: t({ ko: '로어북', en: 'Lorebooks' }), onClick: () => navigate(LOREBOOKS_PATH) },
]

/**
 * One lorebook as a page (채팅 자원 › 로어북 › ?lorebook=<key>): a shared (global) book, or one of the signed-in
 * account's own (a 로어북/ folder in its file store). Saving reaches every profile that links it.
 */
export function ChatLorebookEditorPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const raw = params.get('lorebook')
  const target = parseLorebookKey(raw)
  const sharedQuery = useQuery({ queryKey: chatLorebookQueryKey(target?.id ?? 0), queryFn: ({ signal }) => getChatLorebook(target!.id!, signal), enabled: target?.kind === 'global' && target.id !== null })
  const ownQuery = useQuery({ queryKey: ownLorebookQueryKey(target?.id ?? 0), queryFn: ({ signal }) => getOwnLorebook(target!.id!, signal), enabled: target?.kind === 'account' && target.id !== null })
  const query = target?.kind === 'account' ? ownQuery : sharedQuery
  const found = !target || target.id === null ? null : query.data ?? null
  const notFound = query.error instanceof ApiRequestError && query.error.status === 404
  if (!target || (target.id !== null && !found)) {
    return (
      <EditorPage crumbs={lorebookCrumbs(t, navigate)} title={t({ ko: '로어북', en: 'Lorebook' })}>
        {target && query.isPending ? <LoadingState variant="inline" /> : target && query.isError && !notFound
          ? <ErrorState title={t({ ko: '로어북을 불러오지 못했어', en: 'Could not load the lorebook' })} error={query.error} onRetry={() => void query.refetch()} />
          : <EmptyState icon={BookOpen} title={t({ ko: '로어북을 찾지 못했어', en: 'Lorebook not found' })} action={<Button variant="secondary" size="sm" onClick={() => navigate(LOREBOOKS_PATH)}>{t({ ko: '로어북 목록', en: 'Lorebook list' })}</Button>} />}
      </EditorPage>
    )
  }
  // The stored book is read once per address: later detail refreshes never replace the entries being edited.
  return <LorebookEditor key={raw} initial={found} kind={target.kind} />
}

function LorebookEditor({ initial, kind }: { initial: Book | null; kind: 'global' | 'account' }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  /** The stored book the draft started from (null: a new one). */
  const [lorebook, setLorebook] = useState(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [entries, setEntries] = useState<ChatLoreEntry[]>(initial?.entries ?? [])
  const [fillOpen, setFillOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importing = useRef(false)
  const keyLanguage = useLoreKeyLanguage()
  const owned = (lorebook?.kind ?? kind) !== 'global'
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const nameRef = useRef(name)
  nameRef.current = name
  const folderId = lorebook && 'folderId' in lorebook ? lorebook.folderId : null
  const back = () => navigate(LOREBOOKS_PATH)
  const takeSaved = (book: Book, submitted: { name: string; entries: ChatLoreEntry[] }) => {
    setLorebook(book)
    setName((current) => current === submitted.name ? book.name : current)
    setEntries((current) => current === submitted.entries ? book.entries : current)
  }

  const missing = keyLanguage ? entries.filter((entry) => lacksLanguageKeys(entry, keyLanguage)) : []

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: OWN_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: async () => {
      let submitted = { name, entries }
      if (entries.length > 500) throw new Error(t({ ko: '항목이 500개를 넘었어. 줄인 뒤 저장해.', en: 'There are more than 500 entries. Remove some before saving.' }))
      if (!lorebook) {
        const saved = await (owned ? createOwnLorebook(submitted) : createChatLorebook(submitted))
        return { saved, submitted }
      }
      const write = (base: Book, value: BookDraft) => {
        if (value.entries.length > 500) throw new Error(t({ ko: '합친 항목이 500개를 넘었어. 줄인 뒤 저장해.', en: 'The merged book exceeds 500 entries. Remove some before saving.' }))
        return owned
          ? updateOwnLorebook(base.id, { ...value, revision: base.revision })
          : updateChatLorebook(base.id, { ...value, revision: base.revision })
      }
      try {
        return { saved: await write(lorebook, submitted), submitted }
      } catch (error) {
        if (!isChatRevisionConflict(error)) throw error
        const latest = error.current as Book
        if (!mounted.current) throw error
        const conflictDraft = { name: nameRef.current, entries: entriesRef.current }
        const merged = mergeBookDraft(lorebook, latest, conflictDraft)
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
            setLorebook(latest)
            setName(resolved.name)
            setEntries(resolved.entries)
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
        submitted = merged.draft
        nameRef.current = submitted.name
        entriesRef.current = submitted.entries
        setLorebook(latest)
        setName(submitted.name)
        setEntries(submitted.entries)
        return { saved: await write(latest, submitted), submitted }
      }
    },
    onSuccess: async ({ saved, submitted }) => {
      await refresh()
      if (!mounted.current) return
      if (!saved) { allowNavigation(LOREBOOKS_PATH, back); return }
      takeSaved(saved, submitted)
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }), tone: 'info' })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: error instanceof ChatEditorResolution ? 'info' : 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => (owned ? deleteOwnLorebook(lorebook?.id ?? 0) : deleteChatLorebook(lorebook?.id ?? 0)),
    onSuccess: async () => {
      await refresh()
      if (!mounted.current) return
      allowNavigation(LOREBOOKS_PATH, back)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })
  // A newer file replaces the shared book's entries; the editor takes the stored result.
  const fileMutation = useMutation({
    mutationFn: (file: File) => importChatLorebook(file, lorebook?.id),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      if (!mounted.current) return
      setLorebook(updated)
      setName(updated.name)
      setEntries(updated.entries)
      showSnackbar({ message: t({ ko: '{name} 업데이트했어. 항목 {count}개.', en: 'Updated {name}: {count} entries.' }, { name: updated.name, count: updated.entries.length }), tone: 'info' })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '파일로 업데이트하지 못했어.', en: 'Could not update from the file.' })), tone: 'error' }),
    onSettled: () => { importing.current = false },
  })

  const dirty = name !== (lorebook?.name ?? '') || entries.length !== (lorebook?.entries.length ?? 0) || entries.some((entry, index) => entry !== lorebook?.entries[index] && JSON.stringify(entry) !== JSON.stringify(lorebook?.entries[index]))
  const canSave = Boolean(name.trim()) && !saveMutation.isPending && !fileMutation.isPending && !deleteMutation.isPending && (dirty || !lorebook)
  const assertImportFinished = () => {
    if (importing.current || fileMutation.isPending) throw new Error(t({ ko: '파일 업데이트가 끝난 뒤 편집해줘.', en: 'Wait for the file update before editing.' }))
  }
  const { mounted, allowNavigation } = useEditorPageGuard(dirty, t({ ko: '로어북에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This lorebook has unsaved changes that will be lost.' }), leavesLorebook)
  // Keep later edits on the new route until saved or discarded; remounting before then would lose them.
  useEffect(() => {
    if (dirty || !lorebook || initial !== null || saveMutation.isPending || fileMutation.isPending) return
    const path = lorebookEditorPath(lorebook)
    queryClient.setQueryData(owned ? ownLorebookQueryKey(lorebook.id) : chatLorebookQueryKey(lorebook.id), lorebook)
    allowNavigation(path, () => navigate(path, { replace: true }))
  }, [dirty, lorebook, initial, owned, saveMutation.isPending, fileMutation.isPending, allowNavigation, navigate, queryClient])
  // A connected chat reads the book, adds or replaces entries (draft) and asks to save it with a card.
  useSettingsEditorChatPage({
    open: true,
    title: lorebook ? t({ ko: '로어북 편집 · {name}', en: 'Edit lorebook · {name}' }, { name: lorebook.name }) : t({ ko: '로어북 추가', en: 'Add lorebook' }),
    resourceId: `lorebook:${lorebook?.id ?? 'new'}`,
    dirty,
    fields: fileMutation.isPending ? [] : [{ id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: name }],
    data: {
      kind: owned ? 'account' : 'global',
      keyLanguage,
      entries: entries.slice(0, 200).map((entry) => ({ id: entry.id, title: entry.title ?? '', keys: entry.keys, localKeys: entry.localKeys ?? [], content: entry.content.slice(0, 2000), language: entry.language ?? null, translation: entry.translation ? { ...entry.translation, content: entry.translation.content.slice(0, 2000) } : null, enabled: entry.enabled, constant: entry.constant, ...(entry.excludeRecursion ? { excludeRecursion: true } : {}), ...(entry.preventRecursion ? { preventRecursion: true } : {}) })),
      selected: { name, entries: entries.length },
    },
    apply: (patch) => { assertImportFinished(); if (patch.name !== undefined) setName(String(patch.name)) },
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
      setEntries(next)
      return { isCurrent: () => !importing.current && entriesRef.current === next, restore: () => { assertImportFinished(); setEntries(before) } }
    },
    save: canSave ? () => { assertImportFinished(); return saveMutation.mutateAsync() } : undefined,
  })

  const handleDelete = async () => {
    const linked = lorebook?.profiles.length ?? 0
    const confirmed = await confirm({
      title: t({ ko: '로어북 삭제', en: 'Delete lorebook' }),
      description: linked > 0
        ? t({ ko: '프로필 {count}개에서 쓰는 중이야. 지우면 연결도 같이 풀려.', en: 'Used by {count} profiles. Deleting also unlinks it from them.' }, { count: linked })
        : t({ ko: '이 로어북을 지울까?', en: 'Delete this lorebook?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }
  const handleRevert = async () => {
    const confirmed = await confirm({
      title: t({ ko: '변경 되돌리기', en: 'Revert changes' }),
      description: t({ ko: '저장하지 않은 변경을 모두 되돌릴까?', en: 'Revert every unsaved change?' }),
      confirmLabel: t({ ko: '되돌리기', en: 'Revert' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    })
    if (confirmed) { setName(lorebook?.name ?? ''); setEntries(lorebook?.entries ?? []) }
  }

  const save = () => { if (canSave) saveMutation.mutate() }
  const linkedProfiles = lorebook?.profiles.length ?? 0

  return (
    <EditorPage
      crumbs={lorebookCrumbs(t, navigate)}
      title={name.trim() || lorebook?.name || (owned ? t({ ko: '새 계정 로어북', en: 'New account lorebook' }) : t({ ko: '새 로어북', en: 'New lorebook' }))}
      status={<>
        <Chip tone="muted" size="sm">{owned ? t({ ko: '내 계정 로어북', en: 'Account lorebook' }) : t({ ko: '공용 로어북', en: 'Shared lorebook' })}</Chip>
        {linkedProfiles ? <Chip tone="primary" size="sm">{t({ ko: '프로필 {count}개에서 사용', en: 'Used by {count} profiles' }, { count: linkedProfiles })}</Chip> : null}
      </>}
      actions={<>
        {keyLanguage ? (
          <Button size="sm" variant="ghost" disabled={missing.length === 0 || fileMutation.isPending} onClick={() => setFillOpen(true)}>
            <Languages />
            {missing.length ? t({ ko: '빠진 {language} 키 채우기 {count}', en: 'Fill missing {language} keywords ({count})' }, { language: loreKeyLanguageLabel(keyLanguage), count: missing.length }) : t({ ko: '빠진 {language} 키 없음', en: 'No {language} keywords missing' }, { language: loreKeyLanguageLabel(keyLanguage) })}
          </Button>
        ) : null}
        <ActionMenuButton
          label={t({ ko: '로어북 작업', en: 'Lorebook actions' })}
          entries={[
            lorebook && !owned ? { key: 'file', label: t({ ko: '파일로 업데이트', en: 'Update from file' }), icon: RefreshCw, disabled: fileMutation.isPending || saveMutation.isPending || deleteMutation.isPending, onSelect: () => fileRef.current?.click() } : null,
            '-',
            lorebook ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: deleteMutation.isPending || saveMutation.isPending || fileMutation.isPending, onSelect: () => void handleDelete() } : null,
          ]}
        />
      </>}
      onSave={save}
      saveBar={dirty || saveMutation.isPending ? (
        <FloatingSaveBar
          label={lorebook ? t({ ko: '저장 안 한 변경', en: 'Unsaved changes' }) : t({ ko: '새 로어북', en: 'New lorebook' })}
          saving={saveMutation.isPending}
          canSave={canSave}
          onSave={save}
          onDiscard={fileMutation.isPending ? undefined : () => void handleRevert()}
        >
          {name.trim() ? null : <span className="text-xs text-muted-foreground">{t({ ko: '이름을 적어야 저장할 수 있어', en: 'Needs a name to save' })}</span>}
        </FloatingSaveBar>
      ) : null}
    >
      <fieldset disabled={fileMutation.isPending} className="contents" aria-busy={fileMutation.isPending || undefined}>
        <Field label={<ChatFilledLabel fieldId="name">{t({ ko: '이름', en: 'Name' })}</ChatFilledLabel>}>
          <Input variant="settings" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <ChatLorebookEditor entries={entries} onChange={(next) => { if (!importing.current) setEntries(next) }} filePlace={owned ? { kind: 'owned', folderId } : { kind: 'global' }} keyLanguage={keyLanguage} />
      </fieldset>
      {keyLanguage ? <ChatLoreKeyFillDialog open={fillOpen} language={keyLanguage} entries={missing} onClose={() => setFillOpen(false)} onApply={(keys) => { if (!importing.current) setEntries((current) => current.map((entry) => keys[entry.id] ? { ...entry, localKeys: [...new Set([...(entry.localKeys ?? []), ...keys[entry.id]])].slice(0, 20) } : entry)) }} /> : null}
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
    </EditorPage>
  )
}

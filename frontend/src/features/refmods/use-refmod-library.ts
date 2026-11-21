import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Location } from 'react-router-dom'
import { REFMOD_ENTRY_LIMITS, type MiniMaxH3RefModKind } from '@conai/shared'
import { positiveLibraryId, useLibraryLocation } from '@/components/common/use-library-location'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { loadNextBatch } from '@/features/characters/character-library-shared'
import { useEditorPageGuard } from '@/features/settings/use-unsaved-settings-guard'
import { useI18n } from '@/i18n'
import { getGenerationQueue } from '@/lib/api-image-generation-queue'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import { COMFY_REFMOD_LIBRARY_QUERY_ROOT, COMFY_REFMOD_RECORDS_QUERY_ROOT, createMiniMaxH3RefModExportWorkflow } from '@/lib/api-image-generation-workflows'
import {
  adoptRefMods,
  buildRefModEntry,
  bulkRefModEntries,
  createRefModEntry,
  downloadRefModExport,
  getRefModBuildJob,
  getRefModEntry,
  importRefModBundle,
  invalidateRefModEntries,
  isRefModNameConflict,
  listRefModEntries,
  listRefModEntryNames,
  listRefModWorkflows,
  listUnregisteredRefMods,
  getRefModPresence,
  REFMOD_ENTRIES_PAGE_SIZE,
  REFMOD_ENTRY_SORTS,
  refModEntryNamesQueryKey,
  refModEntryPagesQueryKey,
  refModEntryQueryKey,
  refModPresenceQueryKey,
  refModUnregisteredQueryKey,
  refModWorkflowsQueryKey,
  type RefModEntryBulkInput,
  type RefModEntryScope,
  type RefModEntrySort,
  type RefModEntrySummary,
  type RefModImportConflict,
} from '@/lib/api-refmod-entries'
import { getErrorMessage } from '@/lib/error-message'
import type { ImageRecord } from '@/types/image'
import {
  makeRefModNameLookup,
  REFMOD_CONCEPTS,
  REFMOD_SERVER_FILTERS,
  refModLightboxItems,
  refModRecordThumbs,
  type RefModRowThumb,
  type RefModServerFilter,
} from './refmod-shared'
import { useRefModEntryEditor } from './use-refmod-entry-editor'

const ACTIVE_QUEUE_STATUSES: Array<GenerationQueueJobRecord['status']> = ['queued', 'dispatching', 'running']
/** The header queue widget's cache entry: the runtime-event bridge keeps it current, so following a build adds no polling. */
const ACTIVE_QUEUE_QUERY_KEY = ['image-generation-queue', 'header-widget', 'global-active'] as const
const ADOPT_BATCH = 500

const leavesEntry = (current: Location, next: Location) => current.pathname !== next.pathname || new URLSearchParams(current.search).get('entry') !== new URLSearchParams(next.search).get('entry')

/** A copy's name: ` (2)`, ` (3)`… after the original, within the name limit. */
function copyName(name: string, copy: number) {
  const suffix = ` (${copy})`
  return name.slice(0, REFMOD_ENTRY_LIMITS.name - suffix.length) + suffix
}

function matchesText(terms: string[], ...texts: string[]) {
  const haystack = texts.join('\n').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/** A row with no entry: a saved run record, or a name only the default server's library has. */
export type RefModUnregisteredRow =
  | { kind: 'record'; key: string; recordId: number; name: string; conceptType: string; description: string; thumbs: RefModRowThumb[]; kinds: MiniMaxH3RefModKind[]; createdAt: string }
  | { kind: 'server'; key: string; name: string; conceptType: string; description: string; thumbs: RefModRowThumb[]; kinds: MiniMaxH3RefModKind[] }

/** A build this page started: its queue job, when it was seen, and the entry's latest run before it (its own run is newer). */
type FollowedBuild = { jobId: number; since: number; name: string; afterRecordId: number }

/**
 * Everything the RefMod view holds (/characters?view=refmods): the URL state (`q` search, `sv` server filter, `c`
 * concept, `sort`, `entry` the open entry), the scrolled list, the default server's library (loaded on its own, the
 * list never waits for it), the unregistered rows, the several-select, the open entry's editor, the builds being
 * followed and every action the screen offers. The page renders from it; the page assistant (stage B3) reads and drives
 * the same state and actions.
 */
export function useRefModLibrary() {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const authStatus = useAuthStatusQuery().data
  const canEdit = permissions.has('characters.edit')
  const canBuild = canEdit && permissions.canExecuteGeneration
  const canAddWorkflow = permissions.canUpdateWorkflows
  const { params, query, searchText, setSearchText, update } = useLibraryLocation(REFMOD_ENTRIES_PAGE_SIZE, ['entry'])
  const sortParam = params.get('sort') as RefModEntrySort | null
  const sort: RefModEntrySort = sortParam && REFMOD_ENTRY_SORTS.includes(sortParam) ? sortParam : 'updated'
  const serverParam = params.get('sv') as RefModServerFilter | null
  const serverFilter: RefModServerFilter = serverParam && REFMOD_SERVER_FILTERS.includes(serverParam) ? serverParam : 'all'
  const conceptParam = params.get('c') ?? ''
  const concept = (REFMOD_CONCEPTS as readonly string[]).includes(conceptParam) ? conceptParam : ''
  const openEntryId = positiveLibraryId(params.get('entry'))

  const editor = useRefModEntryEditor({ entryId: openEntryId, onClose: () => update({ entry: null }) })
  const allowLeave = useCallback((current: Location, next: Location) => current.pathname === next.pathname && editor.deletedRef.current && !new URLSearchParams(next.search).has('entry'), [editor.deletedRef])
  useEditorPageGuard(canEdit && editor.dirty, t({ ko: 'RefMod에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This RefMod has unsaved changes that will be lost.' }), leavesEntry, allowLeave)

  const setListView = (changes: { sort?: RefModEntrySort; server?: RefModServerFilter; concept?: string }) => update({
    ...(changes.sort !== undefined ? { sort: changes.sort === 'updated' ? null : changes.sort } : {}),
    ...(changes.server !== undefined ? { sv: changes.server === 'all' ? null : changes.server } : {}),
    ...(changes.concept !== undefined ? { c: changes.concept || null } : {}),
  })
  const search = (text: string, replace = false) => update({ q: text.trim() || null }, replace)
  const openEntry = (id: number) => { if (!editor.isBusy()) update({ entry: String(id) }) }
  const closeEntry = () => {
    if (editor.isBusy()) showSnackbar({ message: t({ ko: '저장이나 업로드가 끝난 뒤 닫을 수 있어.', en: 'Close it after the save or upload finishes.' }), tone: 'info' })
    else update({ entry: null })
  }
  // The shared location stops its search debounce while an entry is open; the field still searches (keeping it open).
  const searchOpenEditor = useEffectEvent((text: string) => search(text, true))
  useEffect(() => {
    if (!editor.open || searchText.trim() === query) return
    const timer = window.setTimeout(() => searchOpenEditor(searchText), 300)
    return () => window.clearTimeout(timer)
  }, [editor.open, searchText, query])

  // ---------------------------------------------------------------- builds being followed
  /** Builds this page started, by entry, until their queue job leaves the active queue. */
  const [builds, setBuilds] = useState<ReadonlyMap<number, FollowedBuild>>(new Map())
  /** Entries whose build request is on its way (the key shows pending right away). */
  const [starting, setStarting] = useState<ReadonlySet<number>>(new Set())

  const scope: RefModEntryScope = { query, concept, favorite: false, sort, limit: REFMOD_ENTRIES_PAGE_SIZE }
  const [listPending, setListPending] = useState(false)
  const list = useInfiniteQuery({
    queryKey: refModEntryPagesQueryKey(scope),
    queryFn: ({ pageParam, signal }) => listRefModEntries({ ...scope, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((sum, page) => sum + page.items.length, 0) : undefined),
    placeholderData: keepPreviousData,
    // A run that ends while nobody follows its job (another tab, a reload) shows up on a slow re-read.
    refetchInterval: listPending ? 15_000 : false,
  })
  /** Every loaded entry of the scope, in order (undefined until the first batch lands). */
  const loaded = list.data?.pages.flatMap((batch) => batch.items)
  const total = list.data?.pages[0]?.total
  const loadMore = list.hasNextPage ? async () => (await loadNextBatch(list)).flatMap((batch) => batch.items) : null
  const anyPending = Boolean(loaded?.some((entry) => entry.pending)) || Boolean(editor.latest?.pending)
  if (listPending !== anyPending) setListPending(anyPending)

  /** The default server's library, read live and on its own: the list never waits for it. */
  const presence = useQuery({ queryKey: refModPresenceQueryKey, queryFn: ({ signal }) => getRefModPresence(signal), staleTime: 60_000, retry: false })
  const presenceOk = presence.data?.status === 'ok' ? presence.data : null
  const onServerName = makeRefModNameLookup(presenceOk?.entries.map((entry) => entry.name) ?? [])
  const isOnServer = (name: string) => onServerName(name) !== null
  /** The default server's id: the Director editor's RefMod library and the build target. */
  const defaultServerId = presenceOk?.serverId

  const showsUnregistered = serverFilter === 'all' || serverFilter === 'unregistered'
  const unregistered = useQuery({ queryKey: refModUnregisteredQueryKey, queryFn: ({ signal }) => listUnregisteredRefMods(signal), enabled: showsUnregistered })
  const entryNames = useQuery({ queryKey: refModEntryNamesQueryKey, queryFn: ({ signal }) => listRefModEntryNames(signal), enabled: showsUnregistered && Boolean(presenceOk) })
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const recordRows: RefModUnregisteredRow[] = (unregistered.data ?? []).map((record) => ({
    kind: 'record', key: `record:${record.recordId}`, recordId: record.recordId, name: record.name, conceptType: record.conceptType,
    description: record.description, thumbs: refModRecordThumbs(t, record.recordId, record.members, canViewImages),
    kinds: record.members.map((member) => member.kind), createdAt: record.createdAt,
  }))
  // A server name no entry and no unregistered record has (exact, then case-insensitive); known once every name is read.
  const entryName = makeRefModNameLookup(entryNames.data ?? [])
  const recordName = makeRefModNameLookup(recordRows.map((row) => row.name))
  const serverRows: RefModUnregisteredRow[] = presenceOk && entryNames.data ? presenceOk.entries
    .filter((entry) => entryName(entry.name) === null && recordName(entry.name) === null)
    .map((entry) => ({
      kind: 'server', key: `server:${entry.name}`, name: entry.name, conceptType: entry.concept, description: entry.description,
      kinds: entry.members.map((member) => member.kind),
      thumbs: entry.members.map((member, index) => ({ key: String(index), kind: member.kind, label: member.description || `${member.kind} ${index + 1}`, thumbnailUrl: null, fileUrl: null })),
    })) : []
  /** Unregistered rows of the scope (search and concept apply). */
  const unregisteredRows = showsUnregistered ? [...recordRows, ...serverRows].filter((row) => (!concept || row.conceptType === concept)
    && matchesText(terms, row.name, row.description, ...row.thumbs.map((thumb) => thumb.label))) : []
  const visibleEntries = serverFilter === 'unregistered' ? []
    : (serverFilter === 'on' || serverFilter === 'off') && presenceOk ? loaded?.filter((entry) => isOnServer(entry.name) === (serverFilter === 'on'))
      : loaded
  const isPending = (entry: Pick<RefModEntrySummary, 'id' | 'pending'>) => entry.pending || builds.has(entry.id) || starting.has(entry.id)

  // A run can register a new entry, adopt a reported name or add a server name, so the names and unregistered rows are
  // read again with the server's library (the server-only rows are its names minus the entries').
  const refreshAfterRun = (entryIds: number[]) => Promise.all([
    invalidateRefModEntries(queryClient, { entryIds, listsChanged: entryIds.length === 0 }),
    queryClient.invalidateQueries({ queryKey: refModEntryNamesQueryKey }),
    queryClient.invalidateQueries({ queryKey: refModUnregisteredQueryKey }),
    queryClient.invalidateQueries({ queryKey: refModPresenceQueryKey }),
    queryClient.invalidateQueries({ queryKey: COMFY_REFMOD_LIBRARY_QUERY_ROOT }),
    queryClient.invalidateQueries({ queryKey: COMFY_REFMOD_RECORDS_QUERY_ROOT }),
  ])

  const canViewQueue = authStatus !== undefined && (authStatus.hasCredentials !== true || authStatus.authenticated === true)
  const activeQueue = useQuery({
    queryKey: ACTIVE_QUEUE_QUERY_KEY,
    queryFn: () => getGenerationQueue({ status: ACTIVE_QUEUE_STATUSES }),
    enabled: canViewQueue && (builds.size > 0 || anyPending),
  })
  /**
   * A followed build left the active queue: refresh the entry, the list and the server, and say how it went (a failure
   * with the server's reason). The run record is saved a moment after the job, so the entry is read again a few times
   * until its run settles; a job that is still active goes back to being followed.
   */
  const finishBuild = async (entryId: number, build: FollowedBuild) => {
    const job = await getRefModBuildJob(build.jobId).catch(() => null)
    if (job && ACTIVE_QUEUE_STATUSES.includes(job.status)) {
      setBuilds((current) => new Map(current).set(entryId, { ...build, since: Date.now() }))
      return
    }
    if (job?.status === 'cancelled') {
      void refreshAfterRun([entryId])
      showSnackbar({ message: t({ ko: '‘{name}’ 만들기를 취소했어.', en: 'Cancelled building ‘{name}’.' }, { name: build.name }), tone: 'info' })
      return
    }
    const failed = (reason: string | null | undefined) => showSnackbar({
      message: t({ ko: '‘{name}’을(를) 만들지 못했어: {reason}', en: 'Could not build ‘{name}’: {reason}' }, { name: build.name, reason: reason || t({ ko: '알 수 없는 오류', en: 'unknown error' }) }),
      tone: 'error',
    })
    for (const delay of [0, 3_000, 5_000, 10_000, 20_000]) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
      await refreshAfterRun([entryId])
      const entry = await queryClient.fetchQuery({ queryKey: refModEntryQueryKey(entryId), queryFn: ({ signal }) => getRefModEntry(entryId, signal), staleTime: 0 }).catch(() => null)
      // Runs are newest first; this build's run is the newest one after the run seen when it started.
      const run = entry?.records.find((record) => record.id > build.afterRecordId) ?? null
      if (run?.status === 'failed') { failed(run.error || job?.failure_message); return }
      if (job?.status === 'failed' && (!run || run.status !== 'pending')) { failed(job.failure_message || job.failure_code); return }
      if (run?.status === 'saved') {
        showSnackbar({ message: t({ ko: '‘{name}’을(를) 만들었어.', en: 'Built ‘{name}’.' }, { name: entry?.name ?? build.name }), tone: 'info' })
        return
      }
      if (!entry || (!entry.pending && !run)) return
    }
  }
  const previousActiveIds = useRef<ReadonlySet<number> | null>(null)
  const onQueueChange = useEffectEvent(() => {
    const records = activeQueue.data?.records
    if (!records) return
    const active = new Set(records.map((record) => record.id))
    const ended = [...builds].filter(([, build]) => activeQueue.dataUpdatedAt > build.since && !active.has(build.jobId))
    if (ended.length) {
      setBuilds((current) => {
        const next = new Map(current)
        for (const [entryId] of ended) next.delete(entryId)
        return next
      })
      for (const [entryId, build] of ended) void finishBuild(entryId, build)
    }
    // Another job left the queue while rows wait on a run nobody here follows: read the list again.
    const previous = previousActiveIds.current
    previousActiveIds.current = active
    if (!ended.length && anyPending && previous && [...previous].some((id) => !active.has(id))) void refreshAfterRun([])
  })
  useEffect(() => { onQueueChange() }, [activeQueue.dataUpdatedAt])

  const onError = (error: unknown, fallback: string) => showSnackbar({ message: getErrorMessage(error, fallback), tone: 'error' })

  /**
   * Build on the default server: an unsaved open draft is saved first; the row and window follow the queue job. True
   * once the build is queued (the page assistant reports a refusal, which the snackbar already showed).
   */
  const build = async (entry: Pick<RefModEntrySummary, 'id' | 'name' | 'lastRecord'>): Promise<boolean> => {
    if (starting.has(entry.id) || builds.has(entry.id)) return false
    setStarting((current) => new Set(current).add(entry.id))
    try {
      if (editor.base?.id === entry.id && editor.dirty) {
        try { await editor.save() } catch { return false } // The editor reported why.
      }
      const afterRecordId = Math.max(entry.lastRecord?.id ?? 0, ...(editor.latest?.id === entry.id ? editor.latest.records.map((record) => record.id) : []))
      const result = await buildRefModEntry(entry.id)
      setBuilds((current) => new Map(current).set(entry.id, { jobId: result.jobId, since: Date.now(), name: entry.name, afterRecordId }))
      void invalidateRefModEntries(queryClient, { entryIds: [entry.id] })
      void queryClient.invalidateQueries({ queryKey: ['image-generation-queue'] })
      showSnackbar({ message: t({ ko: '‘{name}’ 만들기 시작했어.', en: 'Started building ‘{name}’.' }, { name: entry.name }), tone: 'info' })
      return true
    } catch (error) {
      onError(error, t({ ko: '만들기를 시작하지 못했어.', en: 'Could not start the build.' }))
      void invalidateRefModEntries(queryClient, { entryIds: [entry.id] })
      return false
    } finally {
      setStarting((current) => { const next = new Set(current); next.delete(entry.id); return next })
    }
  }

  // ---------------------------------------------------------------- selection
  /** Entries chosen for a bulk action, kept across scopes; `selectMode` makes a row click choose instead of open. */
  const [selected, setSelected] = useState<ReadonlyMap<number, RefModEntrySummary>>(new Map())
  const [selectMode, setSelectMode] = useState(false)
  const toggleSelected = (entry: RefModEntrySummary) => setSelected((current) => {
    const next = new Map(current)
    if (next.has(entry.id)) next.delete(entry.id)
    else next.set(entry.id, entry)
    return next
  })
  const selectAllLoaded = () => setSelected((current) => new Map([...current, ...(visibleEntries ?? []).map((item) => [item.id, item] as const)]))
  const clearSelection = () => { setSelected(new Map()); setSelectMode(false) }

  // ---------------------------------------------------------------- actions
  /** The "새 RefMod" name prompt: its text and a refused name's reason. */
  const [creating, setCreating] = useState<{ name: string; error: string | null } | null>(null)
  const [createPending, setCreatePending] = useState(false)
  const create = async (name: string) => {
    setCreatePending(true)
    try {
      const entry = await createRefModEntry({ name: name.trim() })
      setCreating(null)
      void invalidateRefModEntries(queryClient, { entryIds: [entry.id], listsChanged: true })
      queryClient.setQueryData(refModEntryQueryKey(entry.id), entry)
      openEntry(entry.id)
      return entry
    } catch (error) {
      if (isRefModNameConflict(error)) setCreating({ name, error: getErrorMessage(error, t({ ko: '같은 이름의 RefMod가 있어.', en: 'A RefMod with this name exists.' })) })
      else onError(error, t({ ko: 'RefMod를 만들지 못했어.', en: 'Could not create the RefMod.' }))
      return null
    } finally {
      setCreatePending(false)
    }
  }

  /** A copy under the next free " (n)" name; its sources are copied too. */
  const duplicate = async (entry: Pick<RefModEntrySummary, 'id' | 'name'>) => {
    try {
      for (let copy = 2; copy < 100; copy += 1) {
        try {
          const created = await createRefModEntry({ name: copyName(entry.name, copy), duplicateOf: entry.id })
          void invalidateRefModEntries(queryClient, { entryIds: [created.id], listsChanged: true })
          showSnackbar({ message: t({ ko: '‘{name}’(으)로 복제했어.', en: 'Duplicated as ‘{name}’.' }, { name: created.name }), tone: 'info' })
          return created
        } catch (error) { if (!isRefModNameConflict(error)) throw error }
      }
      throw new Error(t({ ko: '복제할 이름을 찾지 못했어.', en: 'Could not find a free name for the copy.' }))
    } catch (error) { onError(error, t({ ko: '복제하지 못했어.', en: 'Could not duplicate.' })); return null }
  }

  const [bulkPending, setBulkPending] = useState(false)
  const bulk = async (input: RefModEntryBulkInput) => {
    if (editor.isBusy()) { showSnackbar({ message: t({ ko: '저장이나 업로드가 끝난 뒤 다시 해줘.', en: 'Wait for the save or upload to finish.' }), tone: 'info' }); return null }
    setBulkPending(true)
    try {
      const result = await bulkRefModEntries(input)
      if (input.action === 'delete') editor.closeIfDeleted(input.ids)
      void invalidateRefModEntries(queryClient, { entryIds: input.ids, listsChanged: input.action === 'delete' })
      if (input.action !== 'favorite' || input.ids.length > 1) clearSelection()
      return result
    } catch (error) {
      onError(error, t({ ko: '선택한 RefMod를 바꾸지 못했어.', en: 'Could not change the selected RefMods.' }))
      void invalidateRefModEntries(queryClient, { entryIds: input.ids })
      return null
    } finally {
      setBulkPending(false)
    }
  }
  const toggleFavorite = (entry: Pick<RefModEntrySummary, 'id' | 'favorite'>) => void bulk({ action: 'favorite', ids: [entry.id], favorite: !entry.favorite })
  const remove = async (entry: Pick<RefModEntrySummary, 'id' | 'name'>) => {
    if (editor.isBusy()) return
    const ok = await confirm({
      title: t({ ko: '‘{name}’ 삭제', en: 'Delete ‘{name}’' }, { name: entry.name }),
      description: t({ ko: '원본과 실행 기록도 같이 지워져. ComfyUI에 저장된 RefMod 파일은 남아.', en: 'Its sources and run records go too. The RefMod file saved in ComfyUI stays.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (ok) await bulk({ action: 'delete', ids: [entry.id] })
  }
  const removeSelected = async () => {
    const ok = await confirm({
      title: t({ ko: 'RefMod {count}개 삭제', en: 'Delete {count} RefMods' }, { count: selected.size }),
      description: t({ ko: '선택한 RefMod와 그 원본, 실행 기록을 지울까? ComfyUI에 저장된 RefMod 파일은 남아.', en: 'Delete the selected RefMods with their sources and run records? The RefMod files saved in ComfyUI stay.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (ok) await bulk({ action: 'delete', ids: [...selected.keys()] })
  }

  /** `{}` exports every entry (not only the listed ones). */
  const exportEntries = async (input: { ids?: number[] }, name: string) => {
    try {
      const count = await downloadRefModExport(input, name)
      showSnackbar({ message: t({ ko: 'RefMod {count}개를 내보냈어.', en: 'Exported {count} RefMods.' }, { count }), tone: 'info' })
    } catch (error) { onError(error, t({ ko: '내보내지 못했어.', en: 'Could not export.' })) }
  }
  /** The bundle picked for import, waiting for the 건너뛰기 / 덮어쓰기 choice. */
  const [importing, setImporting] = useState<{ file: File; conflict: RefModImportConflict } | null>(null)
  const [importPending, setImportPending] = useState(false)
  const importFile = async (file: File, conflict: RefModImportConflict) => {
    setImportPending(true)
    try {
      const result = await importRefModBundle(file, conflict)
      setImporting(null)
      void invalidateRefModEntries(queryClient, { entryIds: [], listsChanged: true })
      showSnackbar({
        message: [
          t({ ko: 'RefMod {count}개를 가져왔어.', en: 'Imported {count} RefMods.' }, { count: result.created }),
          result.overwritten ? t({ ko: '{count}개는 덮어썼어.', en: 'Overwrote {count}.' }, { count: result.overwritten }) : '',
          result.skipped ? t({ ko: '이름이 겹친 {count}개는 건너뛰었어.', en: 'Skipped {count} taken names.' }, { count: result.skipped }) : '',
          result.importedFiles ? t({ ko: '원본 {count}개를 넣었어.', en: 'Added {count} sources.' }, { count: result.importedFiles }) : '',
          result.droppedFiles ? t({ ko: '쓸 수 없는 원본 {count}개는 뺐어.', en: '{count} unusable sources were left out.' }, { count: result.droppedFiles }) : '',
        ].filter(Boolean).join(' '),
        tone: 'info',
      })
      return result
    } catch (error) {
      onError(error, t({ ko: '가져오지 못했어. CoNAI에서 내보낸 RefMod 묶음 ZIP인지 확인해줘.', en: 'Could not import. Check that it is a RefMod bundle ZIP exported from CoNAI.' }))
      return null
    } finally {
      setImportPending(false)
    }
  }

  /** Register unregistered rows: records copy their sources, server names bring metadata only. */
  const [adoptPending, setAdoptPending] = useState(false)
  const adopt = async (rows: readonly RefModUnregisteredRow[]) => {
    if (!rows.length) return null
    setAdoptPending(true)
    try {
      const recordIds = rows.flatMap((row) => row.kind === 'record' ? [row.recordId] : [])
      const names = rows.flatMap((row) => row.kind === 'server' ? [row.name] : [])
      const totals = { created: 0, linked: 0, skipped: 0 }
      for (let offset = 0; offset < Math.max(recordIds.length, names.length); offset += ADOPT_BATCH) {
        const result = await adoptRefMods({
          ...(recordIds.length > offset ? { recordIds: recordIds.slice(offset, offset + ADOPT_BATCH) } : {}),
          ...(names.length > offset ? { names: names.slice(offset, offset + ADOPT_BATCH) } : {}),
        })
        totals.created += result.created.length
        totals.linked += result.linked
        totals.skipped += result.skipped.length
      }
      showSnackbar({
        message: [
          t({ ko: 'RefMod {count}개를 등록했어.', en: 'Registered {count} RefMods.' }, { count: totals.created }),
          totals.linked ? t({ ko: '{count}개는 있던 RefMod에 이었어.', en: 'Linked {count} to existing RefMods.' }, { count: totals.linked }) : '',
          totals.skipped ? t({ ko: '{count}개는 등록하지 못했어.', en: 'Could not register {count}.' }, { count: totals.skipped }) : '',
        ].filter(Boolean).join(' '),
        tone: totals.skipped && !totals.created ? 'error' : 'info',
      })
      return totals
    } catch (error) {
      onError(error, t({ ko: '등록하지 못했어.', en: 'Could not register.' }))
      return null
    } finally {
      // A batch can fail after part of it was registered (records first, then server names).
      void invalidateRefModEntries(queryClient, { entryIds: [], listsChanged: true })
      setAdoptPending(false)
    }
  }
  /** Every unregistered row of every scope (not only the searched ones). */
  const adoptAll = () => adopt([...recordRows, ...serverRows])

  const [addingWorkflow, setAddingWorkflow] = useState(false)
  const addCreationWorkflow = async () => {
    if (addingWorkflow) return
    setAddingWorkflow(true)
    try {
      await createMiniMaxH3RefModExportWorkflow(defaultServerId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: refModWorkflowsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['image-generation-workflows'] }),
      ])
      showSnackbar({ message: t({ ko: 'RefMod 생성 워크플로를 추가했어.', en: 'Added the RefMod creation workflow.' }), tone: 'info' })
    } catch (error) {
      onError(error, t({ ko: 'RefMod 생성 워크플로를 추가하지 못했어.', en: 'Could not add the RefMod creation workflow.' }))
    } finally {
      setAddingWorkflow(false)
    }
  }

  /** The workflows an entry can link (the window's Select). */
  const workflows = useQuery({ queryKey: refModWorkflowsQueryKey, queryFn: ({ signal }) => listRefModWorkflows(signal), enabled: editor.open })

  /** The app's media viewer over one row's images and videos. */
  const [lightbox, setLightbox] = useState<{ items: ImageRecord[]; index: number } | null>(null)
  const openMedia = (thumbs: readonly RefModRowThumb[], thumb: RefModRowThumb) => {
    const entries = refModLightboxItems(thumbs)
    const index = entries.findIndex((entry) => entry.thumb.key === thumb.key)
    if (index >= 0) setLightbox({ items: entries.map((entry) => entry.record), index })
  }

  return {
    canEdit,
    canBuild,
    canAddWorkflow,
    canViewImages,
    // List state (URL)
    query, searchText, setSearchText, search,
    sort, serverFilter, concept, setListView,
    // List data
    list, loaded, visibleEntries, total, loadMore,
    // The default server
    presence, presenceOk, defaultServerId, isOnServer, refreshPresence: () => refreshAfterRun([]),
    // Unregistered rows
    unregistered, unregisteredRows, unregisteredCount: recordRows.length + serverRows.length, adopt, adoptAll, adoptPending,
    // Builds
    isPending, build, buildStarting: starting,
    // Selection
    selected, selectMode, setSelectMode, toggleSelected, selectAllLoaded, clearSelection,
    // The open entry
    openEntryId, editor, openEntry, closeEntry, workflows,
    // Actions
    creating, setCreating, create, createPending,
    duplicate, bulk, bulkPending, toggleFavorite, remove, removeSelected,
    exportEntries, importing, setImporting, importFile, importPending,
    addCreationWorkflow, addingWorkflow,
    lightbox, setLightbox, openMedia,
  }
}

export type RefModLibrary = ReturnType<typeof useRefModLibrary>

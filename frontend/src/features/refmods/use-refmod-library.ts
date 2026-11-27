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
  deleteUnregisteredRefModRecord,
  downloadRefModExport,
  getRefModBuildJob,
  getRefModEntry,
  getRefModPresence,
  importRefModBundle,
  invalidateRefModEntries,
  isRefModNameConflict,
  listRefModEntries,
  listRefModEntryNames,
  listRefModWorkflows,
  listUnregisteredRefMods,
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
  refModEntryThumbs,
  refModLightboxItems,
  refModRecordThumbs,
  type RefModRowThumb,
  type RefModServerFilter,
} from './refmod-shared'
import { useRefModEntryEditor, type RefModEditorTarget, type RefModRecordPreview, type RefModServerSeed } from './use-refmod-entry-editor'

const ACTIVE_QUEUE_STATUSES: Array<GenerationQueueJobRecord['status']> = ['queued', 'dispatching', 'running']
const ACTIVE_QUEUE_QUERY_KEY = ['image-generation-queue', 'header-widget', 'global-active'] as const
const ADOPT_BATCH = 500

const leavesEntry = (current: Location, next: Location) => current.pathname !== next.pathname || new URLSearchParams(current.search).get('entry') !== new URLSearchParams(next.search).get('entry')

function copyName(name: string, copy: number) {
  const suffix = ` (${copy})`
  return name.slice(0, REFMOD_ENTRY_LIMITS.name - suffix.length) + suffix
}

function matchesText(terms: string[], ...texts: string[]) {
  const haystack = texts.join('\n').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/** An unregistered row: a moved-out CoNAI entry (keeps config & files), a saved legacy run, or a server-only name. */
export type RefModUnregisteredRow =
  | { kind: 'entry'; key: string; entry: RefModEntrySummary; name: string; conceptType: string; description: string; keywords: string[]; thumbs: RefModRowThumb[]; kinds: MiniMaxH3RefModKind[] }
  | { kind: 'record'; key: string; recordId: number; name: string; conceptType: string; description: string; thumbs: RefModRowThumb[]; kinds: MiniMaxH3RefModKind[]; createdAt: string }
  | { kind: 'server'; key: string; name: string; conceptType: string; description: string; thumbs: RefModRowThumb[]; kinds: MiniMaxH3RefModKind[] }

type FollowedBuild = { jobId: number; since: number; name: string; afterRecordId: number }

export function useRefModLibrary() {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const authStatus = useAuthStatusQuery().data
  const canEdit = permissions.canEdit
  const { params, query, searchText, setSearchText, update } = useLibraryLocation(REFMOD_ENTRIES_PAGE_SIZE, ['entry'])
  const sortParam = params.get('sort') as RefModEntrySort | null
  const sort: RefModEntrySort = sortParam && REFMOD_ENTRY_SORTS.includes(sortParam) ? sortParam : 'updated'
  const serverParam = params.get('sv') as RefModServerFilter | null
  const serverFilter: RefModServerFilter = serverParam && REFMOD_SERVER_FILTERS.includes(serverParam) ? serverParam : 'all'
  const conceptParam = params.get('c') ?? ''
  const concept = (REFMOD_CONCEPTS as readonly string[]).includes(conceptParam) ? conceptParam : ''
  const entryParam = params.get('entry')
  const openEntryId = positiveLibraryId(entryParam)

  /** Opening a legacy record or server-only row from 미등록 (no DB id yet). */
  const [inspectedUnregistered, setInspectedUnregistered] = useState<{ kind: 'new'; seed: RefModServerSeed } | { kind: 'record'; record: RefModRecordPreview } | null>(null)
  const editorTarget: RefModEditorTarget = entryParam === 'new' && canEdit
    ? { kind: 'new' }
    : openEntryId !== null
      ? { kind: 'entry', entryId: openEntryId }
      : inspectedUnregistered

  const editor = useRefModEntryEditor({
    target: editorTarget,
    onCreated: (created) => {
      setInspectedUnregistered(null)
      update({ entry: String(created.id) }, true)
    },
    onClose: () => {
      setInspectedUnregistered(null)
      if (params.has('entry')) update({ entry: null })
    },
  })
  const allowLeave = useCallback((current: Location, next: Location) => current.pathname === next.pathname && editor.deletedRef.current && !new URLSearchParams(next.search).has('entry'), [editor.deletedRef])
  useEditorPageGuard(canEdit && editor.dirty, t({ ko: 'RefMod에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This RefMod has unsaved changes that will be lost.' }), leavesEntry, allowLeave)

  const setListView = (changes: { sort?: RefModEntrySort; server?: RefModServerFilter; concept?: string }) => update({
    ...(changes.sort !== undefined ? { sort: changes.sort === 'updated' ? null : changes.sort } : {}),
    ...(changes.server !== undefined ? { sv: changes.server === 'all' ? null : changes.server } : {}),
    ...(changes.concept !== undefined ? { c: changes.concept || null } : {}),
  })
  const search = (text: string, replace = false) => update({ q: text.trim() || null }, replace)
  const openEntry = (id: number) => {
    if (editor.isBusy()) return
    setInspectedUnregistered(null)
    update({ entry: String(id) })
  }
  const openNewEntry = () => {
    if (!canEdit || editor.isBusy()) return
    setInspectedUnregistered(null)
    update({ entry: 'new' })
  }
  const openUnregisteredRow = (row: RefModUnregisteredRow) => {
    if (editor.isBusy()) return
    if (row.kind === 'entry') {
      openEntry(row.entry.id)
      return
    }
    if (params.has('entry')) update({ entry: null })
    if (row.kind === 'record') {
      setInspectedUnregistered({
        kind: 'record',
        record: { recordId: row.recordId, name: row.name, conceptType: row.conceptType, description: row.description, thumbs: row.thumbs, kinds: row.kinds, createdAt: row.createdAt },
      })
    } else {
      setInspectedUnregistered({
        kind: 'new',
        seed: { name: row.name, conceptType: row.conceptType, description: row.description, members: row.thumbs.map((thumb) => ({ kind: thumb.kind, label: thumb.label })) },
      })
    }
  }
  const closeEntry = () => {
    if (editor.isBusy()) { showSnackbar({ message: t({ ko: '저장이나 업로드가 끝난 뒤 닫을 수 있어.', en: 'Close it after the save or upload finishes.' }), tone: 'info' }); return }
    setInspectedUnregistered(null)
    if (params.has('entry')) update({ entry: null })
  }
  const searchOpenEditor = useEffectEvent((text: string) => search(text, true))
  useEffect(() => {
    if (!editor.open || searchText.trim() === query) return
    const timer = window.setTimeout(() => searchOpenEditor(searchText), 300)
    return () => window.clearTimeout(timer)
  }, [editor.open, searchText, query])

  // ---------------------------------------------------------------- builds being followed
  const [builds, setBuilds] = useState<ReadonlyMap<number, FollowedBuild>>(new Map())
  const [starting, setStarting] = useState<ReadonlySet<number>>(new Set())

  const scope: RefModEntryScope = { query, concept, favorite: false, registered: true, sort, limit: REFMOD_ENTRIES_PAGE_SIZE }
  const [listPending, setListPending] = useState(false)
  const list = useInfiniteQuery({
    queryKey: refModEntryPagesQueryKey(scope),
    queryFn: ({ pageParam, signal }) => listRefModEntries({ ...scope, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((sum, page) => sum + page.items.length, 0) : undefined),
    placeholderData: keepPreviousData,
    refetchInterval: listPending ? 15_000 : false,
  })
  const loaded = list.data?.pages.flatMap((batch) => batch.items)
  const total = list.data?.pages[0]?.total
  const loadMore = list.hasNextPage ? async () => (await loadNextBatch(list)).flatMap((batch) => batch.items) : null

  /** Unregistered CoNAI entries (registered = 0): kept with full config and file-store copies. */
  const unregisteredEntriesScope: RefModEntryScope = { query: '', concept: '', favorite: false, registered: false, sort, limit: 200 }
  const unregisteredEntriesQuery = useQuery({
    queryKey: refModEntryPagesQueryKey(unregisteredEntriesScope),
    queryFn: ({ signal }) => listRefModEntries({ ...unregisteredEntriesScope, offset: 0 }, signal),
    placeholderData: keepPreviousData,
  })
  const unregisteredEntryItems = unregisteredEntriesQuery.data?.items ?? []

  const anyPending = Boolean(loaded?.some((entry) => entry.pending)) || Boolean(unregisteredEntryItems.some((entry) => entry.pending)) || Boolean(editor.latest?.pending)
  if (listPending !== anyPending) setListPending(anyPending)

  const presence = useQuery({ queryKey: refModPresenceQueryKey, queryFn: ({ signal }) => getRefModPresence(signal), staleTime: 60_000, retry: false })
  const presenceOk = presence.data?.status === 'ok' ? presence.data : null
  const onServerName = makeRefModNameLookup(presenceOk?.entries.map((entry) => entry.name) ?? [])
  const isOnServer = (name: string) => onServerName(name) !== null
  const defaultServerId = presenceOk?.serverId

  const unregistered = useQuery({ queryKey: refModUnregisteredQueryKey, queryFn: ({ signal }) => listUnregisteredRefMods(signal) })
  const entryNames = useQuery({ queryKey: refModEntryNamesQueryKey, queryFn: ({ signal }) => listRefModEntryNames(signal), enabled: Boolean(presenceOk) })
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  const entryRows: RefModUnregisteredRow[] = unregisteredEntryItems.map((entry) => ({
    kind: 'entry',
    key: `entry:${entry.id}`,
    entry,
    name: entry.name,
    conceptType: entry.conceptType,
    description: entry.description,
    keywords: entry.keywords,
    thumbs: refModEntryThumbs(t, entry.id, entry.members, canViewImages),
    kinds: entry.members.map((member) => member.kind),
  }))
  const recordRows: RefModUnregisteredRow[] = (unregistered.data ?? []).map((record) => ({
    kind: 'record', key: `record:${record.recordId}`, recordId: record.recordId, name: record.name, conceptType: record.conceptType,
    description: record.description, thumbs: refModRecordThumbs(t, record.recordId, record.members, canViewImages),
    kinds: record.members.map((member) => member.kind), createdAt: record.createdAt,
  }))
  const entryName = makeRefModNameLookup(entryNames.data ?? [])
  const recordName = makeRefModNameLookup(recordRows.map((row) => row.name))
  const serverRows: RefModUnregisteredRow[] = presenceOk && entryNames.data ? presenceOk.entries
    .filter((entry) => entryName(entry.name) === null && recordName(entry.name) === null)
    .map((entry) => ({
      kind: 'server', key: `server:${entry.name}`, name: entry.name, conceptType: entry.concept, description: entry.description,
      kinds: entry.members.map((member) => member.kind),
      thumbs: entry.members.map((member, index) => ({ key: String(index), kind: member.kind, label: member.description || `${member.kind} ${index + 1}`, thumbnailUrl: null, fileUrl: null })),
    })) : []

  const allUnregisteredRows: RefModUnregisteredRow[] = [...entryRows, ...recordRows, ...serverRows]
  /** Unregistered rows only render inside the 미등록 tab (filtered by concept and search terms). */
  const unregisteredRows = serverFilter === 'unregistered'
    ? allUnregisteredRows.filter((row) => (!concept || row.conceptType === concept)
      && matchesText(terms, row.name, row.description, ...(row.kind === 'entry' ? row.keywords : []), ...row.thumbs.map((thumb) => thumb.label)))
    : []
  const visibleEntries = serverFilter === 'unregistered' ? []
    : (serverFilter === 'on' || serverFilter === 'off') && presenceOk ? loaded?.filter((entry) => isOnServer(entry.name) === (serverFilter === 'on'))
      : loaded
  const isPending = (entry: Pick<RefModEntrySummary, 'id' | 'pending'>) => entry.pending || builds.has(entry.id) || starting.has(entry.id)

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
    const previous = previousActiveIds.current
    previousActiveIds.current = active
    if (!ended.length && anyPending && previous && [...previous].some((id) => !active.has(id))) void refreshAfterRun([])
  })
  useEffect(() => { onQueueChange() }, [activeQueue.dataUpdatedAt])

  const onError = (error: unknown, fallback: string) => showSnackbar({ message: getErrorMessage(error, fallback), tone: 'error' })

  const build = async (entry: Pick<RefModEntrySummary, 'id' | 'name' | 'lastRecord'>): Promise<boolean> => {
    if (starting.has(entry.id) || builds.has(entry.id)) return false
    setStarting((current) => new Set(current).add(entry.id))
    try {
      if (editor.base?.id === entry.id && editor.dirty) {
        try { await editor.save() } catch { return false }
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
  const [selected, setSelected] = useState<ReadonlyMap<number, RefModEntrySummary>>(new Map())
  const [selectMode, setSelectMode] = useState(false)
  const toggleSelected = (entry: RefModEntrySummary) => setSelected((current) => {
    const next = new Map(current)
    if (next.has(entry.id)) next.delete(entry.id)
    else next.set(entry.id, entry)
    return next
  })
  const selectableEntries = serverFilter === 'unregistered'
    ? unregisteredRows.flatMap((row) => row.kind === 'entry' ? [row.entry] : [])
    : (visibleEntries ?? [])
  const selectAllLoaded = () => setSelected((current) => new Map([...current, ...selectableEntries.map((item) => [item.id, item] as const)]))
  const clearSelection = () => { setSelected(new Map()); setSelectMode(false) }

  // Clear selection when switching between registered and unregistered views so actions always match the tab.
  const prevTabKind = useRef(serverFilter === 'unregistered')
  useEffect(() => {
    const inUnregistered = serverFilter === 'unregistered'
    if (prevTabKind.current !== inUnregistered) {
      prevTabKind.current = inUnregistered
      clearSelection()
    }
  }, [serverFilter])

  // ---------------------------------------------------------------- actions
  const [createPending, setCreatePending] = useState(false)
  const create = async (name: string) => {
    setCreatePending(true)
    try {
      const entry = await createRefModEntry({ name: name.trim() })
      void invalidateRefModEntries(queryClient, { entryIds: [entry.id], listsChanged: true })
      queryClient.setQueryData(refModEntryQueryKey(entry.id), entry)
      openEntry(entry.id)
      return entry
    } catch (error) {
      onError(error, t({ ko: 'RefMod를 만들지 못했어.', en: 'Could not create the RefMod.' }))
      return null
    } finally {
      setCreatePending(false)
    }
  }

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
      if (input.action === 'delete' || input.action === 'unregister') editor.closeIfDeleted(input.ids)
      void invalidateRefModEntries(queryClient, { entryIds: input.ids, listsChanged: input.action !== 'favorite' })
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

  /** Registered entry -> move to 미등록 (keeps config & files). Unregistered entry -> permanent delete (with files). */
  const remove = async (entry: Pick<RefModEntrySummary, 'id' | 'name' | 'registered'>) => {
    if (editor.isBusy()) return
    const permanent = !entry.registered
    const ok = permanent
      ? await confirm({
          title: t({ ko: '‘{name}’ 영구 삭제', en: 'Permanently delete ‘{name}’' }, { name: entry.name }),
          description: t({ ko: '항목과 파일함의 원본 파일·실행 기록을 모두 지워. 되돌릴 수 없어.', en: 'Deletes this RefMod, its file-store copies and run records permanently. This cannot be undone.' }),
          confirmLabel: t({ ko: '영구 삭제', en: 'Delete permanently' }),
          tone: 'destructive',
        })
      : await confirm({
          title: t({ ko: '‘{name}’ 미등록으로 이동', en: 'Move ‘{name}’ to Unregistered' }, { name: entry.name }),
          description: t({ ko: 'RefMod 목록에서 내리고 미등록으로 옮겨. 구성 정보와 파일함의 원본 파일은 유지돼.', en: 'Removes from RefMod list and moves to Unregistered. Configuration and source files in the file store stay.' }),
          confirmLabel: t({ ko: '미등록으로 이동', en: 'Move to Unregistered' }),
        })
    if (!ok) return
    const result = await bulk({ action: permanent ? 'delete' : 'unregister', ids: [entry.id] })
    if (result && !permanent) showSnackbar({ message: t({ ko: '‘{name}’을(를) 미등록으로 옮겼어.', en: 'Moved ‘{name}’ to Unregistered.' }, { name: entry.name }), tone: 'info' })
  }

  const removeUnregisteredRecord = async (record: Pick<RefModRecordPreview, 'recordId' | 'name'>) => {
    if (editor.isBusy()) return false
    const ok = await confirm({
      title: t({ ko: '‘{name}’ 영구 삭제', en: 'Permanently delete ‘{name}’' }, { name: record.name }),
      description: t({ ko: '실행 기록과 보관된 원본 파일을 모두 지워. 되돌릴 수 없어.', en: 'Deletes this run record and its retained source files permanently. This cannot be undone.' }),
      confirmLabel: t({ ko: '영구 삭제', en: 'Delete permanently' }),
      tone: 'destructive',
    })
    if (!ok) return false
    try {
      await deleteUnregisteredRefModRecord(record.recordId)
      void invalidateRefModEntries(queryClient, { entryIds: [], listsChanged: true })
      if (inspectedUnregistered?.kind === 'record' && inspectedUnregistered.record.recordId === record.recordId) setInspectedUnregistered(null)
      return true
    } catch (error) {
      onError(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' }))
      return false
    }
  }

  const removeSelected = async () => {
    const permanent = serverFilter === 'unregistered'
    const ok = permanent
      ? await confirm({
          title: t({ ko: 'RefMod {count}개 영구 삭제', en: 'Permanently delete {count} RefMods' }, { count: selected.size }),
          description: t({ ko: '선택한 항목과 파일함의 원본 파일·실행 기록을 모두 지워. 되돌릴 수 없어.', en: 'Deletes the selected items, their file-store copies and run records permanently. This cannot be undone.' }),
          confirmLabel: t({ ko: '영구 삭제', en: 'Delete permanently' }),
          tone: 'destructive',
        })
      : await confirm({
          title: t({ ko: 'RefMod {count}개 미등록으로 이동', en: 'Move {count} RefMods to Unregistered' }, { count: selected.size }),
          description: t({ ko: 'RefMod 목록에서 내리고 미등록으로 옮겨. 구성 정보와 파일함의 원본 파일은 유지돼.', en: 'Removes from RefMod list and moves to Unregistered. Configuration and source files in the file store stay.' }),
          confirmLabel: t({ ko: '미등록으로 이동', en: 'Move to Unregistered' }),
        })
    if (ok) await bulk({ action: permanent ? 'delete' : 'unregister', ids: [...selected.keys()] })
  }

  const exportEntries = async (input: { ids?: number[] }, name: string) => {
    try {
      const count = await downloadRefModExport(input, name)
      showSnackbar({ message: t({ ko: 'RefMod {count}개를 내보냈어.', en: 'Exported {count} RefMods.' }, { count }), tone: 'info' })
    } catch (error) { onError(error, t({ ko: '내보내지 못했어.', en: 'Could not export.' })) }
  }
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

  const [adoptPending, setAdoptPending] = useState(false)
  const adopt = async (rows: readonly RefModUnregisteredRow[]) => {
    if (!rows.length) return null
    setAdoptPending(true)
    try {
      const entryIds = rows.flatMap((row) => row.kind === 'entry' ? [row.entry.id] : [])
      const recordIds = rows.flatMap((row) => row.kind === 'record' ? [row.recordId] : [])
      const names = rows.flatMap((row) => row.kind === 'server' ? [row.name] : [])
      const totals = { created: 0, linked: 0, skipped: 0, firstId: null as number | null }
      const maxLen = Math.max(entryIds.length, recordIds.length, names.length)
      for (let offset = 0; offset < maxLen; offset += ADOPT_BATCH) {
        const result = await adoptRefMods({
          ...(entryIds.length > offset ? { entryIds: entryIds.slice(offset, offset + ADOPT_BATCH) } : {}),
          ...(recordIds.length > offset ? { recordIds: recordIds.slice(offset, offset + ADOPT_BATCH) } : {}),
          ...(names.length > offset ? { names: names.slice(offset, offset + ADOPT_BATCH) } : {}),
        })
        if (totals.firstId === null && result.created[0]) totals.firstId = result.created[0].id
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
      void invalidateRefModEntries(queryClient, { entryIds: [], listsChanged: true })
      setAdoptPending(false)
    }
  }
  const adoptAll = () => adopt(allUnregisteredRows)

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

  const workflows = useQuery({ queryKey: refModWorkflowsQueryKey, queryFn: ({ signal }) => listRefModWorkflows(signal), enabled: editor.open })

  const [lightbox, setLightbox] = useState<{ items: ImageRecord[]; index: number } | null>(null)
  const openMedia = (thumbs: readonly RefModRowThumb[], thumb: RefModRowThumb) => {
    const entries = refModLightboxItems(thumbs)
    const index = entries.findIndex((entry) => entry.thumb.key === thumb.key)
    if (index >= 0) setLightbox({ items: entries.map((entry) => entry.record), index })
  }

  return {
    canEdit,
    canDelete: permissions.canDelete,
    canViewImages,
    query, searchText, setSearchText, search,
    sort, serverFilter, concept, setListView,
    list, loaded, visibleEntries, total, loadMore,
    presence, presenceOk, defaultServerId, isOnServer, refreshPresence: () => refreshAfterRun([]),
    unregistered, unregisteredEntriesQuery, unregisteredRows, allUnregisteredRows,
    unregisteredCount: allUnregisteredRows.length, adopt, adoptAll, adoptPending,
    isPending, build, buildStarting: starting,
    selected, selectMode, setSelectMode, toggleSelected, selectableEntries, selectAllLoaded, clearSelection,
    openEntryId, editor, openEntry, openNewEntry, openUnregisteredRow, closeEntry, workflows,
    create, createPending,
    duplicate, bulk, bulkPending, toggleFavorite, remove, removeUnregisteredRecord, removeSelected,
    exportEntries, importing, setImporting, importFile, importPending,
    addCreationWorkflow, addingWorkflow,
    lightbox, setLightbox, openMedia,
  }
}

export type RefModLibrary = ReturnType<typeof useRefModLibrary>

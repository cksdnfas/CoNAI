import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Download, MessageSquare, Pencil, Sparkles, Trash2, Upload } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useStreamFallbackInterval } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import {
  AUDIO_QUERY_KEY,
  audioCandidateExportUrl,
  audioExportDownloadUrl,
  cancelAudioOrder,
  downloadAttachment,
  getAudioGroup,
  listAudioCandidates,
  listAudioGroups,
  listAudioOrders,
  listAudioProjects,
  retryAudioOrderJob,
  saveBlob,
  setAudioReview,
  startAudioExport,
  uploadAudioFiles,
  type AudioCandidate,
  type AudioCandidatePage,
  type AudioExportResult,
  type AudioReview,
} from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'
import { runtimeJobQueryKey, useRuntimeJob } from '@/lib/use-runtime-job'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { AudioCandidateRow, AudioOrderRow, activeJobCount, arrangeCandidates } from './audio-candidate-list'
import { AudioCleanupDialog, AudioCommentsDialog, AudioGroupDialog, AudioOrderDialog, AudioProjectDialog, TextTabs } from './audio-dialogs'
import { AudioEditorPanel } from './audio-editor-panel'
import { audioPlayer } from './audio-player'
import { AUDIO_SHORTCUT_ACTIONS, normalizeShortcutKey, shouldIgnoreReviewKey, useAudioShortcuts } from './audio-shortcuts'
import { AudioSettingsDialog } from './audio-settings-dialog'
import { AudioSidebar, AudioSidebarFooter, type AudioSidebarFilter } from './audio-sidebar'

const PROJECT_STORAGE_KEY = 'conai:audio:project'
const PAGE_SIZE = 200
/** Failed orders stay listed (with retry) for a day. */
const FAILED_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000

type Dialog = 'project-new' | 'project-edit' | 'group-new' | 'group-edit' | 'comments' | 'cleanup' | 'order' | 'settings' | null
type ReviewTab = 'all' | AudioReview

function readStoredProject() {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeProject(id: string) {
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, id)
  } catch {
    // Storage blocked: the choice still holds for this visit.
  }
}

function useAudioPermissions() {
  const auth = useAuthStatusQuery().data
  const has = (key: string) => !!auth?.authenticated && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, key))
  return { canEdit: has('audio.edit'), canGenerate: has('audio.edit') && has('generation.execute'), canManageWorkflows: has('audio.edit') }
}

/** /audio — the sound-effect workspace: projects, groups, takes, review, editing, generation orders and export. */
export function AudioPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const isDesktop = useDesktopPageLayout()
  const permissions = useAudioPermissions()
  const shortcuts = useAudioShortcuts()
  const [searchParams, setSearchParams] = useSearchParams()
  const groupId = searchParams.get('group')
  const [projectId, setProjectIdState] = useState<string | null>(readStoredProject)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState<AudioSidebarFilter>(null)
  const [reviewTab, setReviewTab] = useState<ReviewTab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dismissedOrders, setDismissedOrders] = useState<Set<string>>(() => new Set())
  const [exportJobId, setExportJobId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const lastSelectedRef = useRef<AudioCandidate | null>(null)
  const fail = useCallback((error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' }), [showSnackbar, t])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id)
    storeProject(id)
  }, [])
  const setGroupId = useCallback((id: string | null, replace = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('group', id)
      else next.delete('group')
      return next
    }, { replace })
  }, [setSearchParams])

  /* ---------------------------------------------------------------------------------------------- data */

  const projectsQuery = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'projects'], queryFn: listAudioProjects })
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const groupQuery = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'group', groupId], queryFn: () => getAudioGroup(groupId!), enabled: Boolean(groupId), retry: false })
  const group = groupQuery.data && groupQuery.data.id === groupId ? groupQuery.data : null

  // A group link (chat card, ?group=) wins over the remembered project.
  useEffect(() => {
    if (group && group.project_id !== projectId) setProjectId(group.project_id)
  }, [group, projectId, setProjectId])
  useEffect(() => {
    if (!projectsQuery.isSuccess) return
    if (projects.length === 0) return
    if (!projectId || !projects.some((project) => project.id === projectId)) {
      if (!groupId || groupQuery.isError) setProjectId(projects[0].id)
    }
  }, [projectsQuery.isSuccess, projects, projectId, groupId, groupQuery.isError, setProjectId])
  const project = projects.find((entry) => entry.id === projectId) ?? null

  const groupsQuery = useQuery({
    queryKey: [AUDIO_QUERY_KEY, 'groups', projectId, debouncedSearch, filter],
    queryFn: () => listAudioGroups(projectId!, { search: debouncedSearch, filter }),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })
  const groups = useMemo(() => {
    const list = groupsQuery.data ?? []
    return [...list.filter((entry) => entry.is_inbox), ...list.filter((entry) => !entry.is_inbox)]
  }, [groupsQuery.data])

  // Without a group in the URL (or after it was deleted), open the first group of the project.
  useEffect(() => {
    if (!projectId || !groupsQuery.isSuccess || debouncedSearch || filter) return
    const missing = !groupId || (groupQuery.isError) || (group !== null && group.project_id !== projectId)
    if (!missing) return
    const first = groups.find((entry) => !entry.is_inbox) ?? groups[0]
    setGroupId(first?.id ?? null, true)
  }, [projectId, groupsQuery.isSuccess, groups, groupId, group, groupQuery.isError, debouncedSearch, filter, setGroupId])

  const reviewFilter = reviewTab === 'all' ? null : reviewTab
  const candidatesKey = [AUDIO_QUERY_KEY, 'candidates', groupId, reviewFilter] as const
  const candidatesQuery = useInfiniteQuery({
    queryKey: candidatesKey,
    queryFn: ({ pageParam }) => listAudioCandidates(groupId!, { review: reviewFilter, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last: AudioCandidatePage) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    enabled: Boolean(groupId),
  })
  const rows = useMemo(() => arrangeCandidates((candidatesQuery.data?.pages ?? []).flatMap((page) => page.items)), [candidatesQuery.data])
  const selected = rows.find((row) => row.candidate.id === selectedId)?.candidate ?? (lastSelectedRef.current?.id === selectedId ? lastSelectedRef.current : null)
  useEffect(() => { if (selected) lastSelectedRef.current = selected }, [selected])
  useEffect(() => { setSelectedId(null) }, [groupId])

  const fallbackInterval = useStreamFallbackInterval(5_000)
  const ordersQuery = useQuery({
    queryKey: [AUDIO_QUERY_KEY, 'orders', groupId],
    queryFn: () => listAudioOrders(groupId!),
    enabled: Boolean(groupId),
    refetchInterval: (query) => (query.state.data?.items.some((order) => activeJobCount(order) > 0) ? fallbackInterval : false),
  })
  const visibleOrders = useMemo(() => {
    const now = Date.now()
    return (ordersQuery.data?.items ?? []).filter((order) => {
      if (dismissedOrders.has(order.id)) return false
      if (activeJobCount(order) > 0) return true
      return order.jobs.some((job) => job.status === 'failed') && now - Date.parse(order.created_at) < FAILED_ORDER_WINDOW_MS
    })
  }, [ordersQuery.data, dismissedOrders])
  // A finished job turns into takes: refresh the list and the counts when the number of running jobs drops.
  const runningJobs = (ordersQuery.data?.items ?? []).reduce((sum, order) => sum + activeJobCount(order), 0)
  const previousRunning = useRef(runningJobs)
  useEffect(() => {
    if (runningJobs < previousRunning.current) {
      void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'candidates', groupId] })
      void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'groups'] })
      void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'group', groupId] })
    }
    previousRunning.current = runningJobs
  }, [runningJobs, groupId, queryClient])

  const refreshCounts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'groups'] })
    void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'group'] })
    void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'projects'] })
  }, [queryClient])
  const refreshAll = useCallback(() => {
    refreshCounts()
    void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'candidates'] })
    void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'orders'] })
  }, [queryClient, refreshCounts])

  /* ---------------------------------------------------------------------------------------------- review */

  const review = useCallback(async (candidate: AudioCandidate, next: AudioReview) => {
    if (!permissions.canEdit || candidate.review === next) return
    queryClient.setQueriesData<InfiniteData<AudioCandidatePage>>({ queryKey: [AUDIO_QUERY_KEY, 'candidates', candidate.group_id] }, (data) => data && {
      ...data,
      pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => (item.id === candidate.id ? { ...item, review: next } : item)) })),
    })
    try {
      await setAudioReview(candidate.id, { review: next })
    } catch (error) {
      fail(error)
      void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'candidates', candidate.group_id] })
    }
    refreshCounts()
    if (reviewFilter) void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'candidates', candidate.group_id] })
  }, [permissions.canEdit, queryClient, fail, refreshCounts, reviewFilter])

  const play = useCallback((candidate: AudioCandidate) => audioPlayer.toggle(candidate.id), [])
  const move = useCallback((step: number, autoplay = false) => {
    if (rows.length === 0) return
    const index = rows.findIndex((row) => row.candidate.id === selectedId)
    const nextIndex = index === -1 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + step))
    const next = rows[nextIndex].candidate
    if (next.id === selectedId) return
    setSelectedId(next.id)
    if (autoplay) audioPlayer.play(next.id)
  }, [rows, selectedId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreReviewKey(event)) return
      const key = normalizeShortcutKey(event.key)
      const action = AUDIO_SHORTCUT_ACTIONS.find((entry) => shortcuts[entry] === key)
      if (!action) return
      event.preventDefault()
      if (event.repeat) return
      if (action === 'next') return move(1)
      if (action === 'previous') return move(-1)
      if (!selected) return
      if (action === 'play') return play(selected)
      if (action === 'select') return void review(selected, 'selected')
      // Rejecting or parking a take moves on to the next one and plays it.
      void review(selected, action === 'reject' ? 'rejected' : 'pending')
      move(1, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcuts, move, selected, play, review])

  useEffect(() => () => audioPlayer.stop(), [])

  /* ---------------------------------------------------------------------------------------------- upload / export */

  const upload = async (files: File[]) => {
    if (!group || files.length === 0) return
    try {
      const result = await uploadAudioFiles({ groupId: group.id }, files)
      showSnackbar({ message: t({ ko: '{count}개 올렸어.', en: 'Uploaded {count}.' }, { count: result.created.length }) })
      if (result.failed.length > 0) showSnackbar({ message: result.failed.map((entry) => `${entry.name}: ${entry.error}`).join('\n'), tone: 'error' })
    } catch (error) {
      fail(error)
    }
    refreshAll()
  }
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragging(false)
    if (permissions.canEdit) void upload(Array.from(event.dataTransfer.files))
  }

  const exportJob = useRuntimeJob<AudioExportResult>(exportJobId, {
    onCompleted: (job) => {
      setExportJobId(null)
      if (job.result) void downloadAttachment(audioExportDownloadUrl(job.result.export_id), job.result.file_name).catch(fail)
    },
    onFailed: (job) => {
      setExportJobId(null)
      showSnackbar({ message: job.failureMessage ?? t({ ko: '내보내기에 실패했어.', en: 'Export failed.' }), tone: 'error' })
    },
    onCancelled: () => setExportJobId(null),
  })
  const runExport = async (scope: { groupId: string } | { projectId: string }) => {
    setExporting(true)
    try {
      const result = await startAudioExport(scope)
      if (result.kind === 'file') saveBlob(result.blob, result.fileName)
      else {
        queryClient.setQueryData(runtimeJobQueryKey(result.job.jobId), result.job)
        setExportJobId(result.job.jobId)
      }
    } catch (error) {
      fail(error)
    } finally {
      setExporting(false)
    }
  }

  /* ---------------------------------------------------------------------------------------------- chat */

  useChatPageRegistration({
    kind: 'audio',
    title: t({ ko: '오디오', en: 'Audio' }),
    resourceId: group?.id ?? null,
    fields: [],
    data: {
      project: project ? { id: project.id, name: project.name } : null,
      group: group ? { id: group.id, name: group.name, label: group.label, description: group.description, isInbox: group.is_inbox } : null,
      reviewFilter: reviewTab,
      selectedCandidateIds: selected ? [selected.id] : [],
    },
    apply: () => undefined,
  })

  /* ---------------------------------------------------------------------------------------------- render */

  const tabs: Array<[ReviewTab, string, number?]> = group ? [
    ['all', t({ ko: '전체', en: 'All' }), group.candidate_count],
    ['pending', t({ ko: '미검수', en: 'Unreviewed' }), group.pending_review_count],
    ['selected', t({ ko: '채택', en: 'Adopted' }), group.selected_count],
    ['rejected', t({ ko: '보류', en: 'Rejected' }), Math.max(0, group.candidate_count - group.selected_count - group.pending_review_count)],
  ] : []
  const groupTitle = group ? (group.is_inbox ? t({ ko: '받은 파일', en: 'Inbox' }) : group.name) : t({ ko: '오디오', en: 'Audio' })
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = candidatesQuery
  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '400px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const editor = selected ? (
    <AudioEditorPanel
      key={selected.id}
      candidate={selected}
      canEdit={permissions.canEdit}
      showHeader={isDesktop}
      onClose={() => setSelectedId(null)}
      onSaved={(created) => {
        refreshAll()
        setSelectedId(created.id)
      }}
    />
  ) : null

  return (
    <PageWithSidebar
      storageKey="audio"
      sidebarLabel={t({ ko: '프로젝트와 그룹', en: 'Projects and groups' })}
      sidebarWidth={256}
      sidebar={(
        <AudioSidebar
          projects={projects}
          projectId={projectId}
          onProjectChange={(id) => { setProjectId(id); setGroupId(null) }}
          groups={groups}
          groupId={groupId}
          onGroupChange={(id) => setGroupId(id)}
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          canEdit={permissions.canEdit}
          onNewGroup={() => setDialog('group-new')}
          onOpenSettings={() => setDialog('settings')}
        />
      )}
      sidebarFooter={(
        <AudioSidebarFooter
          project={project}
          canEdit={permissions.canEdit}
          exporting={exporting || Boolean(exportJobId)}
          onNewProject={() => setDialog('project-new')}
          onEditProject={() => setDialog('project-edit')}
          onExportProject={() => project && void runExport({ projectId: project.id })}
        />
      )}
      toolbar={(
        <PageToolbar
          title={groupTitle}
          start={group?.label && !group.is_inbox ? <span className="truncate font-mono text-xs text-muted-foreground">{group.label}</span> : null}
          actions={group ? (
            <>
              {permissions.canEdit ? <IconButton variant="ghost" label={t({ ko: '그룹 수정', en: 'Edit group' })} onClick={() => setDialog('group-edit')}><Pencil /></IconButton> : null}
              <span className="relative inline-flex">
                <IconButton variant="ghost" label={t({ ko: '코멘트', en: 'Comments' })} onClick={() => setDialog('comments')}><MessageSquare /></IconButton>
                {group.pending_comment_count > 0 ? <span className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-2xs leading-4 font-semibold text-primary-foreground">{group.pending_comment_count}</span> : null}
              </span>
              {permissions.canEdit ? <IconButton variant="ghost" label={t({ ko: '업로드', en: 'Upload' })} onClick={() => uploadInputRef.current?.click()}><Upload /></IconButton> : null}
              {permissions.canEdit ? <IconButton variant="ghost" label={t({ ko: '후보 정리', en: 'Clean up takes' })} onClick={() => setDialog('cleanup')}><Trash2 /></IconButton> : null}
              <IconButton variant="ghost" label={t({ ko: '채택본 내보내기', en: 'Export selections' })} disabled={exporting || Boolean(exportJobId)} onClick={() => void runExport({ groupId: group.id })}><Download /></IconButton>
              {permissions.canGenerate && !group.is_inbox ? <Button size="sm" className="ml-1" onClick={() => setDialog('order')}><Sparkles />{t({ ko: '생성 주문', en: 'Order' })}</Button> : null}
            </>
          ) : null}
        />
      )}
    >
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        accept="audio/*,.wav,.ogg,.mp3,.flac,.m4a,.aac,.opus"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void upload(files)
        }}
      />
      {exportJob.job ? <RuntimeJobProgress job={exportJob.job} cancel={exportJob.cancel} isCancelling={exportJob.isCancelling} className="mb-4" /> : null}
      {group ? (
        <div className={cn('flex items-start gap-6', isDesktop && selected && 'pr-0')}>
          <div
            className={cn('relative min-w-0 flex-1', dragging && 'after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:border-2 after:border-dashed after:border-primary')}
            onDragOver={(event) => {
              if (!permissions.canEdit || !event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
            onDrop={onDrop}
          >
            <TextTabs value={reviewTab} items={tabs} onChange={(value) => { setReviewTab(value); setSelectedId(null) }} />
            <div role="listbox" aria-label={t({ ko: '후보', en: 'Takes' })} className="min-h-40">
              {visibleOrders.map((order) => (
                <AudioOrderRow
                  key={order.id}
                  order={order}
                  canEdit={permissions.canGenerate}
                  onCancel={() => void cancelAudioOrder(order.id).then(refreshAll, fail)}
                  onRetry={() => void Promise.all(order.jobs.filter((job) => job.status === 'failed').map((job) => retryAudioOrderJob(order.id, job.idx))).then(refreshAll, fail)}
                  onDismiss={() => setDismissedOrders((current) => new Set(current).add(order.id))}
                />
              ))}
              {rows.map((row) => (
                <AudioCandidateRow
                  key={row.candidate.id}
                  row={row}
                  selected={row.candidate.id === selectedId}
                  canEdit={permissions.canEdit}
                  onSelect={() => setSelectedId(row.candidate.id)}
                  onPlay={() => { setSelectedId(row.candidate.id); play(row.candidate) }}
                  onReview={(next) => void review(row.candidate, next)}
                  onDownload={() => void downloadAttachment(audioCandidateExportUrl(row.candidate.id), row.candidate.name).catch(fail)}
                />
              ))}
              <div ref={loadMoreRef} className="h-px" />
            </div>
          </div>
          {isDesktop && editor ? (
            <aside className="sticky top-[calc(var(--theme-shell-header-height)+4.5rem)] max-h-[calc(100dvh-var(--theme-shell-header-height)-6rem)] w-[22.5rem] shrink-0 overflow-y-auto overscroll-contain border-l border-line pl-6">
              {editor}
            </aside>
          ) : null}
        </div>
      ) : null}

      {!isDesktop && selected ? (
        <BottomDrawerSheet open title={selected.name} onClose={() => setSelectedId(null)} ariaLabel={t({ ko: '편집', en: 'Edit' })}>
          {editor}
        </BottomDrawerSheet>
      ) : null}

      <AudioProjectDialog
        open={dialog === 'project-new' || dialog === 'project-edit'}
        project={dialog === 'project-edit' ? project : null}
        onClose={() => setDialog(null)}
        onSaved={(saved) => {
          setDialog(null)
          refreshCounts()
          if (saved.id !== projectId) {
            setProjectId(saved.id)
            setGroupId(saved.inbox_group_id)
          }
        }}
        onDeleted={() => {
          setDialog(null)
          setProjectIdState(null)
          setGroupId(null)
          refreshAll()
        }}
      />
      {projectId ? (
        <AudioGroupDialog
          open={dialog === 'group-new' || dialog === 'group-edit'}
          projectId={projectId}
          group={dialog === 'group-edit' ? group : null}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null)
            refreshCounts()
            setGroupId(saved.id)
          }}
          onDeleted={() => {
            setDialog(null)
            setGroupId(null)
            refreshAll()
          }}
        />
      ) : null}
      {group ? (
        <>
          <AudioCommentsDialog open={dialog === 'comments'} group={group} canEdit={permissions.canEdit} onClose={() => setDialog(null)} onChanged={refreshCounts} />
          <AudioCleanupDialog open={dialog === 'cleanup'} group={group} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setSelectedId(null); refreshAll() }} />
          <AudioOrderDialog
            open={dialog === 'order'}
            group={group}
            onClose={() => setDialog(null)}
            onOrdered={(order) => {
              setDialog(null)
              queryClient.setQueryData([AUDIO_QUERY_KEY, 'orders', group.id], (current: { items: typeof order[]; total: number } | undefined) => ({
                items: [order, ...(current?.items ?? []).filter((entry) => entry.id !== order.id)],
                total: (current?.total ?? 0) + 1,
              }))
              void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'orders', group.id] })
            }}
          />
        </>
      ) : null}
      <AudioSettingsDialog open={dialog === 'settings'} canManage={permissions.canManageWorkflows} onClose={() => setDialog(null)} />
    </PageWithSidebar>
  )
}

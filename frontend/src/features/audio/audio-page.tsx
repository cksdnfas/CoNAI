import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useInfiniteQuery, useQueries, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Download, FolderInput, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { useStreamFallbackInterval } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import {
  AUDIO_QUERY_KEY,
  audioCandidateExportUrl,
  audioExportDownloadUrl,
  cancelAudioOrder,
  createAudioFolder,
  createAudioGroup,
  deleteAudioFolder,
  deleteAudioGroup,
  deleteAudioProject,
  downloadAttachment,
  getAudioGroup,
  listAudioCandidates,
  listAudioFolders,
  listAudioGroups,
  listAudioOrders,
  listAudioProjects,
  moveAudioCandidates,
  retryAudioOrderJob,
  saveBlob,
  setAudioReview,
  startAudioExport,
  updateAudioFolder,
  updateAudioGroup,
  uploadAudioFiles,
  type AudioCandidate,
  type AudioCandidatePage,
  type AudioExportResult,
  type AudioFolder,
  type AudioGroup,
  type AudioProject,
  type AudioReview,
} from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'
import { runtimeJobQueryKey, useRuntimeJob } from '@/lib/use-runtime-job'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { AudioCandidateRow, AudioOrderRow, activeJobCount, arrangeCandidates } from './audio-candidate-list'
import { AudioCleanupDialog, AudioCommentsDialog, AudioGroupDialog, AudioProjectDialog, TextTabs } from './audio-dialogs'
import { AudioEditorPanel } from './audio-editor-panel'
import { AudioGenerateBar } from './audio-generate-bar'
import { autoAudioLabel } from './audio-naming'
import { audioPlayer } from './audio-player'
import { AUDIO_SHORTCUT_ACTIONS, normalizeShortcutKey, shouldIgnoreReviewKey, useAudioShortcuts } from './audio-shortcuts'
import { AudioSettingsDialog } from './audio-settings-dialog'
import { AudioSidebar, AudioSidebarFooter, type AudioSidebarFilter } from './audio-sidebar'

const PROJECT_STORAGE_KEY = 'conai:audio:project'
const FOLDERS_STORAGE_KEY = 'conai:audio:folders'
const PAGE_SIZE = 200
/** Failed orders stay listed (with retry) for a day. */
const FAILED_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000

type Dialog = 'project-new' | 'project-edit' | 'group-edit' | 'comments' | 'cleanup' | 'settings' | null
type ReviewTab = 'all' | AudioReview

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the choice still holds for this visit.
  }
}

function readExpanded(): Set<string> {
  try {
    const value = JSON.parse(readStored(FOLDERS_STORAGE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Unfiltered group list of one project; the tree, the move targets and send-to-audio share this cache entry. */
const projectGroupsKey = (projectId: string | null) => [AUDIO_QUERY_KEY, 'groups', projectId, '', null] as const

function useAudioPermissions() {
  const auth = useAuthStatusQuery().data
  const has = (key: string) => !!auth?.authenticated && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, key))
  return {
    canEdit: has('audio.edit'),
    canGenerate: has('audio.edit') && has('generation.execute'),
    canManageWorkflows: has('audio.edit'),
    canAddWorkflow: has('audio.edit') && has('workflows.edit'),
  }
}

/** /audio — the sound-effect workspace: projects ▸ folders (그룹) ▸ effects (audio groups), takes, review, editing, generation and export. */
export function AudioPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const isDesktop = useDesktopPageLayout()
  const permissions = useAudioPermissions()
  const shortcuts = useAudioShortcuts()
  const [searchParams, setSearchParams] = useSearchParams()
  const groupId = searchParams.get('group')
  const [storedProjectId, setProjectIdState] = useState<string | null>(() => readStored(PROJECT_STORAGE_KEY))
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState<AudioSidebarFilter>(null)
  const [reviewTab, setReviewTab] = useState<ReviewTab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [moveTargetId, setMoveTargetId] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [editingProject, setEditingProject] = useState<AudioProject | null>(null)
  const [settingsWorkflowId, setSettingsWorkflowId] = useState<number | null>(null)
  const [freshGroupId, setFreshGroupId] = useState<string | null>(null)
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
  const searching = Boolean(debouncedSearch.trim()) || filter !== null

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id)
    writeStored(PROJECT_STORAGE_KEY, id)
  }, [])
  const setGroupId = useCallback((id: string | null, replace = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('group', id)
      else next.delete('group')
      return next
    }, { replace })
  }, [setSearchParams])
  const expand = useCallback((id: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (open ?? !next.has(id)) next.add(id)
      else next.delete(id)
      writeStored(FOLDERS_STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  /* ---------------------------------------------------------------------------------------------- data */

  const projectsQuery = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'projects'], queryFn: listAudioProjects })
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const groupQuery = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'group', groupId], queryFn: () => getAudioGroup(groupId!), enabled: Boolean(groupId), retry: false })
  const group = groupQuery.data && groupQuery.data.id === groupId ? groupQuery.data : null
  // The open group decides the project. The URL (?group=) updates in a router transition, a render after the
  // remembered project, so comparing the two mid-switch would bounce the click back to the old group.
  const projectId = group?.project_id ?? storedProjectId

  // A group link (chat card, ?group=) wins over the remembered project, and opens its folder in the tree — once per
  // group, so a stale group from before a switch never overwrites the project just picked.
  const syncedGroupRef = useRef<string | null>(null)
  useEffect(() => {
    if (!group || syncedGroupRef.current === group.id) return
    syncedGroupRef.current = group.id
    if (group.project_id !== storedProjectId) setProjectId(group.project_id)
    if (group.folder_id && !expanded.has(group.folder_id)) expand(group.folder_id, true)
  }, [group, storedProjectId, setProjectId, expanded, expand])
  useEffect(() => {
    if (!projectsQuery.isSuccess) return
    if (projects.length === 0) return
    if (!projectId || !projects.some((project) => project.id === projectId)) {
      if (!groupId || groupQuery.isError) setProjectId(projects[0].id)
    }
  }, [projectsQuery.isSuccess, projects, projectId, groupId, groupQuery.isError, setProjectId])
  const project = projects.find((entry) => entry.id === projectId) ?? null

  const projectGroupsQuery = useQuery({ queryKey: projectGroupsKey(projectId), queryFn: () => listAudioGroups(projectId!), enabled: Boolean(projectId) })
  const projectGroups = useMemo(() => projectGroupsQuery.data ?? [], [projectGroupsQuery.data])
  const effects = useMemo(() => projectGroups.filter((entry) => !entry.is_inbox), [projectGroups])

  const foldersQuery = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'folders', projectId], queryFn: () => listAudioFolders(projectId!), enabled: Boolean(projectId) })
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const folder = group?.folder_id ? folders.find((entry) => entry.id === group.folder_id) ?? null : null

  // The tree shows the open project; a search or filter looks through every project.
  const searchProjectIds = useMemo(() => (searching ? projects.map((entry) => entry.id) : []), [searching, projects])
  const searchQueries = useQueries({
    queries: searchProjectIds.map((id) => ({
      queryKey: [AUDIO_QUERY_KEY, 'groups', id, debouncedSearch, filter],
      queryFn: () => listAudioGroups(id, { search: debouncedSearch, filter }),
      placeholderData: (previous: AudioGroup[] | undefined) => previous,
    })),
  })
  const searchResults = useMemo(() => {
    if (!searching) return null
    const map: Record<string, AudioGroup[] | undefined> = {}
    searchProjectIds.forEach((id, index) => { map[id] = searchQueries[index]?.data })
    return map
  }, [searching, searchProjectIds, searchQueries])

  // Without a group in the URL (or after it was deleted), open the first effect of the project. 받은 파일 opens only
  // when picked: a project without effects shows the "add an effect" state instead.
  useEffect(() => {
    if (!projectId || !projectGroupsQuery.isSuccess || searching) return
    const missing = !groupId || groupQuery.isError
    if (!missing) return
    const next = effects[0]?.id ?? null
    if (next !== groupId) setGroupId(next, true)
  }, [projectId, projectGroupsQuery.isSuccess, effects, groupId, group, groupQuery.isError, searching, setGroupId])

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
  useEffect(() => {
    setSelectedId(null)
    setChecked(new Set())
  }, [groupId])

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
    void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'folders'] })
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
    const onKey = (event: globalThis.KeyboardEvent) => {
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

  /* ---------------------------------------------------------------------------------------------- projects / effects */

  const createEffect = async (targetProjectId: string, name: string, folderId: string | null = null) => {
    const siblings = queryClient.getQueryData<AudioGroup[]>(projectGroupsKey(targetProjectId)) ?? []
    try {
      const created = await createAudioGroup(targetProjectId, { name, label: autoAudioLabel(name, siblings.map((entry) => entry.label)), folder_id: folderId })
      setProjectId(targetProjectId)
      setFreshGroupId(created.id)
      setGroupId(created.id)
      refreshCounts()
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }
  const createFolder = async (targetProjectId: string, name: string) => {
    try {
      await createAudioFolder(targetProjectId, { name })
      refreshCounts()
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }
  const renameFolder = async (target: AudioFolder, name: string) => {
    try {
      await updateAudioFolder(target.id, { name })
      refreshCounts()
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }
  const removeFolder = async (target: AudioFolder) => {
    const inside = projectGroups.filter((entry) => entry.folder_id === target.id).length
    const ok = await confirm({
      title: t({ ko: '그룹 삭제', en: 'Delete group' }),
      description: inside > 0
        ? t({ ko: '"{name}" 그룹만 지워. 안의 효과음 {count}개는 그룹 밖으로 나와.', en: 'Only the group "{name}" goes; its {count} effects move out of it.' }, { name: target.name, count: inside })
        : t({ ko: '"{name}" 그룹을 지워.', en: 'Delete the group "{name}".' }, { name: target.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!ok) return
    try {
      await deleteAudioFolder(target.id)
    } catch (error) {
      fail(error)
    }
    refreshCounts()
  }
  const moveEffect = async (target: AudioGroup, folderId: string | null) => {
    try {
      await updateAudioGroup(target.id, { folder_id: folderId })
      if (folderId) expand(folderId, true)
    } catch (error) {
      fail(error)
    }
    refreshCounts()
  }
  const removeProject = async (target: AudioProject) => {
    const ok = await confirm({
      title: t({ ko: '프로젝트 삭제', en: 'Delete project' }),
      description: t({ ko: '"{name}"의 효과음과 후보 {count}개가 모두 휴지통으로 가.', en: 'All effects and {count} takes of "{name}" go to the RecycleBin.' }, { name: target.name, count: target.candidate_count }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!ok) return
    try {
      await deleteAudioProject(target.id)
      if (target.id === projectId) {
        setProjectIdState(null)
        setGroupId(null)
      }
      refreshAll()
    } catch (error) {
      fail(error)
    }
  }
  const removeGroup = async (target: AudioGroup) => {
    const ok = await confirm({
      title: t({ ko: '효과음 삭제', en: 'Delete effect' }),
      description: t({ ko: '"{name}"의 후보 {count}개가 휴지통으로 가.', en: '{count} takes of "{name}" go to the RecycleBin.' }, { name: target.name, count: target.candidate_count }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!ok) return
    try {
      await deleteAudioGroup(target.id)
      setDialog(null)
      setGroupId(null)
      refreshAll()
    } catch (error) {
      fail(error)
    }
  }
  const moveTakes = async (ids: string[], target: AudioGroup) => {
    if (ids.length === 0) return
    try {
      await moveAudioCandidates(ids, target.id)
      showSnackbar({ message: t({ ko: '{count}개를 "{name}"(으)로 옮겼어.', en: 'Moved {count} to "{name}".' }, { count: ids.length, name: target.is_inbox ? t({ ko: '받은 파일', en: 'Inbox' }) : target.name }) })
      setChecked(new Set())
      if (selectedId && ids.includes(selectedId)) setSelectedId(null)
    } catch (error) {
      fail(error)
    }
    refreshAll()
  }

  /* ---------------------------------------------------------------------------------------------- upload / export */

  const upload = async (target: { groupId: string } | { projectId: string }, files: File[]) => {
    if (files.length === 0) return
    try {
      const result = await uploadAudioFiles(target, files)
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
    if (permissions.canEdit && group) void upload({ groupId: group.id }, Array.from(event.dataTransfer.files))
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

  // The chat moves around the tree (the open project's groups, or the search results), the review tabs and the takes;
  // reviewing stays here.
  const chatGroups = (searchResults ? Object.values(searchResults).flatMap((entries) => entries ?? []) : projectGroups).slice(0, 200)
  const chatTakes = rows.slice(0, 200).map((row) => row.candidate)
  useChatPageRegistration({
    kind: 'audio',
    title: t({ ko: '오디오', en: 'Audio' }),
    resourceId: group?.id ?? null,
    fields: [],
    data: {
      project: project ? { id: project.id, name: project.name } : null,
      group: group ? { id: group.id, name: group.name, label: group.label, folder: folder?.name ?? null, description: group.description, prompt: group.prompt, isInbox: group.is_inbox } : null,
      reviewFilter: reviewTab,
      selectedCandidateIds: selected ? [selected.id] : [],
      groups: chatGroups.map((entry) => ({ id: entry.id, projectId: entry.project_id, name: entry.name, isInbox: entry.is_inbox })),
      takes: chatTakes.map((candidate) => ({ id: candidate.id, name: candidate.name, review: candidate.review })),
    },
    actions: [
      ...(chatGroups.length ? [pageAction('audio.open', t({ ko: '오디오 그룹 열기', en: 'Open audio group' }), t({ ko: '목록(data.groups)의 효과음 그룹이나 받은 파일을 열어.', en: 'Open a listed group (data.groups).' }), pageObject({ groupId: pageChoice(chatGroups.map((entry) => entry.id)) }, ['groupId']))] : []),
      ...(group ? [pageAction('audio.filter', t({ ko: '검수 탭 바꾸기', en: 'Switch review tab' }), t({ ko: '전체·미검수·채택·보류 탭으로 바꿔.', en: 'Show all, unreviewed, adopted or rejected takes.' }), pageObject({ review: pageChoice(['all', 'pending', 'selected', 'rejected']) }, ['review']))] : []),
      ...(chatTakes.length ? [pageAction('audio.select', t({ ko: '테이크 선택', en: 'Select take' }), t({ ko: '목록(data.takes)의 테이크를 골라 편집 패널을 열어.', en: 'Select a listed take (data.takes) and open its editor.' }), pageObject({ candidateId: pageChoice(chatTakes.map((candidate) => candidate.id)) }, ['candidateId']))] : []),
    ],
    apply: () => undefined,
    applyAction: (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'audio.open') {
        const target = chatGroups.find((entry) => entry.id === String(args.groupId))
        if (!target) throw new Error('목록에 없는 그룹이야.')
        setProjectId(target.project_id)
        setGroupId(target.id)
        return
      }
      if (id === 'audio.filter') { setReviewTab(String(args.review) as ReviewTab); setSelectedId(null); return }
      if (id === 'audio.select') {
        if (!chatTakes.some((candidate) => candidate.id === String(args.candidateId))) throw new Error('목록에 없는 테이크야.')
        setSelectedId(String(args.candidateId))
        return
      }
      throw new Error('오디오 페이지에 없는 작업이야.')
    },
  }, { preserveOnSearchChange: true })

  /* ---------------------------------------------------------------------------------------------- render */

  const tabs: Array<[ReviewTab, string, number?]> = group ? [
    ['all', t({ ko: '전체', en: 'All' }), group.candidate_count],
    ['pending', t({ ko: '미검수', en: 'Unreviewed' }), group.pending_review_count],
    ['selected', t({ ko: '채택', en: 'Adopted' }), group.selected_count],
    ['rejected', t({ ko: '보류', en: 'Rejected' }), Math.max(0, group.candidate_count - group.selected_count - group.pending_review_count)],
  ] : []
  const inbox = group?.is_inbox === true
  const groupTitle = group
    ? (inbox ? t({ ko: '받은 파일', en: 'Inbox' }) : folder ? <><span className="font-normal text-muted-foreground">{folder.name} / </span>{group.name}</> : group.name)
    : project?.name ?? t({ ko: '오디오', en: 'Audio' })
  // Takes move within their project: to its effects, or back to its 받은 파일.
  const moveTargets = group ? projectGroups.filter((entry) => entry.id !== group.id && (!entry.is_inbox || !inbox)) : []
  const inboxEffects = moveTargets.filter((entry) => !entry.is_inbox)
  const moveTarget = inboxEffects.find((entry) => entry.id === moveTargetId) ?? inboxEffects[0] ?? null
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

  const exportBusy = exporting || Boolean(exportJobId)
  const toolbarActions = group ? (
    <>
      {!inbox ? (
        <span className="relative inline-flex">
          <IconButton variant="ghost" label={t({ ko: '코멘트', en: 'Comments' })} onClick={() => setDialog('comments')}><MessageSquare /></IconButton>
          {group.pending_comment_count > 0 ? <span className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-2xs leading-4 font-semibold text-primary-foreground">{group.pending_comment_count}</span> : null}
        </span>
      ) : null}
      {permissions.canEdit ? <IconButton variant="ghost" label={t({ ko: '업로드', en: 'Upload' })} onClick={() => uploadInputRef.current?.click()}><Upload /></IconButton> : null}
      <IconButton variant="ghost" label={t({ ko: '채택본 내보내기', en: 'Export adopted takes' })} disabled={exportBusy} onClick={() => void runExport({ groupId: group.id })}><Download /></IconButton>
      {permissions.canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" label={t({ ko: '더 보기', en: 'More' })}><MoreHorizontal /></IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!inbox ? <DropdownMenuItem onSelect={() => setDialog('group-edit')}><Pencil />{t({ ko: '효과음 수정', en: 'Edit effect' })}</DropdownMenuItem> : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!selected}><FolderInput />{t({ ko: '고른 후보 옮기기', en: 'Move the picked take' })}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {moveTargets.length === 0 ? <DropdownMenuItem disabled>{t({ ko: '효과음 없음', en: 'No effects' })}</DropdownMenuItem> : null}
                {moveTargets.map((entry) => (
                  <DropdownMenuItem key={entry.id} onSelect={() => selected && void moveTakes([selected.id], entry)}>
                    {entry.is_inbox ? t({ ko: '받은 파일', en: 'Inbox' }) : entry.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setDialog('cleanup')}><Trash2 />{t({ ko: '후보 정리', en: 'Clean up takes' })}</DropdownMenuItem>
            {!inbox ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void removeGroup(group)}><Trash2 />{t({ ko: '효과음 삭제', en: 'Delete effect' })}</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  ) : null

  return (
    <PageWithSidebar
      storageKey="audio"
      sidebarLabel={t({ ko: '프로젝트와 효과음', en: 'Projects and effects' })}
      sidebarWidth={256}
      sidebar={(
        <AudioSidebar
          projects={projects}
          project={project}
          onSelectProject={(id) => {
            if (id === projectId) return
            setProjectId(id)
            setGroupId(null)
          }}
          groups={projectGroups}
          folders={folders}
          searchResults={searchResults}
          expandedFolders={expanded}
          onToggleFolder={expand}
          activeGroupId={groupId}
          onSelectGroup={(entry) => {
            setProjectId(entry.project_id)
            setGroupId(entry.id)
          }}
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          canEdit={permissions.canEdit}
          exporting={exportBusy}
          onNewProject={() => setDialog('project-new')}
          onEditProject={(entry) => { setEditingProject(entry); setDialog('project-edit') }}
          onExportProject={(entry) => void runExport({ projectId: entry.id })}
          onDeleteProject={(entry) => void removeProject(entry)}
          onCreateGroup={createEffect}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={(entry) => void removeFolder(entry)}
          onMoveGroup={(entry, folderId) => void moveEffect(entry, folderId)}
          onDropCandidates={(target, ids) => void moveTakes(ids, target)}
          onDropFiles={(target, files) => void upload(target, files)}
        />
      )}
      sidebarFooter={(
        <AudioSidebarFooter
          canEdit={permissions.canEdit}
          onNewProject={() => setDialog('project-new')}
          onOpenSettings={() => { setSettingsWorkflowId(null); setDialog('settings') }}
        />
      )}
      toolbar={(
        <PageToolbar
          title={groupTitle}
          start={group?.label && !inbox ? (
            <Tip content={permissions.canEdit ? t({ ko: '내보낼 파일명: 눌러서 바꾸기', en: 'Export file name: click to change' }) : t({ ko: '내보낼 파일명', en: 'Export file name' })}>
              {/* The span carries the tooltip while the button is disabled (a disabled button gets no pointer events). */}
              <span className="inline-flex min-w-0" tabIndex={permissions.canEdit ? undefined : 0}>
                <Button
                  variant="subtle"
                  size="xs"
                  className="min-w-0 truncate font-mono font-normal"
                  disabled={!permissions.canEdit}
                  onClick={() => setDialog('group-edit')}
                >
                  {group.label}
                </Button>
              </span>
            </Tip>
          ) : null}
          actions={toolbarActions}
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
          if (group) void upload({ groupId: group.id }, files)
        }}
      />
      {exportJob.job ? <RuntimeJobProgress job={exportJob.job} cancel={exportJob.cancel} isCancelling={exportJob.isCancelling} className="mb-4" /> : null}

      {projectsQuery.isSuccess && projects.length === 0 ? (
        <EmptyAudio title={t({ ko: '프로젝트 없음', en: 'No projects' })}>
          {permissions.canEdit ? <Button onClick={() => setDialog('project-new')}><FolderPlus />{t({ ko: '새 프로젝트', en: 'New project' })}</Button> : null}
        </EmptyAudio>
      ) : !group && project && projectGroupsQuery.isSuccess && effects.length === 0 && !groupId ? (
        <EmptyAudio title={t({ ko: '효과음 없음', en: 'No effects' })}>
          {permissions.canEdit ? <NewEffectInput key={project.id} onCreate={(name) => createEffect(project.id, name)} /> : null}
        </EmptyAudio>
      ) : null}

      {group ? (
        <div className="flex items-start gap-6">
          <div
            className={cn('relative min-w-0 flex-1 space-y-3', dragging && 'after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:border-2 after:border-dashed after:border-primary')}
            onDragOver={(event) => {
              if (!permissions.canEdit || !event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
            onDrop={onDrop}
          >
            {!inbox && group.description ? <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground">{group.description}</p> : null}
            {!inbox && permissions.canEdit ? (
              <AudioGenerateBar
                key={group.id}
                group={group}
                autoFocus={freshGroupId === group.id}
                canGenerate={permissions.canGenerate}
                canAddWorkflow={permissions.canAddWorkflow}
                onPromptSaved={refreshCounts}
                onOpenSettings={(workflowId) => { setSettingsWorkflowId(workflowId); setDialog('settings') }}
                onOrdered={(order) => {
                  queryClient.setQueryData([AUDIO_QUERY_KEY, 'orders', group.id], (current: { items: typeof order[]; total: number } | undefined) => ({
                    items: [order, ...(current?.items ?? []).filter((entry) => entry.id !== order.id)],
                    total: (current?.total ?? 0) + 1,
                  }))
                  void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'orders', group.id] })
                }}
              />
            ) : null}
            <div>
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
                    checked={checked.has(row.candidate.id)}
                    onCheck={inbox && permissions.canEdit ? (value) => setChecked((current) => {
                      const next = new Set(current)
                      if (value) next.add(row.candidate.id)
                      else next.delete(row.candidate.id)
                      return next
                    }) : undefined}
                    moveTargets={inboxEffects}
                    onMove={inbox ? (target) => void moveTakes([row.candidate.id], target) : undefined}
                    dragIds={() => (checked.has(row.candidate.id) ? [...checked] : [row.candidate.id])}
                  />
                ))}
                {rows.length === 0 && candidatesQuery.isSuccess && visibleOrders.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">{t({ ko: '후보 없음', en: 'No takes' })}</p>
                ) : null}
                <div ref={loadMoreRef} className="h-px" />
              </div>
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

      {inbox && checked.size > 0 ? (
        <SelectionActionBar
          selectedCount={checked.size}
          onClear={() => setChecked(new Set())}
          actions={(
            <>
              <Select className="h-8 w-44" aria-label={t({ ko: '옮길 효과음', en: 'Move to' })} value={moveTarget?.id ?? ''} disabled={inboxEffects.length === 0} onChange={(event) => setMoveTargetId(event.target.value)}>
                {inboxEffects.length === 0 ? <option value="">{t({ ko: '효과음 없음', en: 'No effects' })}</option> : null}
                {inboxEffects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </Select>
              <SelectionBarAction icon={FolderInput} label={t({ ko: '옮기기', en: 'Move' })} variant="default" disabled={!moveTarget} onClick={() => moveTarget && void moveTakes([...checked], moveTarget)} />
            </>
          )}
        />
      ) : null}

      <AudioProjectDialog
        open={dialog === 'project-new' || dialog === 'project-edit'}
        project={dialog === 'project-edit' ? editingProject : null}
        onClose={() => setDialog(null)}
        onSaved={(saved) => {
          const created = dialog === 'project-new'
          setDialog(null)
          refreshCounts()
          if (created) {
            setProjectId(saved.id)
            setGroupId(null)
          }
        }}
      />
      <AudioGroupDialog
        open={dialog === 'group-edit'}
        group={group}
        folders={folders}
        takenLabels={projectGroups.filter((entry) => entry.id !== group?.id).map((entry) => entry.label)}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null)
          refreshCounts()
        }}
        onDelete={() => group && void removeGroup(group)}
      />
      {group ? (
        <>
          <AudioCommentsDialog open={dialog === 'comments'} group={group} canEdit={permissions.canEdit} onClose={() => setDialog(null)} onChanged={refreshCounts} />
          <AudioCleanupDialog open={dialog === 'cleanup'} group={group} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setSelectedId(null); refreshAll() }} />
        </>
      ) : null}
      <AudioSettingsDialog open={dialog === 'settings'} canManage={permissions.canManageWorkflows} focusWorkflowId={settingsWorkflowId} onClose={() => setDialog(null)} />
    </PageWithSidebar>
  )
}

function EmptyAudio({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

/** "효과음 이름 + 추가" for a project without effects; the new effect opens with its prompt focused. */
function NewEffectInput({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    if (await onCreate(name.trim())) setName('')
    setBusy(false)
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        className="w-56"
        maxLength={120}
        placeholder={t({ ko: '효과음 이름', en: 'Effect name' })}
        aria-label={t({ ko: '새 효과음 이름', en: 'New effect name' })}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <Button disabled={!name.trim() || busy} onClick={() => void submit()}><Plus />{t({ ko: '추가', en: 'Add' })}</Button>
    </div>
  )
}

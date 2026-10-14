import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, FilePlus, FileText, Folder, FolderInput, FolderKanban, FolderPlus, History, LayoutGrid, List, Pencil, Puzzle, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import type { WorkspaceEntry, WorkspaceOperation, WorkspaceProject } from '@conai/shared'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PathBreadcrumbs } from '@/components/common/path-breadcrumbs'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SearchField } from '@/components/common/search-field'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { ListPager } from '@/components/common/list-pager'
import { MoveDialog, NameDialog } from '@/components/common/entry-dialogs'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { SidebarNav } from '@/components/ui/sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPageDataPermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/format-size'
import { applyWorkspace, deleteWorkspaceEntries, getWorkspace, listWorkspaceEntries, listWorkspaceFolders, readWorkspace, searchWorkspace, statWorkspace } from '@/lib/api-workspaces'
import { ApiRequestError } from '@/lib/api-request'
import { getErrorMessage } from '@/lib/error-message'
import { FileEntryView, type EntryItem } from './file-entry-views'
import { useFileViewMode } from './file-view-mode'
import { StoreFolderSidebarGroup } from './store-folders'
import { SystemFolderSidebarGroup, type SystemFolderLocation } from './system-folder-browser'
import { TextDocumentEditor, type TextDocumentStore } from './text-document-editor'
import { WorkspaceChangesDialog, WorkspaceProjectDialog } from './workspace-dialogs'
import { WorkspaceSidebarGroup } from './workspace-projects'
import { HighlightText } from '@/components/common/highlight-text'
import { fileExtension } from '@/lib/file-extension'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { droppedIds, isMoveDrag, startMoveDrag } from './file-drag'

const DRAG_TYPE = 'application/x-conai-workspace-targets'
/** A document read in one go; larger ones are edited from chat in parts. */
const EDITOR_LIMIT = 1024 * 1024
const IMPORT_LIMIT = { files: 100, bytes: 8 * 1024 * 1024 }
const PAGE_SIZE = 100
type WorkspaceDocument = { id: string; name: string; size: number }

const join = (...parts: string[]) => parts.filter(Boolean).join('/')
const baseName = (target: string) => target.split('/').at(-1) ?? target
const parentOf = (target: string) => (target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '')

/**
 * A project workspace in the files page: the same toolbar, list, selection bar, dialogs and document editor as the
 * file store, on the project's own folders. Guidelines open from the toolbar; deletes need files.delete.
 */
export function WorkspaceBrowser({ projectId, dir, onNavigate, onProject, onCreateProject, onStore, onSystem }: {
  projectId: string
  dir: string
  onNavigate: (dir: string) => void
  onProject: (id: string) => void
  onCreateProject?: () => void
  onStore: (folderId: string | null) => void
  onSystem: (location: SystemFolderLocation) => void
}) {
  const { t } = useI18n()
  const navigateTo = useNavigate()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const auth = useAuthStatusQuery()
  const permissions = auth.data?.permissionKeys ?? []
  const canWrite = permissions.includes('files.edit')
  const canDelete = canWrite && permissions.includes('files.delete')
  const chatPage = useChatPageDataPermissions().canReadFiles
  const [viewMode, changeViewMode] = useFileViewMode('workspace')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [nameDialog, setNameDialog] = useState<{ target?: string; name: string } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [editor, setEditor] = useState<{ entry: WorkspaceDocument | null } | null>(null)
  const [projectOpen, setProjectOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const searchQuery = useDebouncedValue(searchInput.trim())
  const uploadInput = useRef<HTMLInputElement>(null)
  const searching = searchOpen && searchQuery !== ''
  // Another folder (a breadcrumb, the browser's Back) starts unselected on its first page: a selection the person
  // can no longer see must never reach a delete or move.
  const [shownDir, setShownDir] = useState(dir)
  if (shownDir !== dir) {
    setShownDir(dir)
    setSelected([])
    setOffset(0)
  }

  const project = useQuery({ queryKey: ['workspaces', projectId, 'info'], queryFn: () => getWorkspace(projectId) })
  const entries = useQuery({ queryKey: ['workspaces', projectId, 'entries', dir, offset], queryFn: () => listWorkspaceEntries(projectId, dir, offset), enabled: !searching })
  // Each page checks 100 entries; "더 찾기" adds the next page's hits below the ones found so far.
  const results = useInfiniteQuery({
    queryKey: ['workspaces', projectId, 'search', searchQuery],
    queryFn: ({ pageParam, signal }) => searchWorkspace(projectId, searchQuery, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: searching,
  })
  const hits = results.data?.pages.flatMap((page) => page.hits) ?? []
  const folders = useQuery({ queryKey: ['workspaces', projectId, 'folders'], queryFn: () => listWorkspaceFolders(projectId), enabled: moveOpen })
  const shown = useMemo(() => entries.data?.entries ?? [], [entries.data])
  const selection = shown.filter((entry) => selected.includes(entry.target))
  const projectName = project.data?.name ?? t({ ko: '프로젝트', en: 'Project' })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workspaces', projectId] })

  /** Applies and reports a partial failure as an error (the change history keeps what did go through). */
  const mutation = useMutation({
    mutationFn: async (run: () => Promise<{ status: string; error?: string; results: unknown[] } | void>) => {
      const result = await run()
      await refresh()
      if (result && result.status !== 'completed') throw new Error(result.error ?? result.status)
    },
    onSuccess: () => { setSelected([]); setNameDialog(null); setMoveOpen(false) },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '작업을 완료하지 못했어.', en: 'Could not complete the operation.' })) }),
  })
  const busy = mutation.isPending
  const apply = (operations: WorkspaceOperation[]) => applyWorkspace(projectId, operations)
  // A listed file is checked against the revision the person saw; a folder's is read when they act.
  const revision = async (target: string) => byTarget.get(target)?.revision ?? (await statWorkspace(projectId, target)).revision
  const moveTo = (targets: string[], destination: string) => mutation.mutate(async () => {
    const moving = targets.filter((target) => join(destination, baseName(target)) !== target)
    if (!moving.length) return
    return apply(await Promise.all(moving.map(async (target) => ({ kind: 'move' as const, target, destination: join(destination, baseName(target)), expectedRevision: await revision(target) }))))
  })
  const rename = (target: string, name: string) => mutation.mutate(async () => apply([{ kind: 'move', target, destination: join(parentOf(target), name.trim()), expectedRevision: await revision(target) }]))
  const createFolder = (name: string) => mutation.mutate(() => apply([{ kind: 'mkdir', target: join(dir, name.trim()) }]))
  const remove = async (targets: string[]) => {
    const folderCount = shown.filter((entry) => targets.includes(entry.target) && entry.kind === 'folder').length
    const ok = await confirm({
      title: t({ ko: '선택한 {count}개를 삭제할까?', en: 'Delete {count} selected items?' }, { count: targets.length }),
      description: folderCount ? t({ ko: '폴더는 안에 든 문서까지 모두 지워져. 되돌릴 수 없어.', en: 'Folders are deleted with everything in them. This cannot be undone.' }) : t({ ko: '되돌릴 수 없어.', en: 'This cannot be undone.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (ok) mutation.mutate(async () => deleteWorkspaceEntries(projectId, await Promise.all(targets.map(async (target) => ({ target, expectedRevision: await revision(target) })))))
  }
  const importFiles = (files: File[], folder = dir) => {
    if (!canWrite || busy || !files.length) return
    mutation.mutate(async () => {
      if (files.length > IMPORT_LIMIT.files || files.reduce((sum, file) => sum + file.size, 0) > IMPORT_LIMIT.bytes) throw new Error(t({ ko: '한 번에 100개, 8MB까지 가져올 수 있어.', en: 'Up to 100 files and 8 MB at a time.' }))
      const operations = await Promise.all(files.map(async (file) => {
        let text: string
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) } catch { throw new Error(t({ ko: 'UTF-8 텍스트만 가져올 수 있어: {name}', en: 'Only UTF-8 text can be imported: {name}' }, { name: file.name })) }
        return { kind: 'write' as const, target: join(folder, file.name), text, expectedRevision: null }
      }))
      return apply(operations)
    })
  }
  const closeSearch = () => { setSearchOpen(false); setSearchInput('') }
  const openFolder = (target: string) => { closeSearch(); setSelected([]); setOffset(0); onNavigate(target) }
  const openDocument = (entry: Pick<WorkspaceEntry, 'target' | 'size'>) => setEditor({ entry: { id: entry.target, name: baseName(entry.target), size: entry.size } })
  const toggle = (target: string, checked: boolean) => setSelected((current) => (checked ? [...current, target] : current.filter((value) => value !== target)))

  // Drag rows onto folders to move them; drop files from the computer to import them.
  const dragOver = (event: DragEvent) => {
    if (busy || !canWrite) return
    event.preventDefault()
    event.dataTransfer.dropEffect = isMoveDrag(event, DRAG_TYPE) ? 'move' : 'copy'
  }
  const drop = (event: DragEvent, folder: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy || !canWrite) return
    const targets = droppedIds(event, DRAG_TYPE)
    if (targets) moveTo(targets.filter((target) => target !== folder && !folder.startsWith(`${target}/`)), folder)
    else if (event.dataTransfer.files.length) importFiles(Array.from(event.dataTransfer.files), folder)
  }

  const store = useMemo((): TextDocumentStore<WorkspaceDocument> => ({
    key: `workspace:${projectId}`,
    load: async (document) => {
      const { files: [file] } = await readWorkspace(projectId, [{ target: document.id, limit: EDITOR_LIMIT }])
      // The list's size can be stale: a document that grew past one read must not open (saving it would drop the rest).
      if (file.nextOffset !== null) return { tooLarge: true as const }
      return { text: file.text, revision: file.revision }
    },
    save: async (document, text, revisionValue, fileName) => {
      const target = document?.id ?? join(dir, fileName)
      const result = await applyWorkspace(projectId, [{ kind: 'write', target, text, expectedRevision: document ? revisionValue : null }])
      if (result.status !== 'completed') throw new ApiRequestError(result.error ?? result.status, result.conflict ? 409 : 400)
      return { document: { id: target, name: baseName(target), size: new TextEncoder().encode(text).length }, revision: result.results[0]?.revision ?? null }
    },
    refresh,
    tooLarge: (document) => document.size > EDITOR_LIMIT,
    tooLargeTitle: t({ ko: '1MB가 넘는 문서는 채팅에서 부분 편집으로 고쳐줘', en: 'Edit documents over 1 MB in parts from chat' }),
    location: [projectName, dir].filter(Boolean).join(' / '),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only closes over projectId
  }), [projectId, dir, projectName, t])

  useChatPageRegistration(chatPage ? {
    kind: 'files', title: projectName, resourceId: `workspace:${projectId}`, localRevision: JSON.stringify([dir, offset, selected, nameDialog, searchInput, editor?.entry?.id]),
    fields: [
      { id: 'search', label: t({ ko: '검색어 (빈 값은 검색 닫기)', en: 'Search (empty closes search)' }), type: 'text', value: searchOpen ? searchInput : '' },
      ...(nameDialog ? [{ id: 'name', label: t({ ko: '폴더 이름 입력', en: 'Folder name draft' }), type: 'text' as const, value: nameDialog.name }] : []),
    ],
    data: { project: { id: projectId, name: projectName }, folder: dir, offset, entries: shown.map((entry) => ({ target: entry.target, kind: entry.kind, bytes: entry.size })), selected },
    actions: [
      pageAction('workspace.open', t({ ko: '항목 열기', en: 'Open item' }), t({ ko: '목록의 폴더나 문서, 빈 값은 프로젝트 최상위', en: 'a listed folder or document; empty opens the top' }), pageObject({ target: pageText(1000) }, ['target'])),
      pageAction('workspace.search', t({ ko: '검색', en: 'Search' }), t({ ko: 'search를 채운 뒤', en: 'after filling search' })),
      ...(canWrite ? [
        pageAction('workspace.new', t({ ko: '새 문서 쓰기', en: 'New document' }), ''),
        pageAction('workspace.mkdir', t({ ko: '새 폴더 창 열기', en: 'Open new folder dialog' }), t({ ko: 'name을 채우고 workspace.create', en: 'fill name, then workspace.create' })),
        ...(nameDialog && !nameDialog.target && nameDialog.name.trim() ? [pageAction('workspace.create', t({ ko: '폴더 만들기', en: 'Create folder' }), '', undefined, 'save')] : []),
      ] : []),
    ],
    apply: (patch) => {
      if (patch.search !== undefined) { setSearchInput(String(patch.search)); setSearchOpen(String(patch.search).trim() !== '') }
      if (patch.name !== undefined) setNameDialog((current) => (current ? { ...current, name: String(patch.name) } : current))
    },
    applyAction: async (action, args, assertCurrent) => {
      assertCurrent()
      if (action === 'workspace.search') { setSearchOpen(true); return }
      if (action === 'workspace.new') { setEditor({ entry: null }); return }
      if (action === 'workspace.mkdir') { setNameDialog({ name: '' }); return }
      if (action === 'workspace.create' && nameDialog) { await mutation.mutateAsync(() => apply([{ kind: 'mkdir', target: join(dir, nameDialog.name.trim()) }])); return }
      if (action === 'workspace.open') {
        const target = String(args.target ?? '')
        if (!target) { openFolder(''); return }
        const entry = shown.find((item) => item.target === target)
        if (entry?.kind === 'folder') { openFolder(entry.target); return }
        if (entry) { openDocument(entry); return }
      }
      throw new Error('현재 화면에서 사용할 수 없는 작업이야.')
    },
  } : null)

  const rowMenu = (entry: WorkspaceEntry): ActionMenuEntry[] => [
    entry.kind === 'file' && { key: 'open', label: t({ ko: '편집', en: 'Edit' }), icon: FileText, onSelect: () => openDocument(entry) },
    '-',
    canWrite && { key: 'rename', label: t({ ko: '이름 변경', en: 'Rename' }), icon: Pencil, disabled: busy, onSelect: () => setNameDialog({ target: entry.target, name: baseName(entry.target) }) },
    canWrite && { key: 'move', label: t({ ko: '이동', en: 'Move' }), icon: FolderInput, disabled: busy, onSelect: () => { setSelected([entry.target]); setMoveTarget(dir); setMoveOpen(true) } },
    '-',
    canDelete && { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy, onSelect: () => void remove([entry.target]) },
  ]
  const toItem = (entry: WorkspaceEntry): EntryItem => {
    const name = baseName(entry.target)
    const folder = entry.kind === 'folder'
    const Icon = folder ? Folder : FileText
    const extension = folder ? null : fileExtension(name)
    return {
      id: entry.target, name, folder, size: entry.size,
      icon: <Icon className={folder ? 'size-4 shrink-0 text-warning' : 'size-4 shrink-0 text-muted-foreground'} />,
      face: <span className="flex flex-col items-center gap-1"><Icon className={folder ? 'size-9 text-warning' : 'size-9 text-muted-foreground'} />{extension ? <span className="text-2xs font-semibold tracking-wide text-muted-foreground">{extension}</span> : null}</span>,
    }
  }
  const byTarget = new Map(shown.map((entry) => [entry.target, entry]))

  const actions = (
    <>
      <IconButton variant="ghost" label={t({ ko: '프로젝트 지침', en: 'Project guidelines' })} disabled={!project.data} onClick={() => setProjectOpen(true)}><BookOpen /></IconButton>
      <IconButton variant="ghost" label={t({ ko: '플러그인으로 열기', en: 'Open with plugin' })} onClick={() => navigateTo(`/extensions?project=${projectId}`)}><Puzzle /></IconButton>
      <SegmentedControl
        size="xs"
        value={viewMode}
        onChange={(value) => changeViewMode(value === 'grid' ? 'grid' : 'list')}
        ariaLabel={t({ ko: '보기', en: 'View' })}
        items={[
          { value: 'grid', label: <LayoutGrid className="size-3.5" />, ariaLabel: t({ ko: '아이콘 보기', en: 'Icons' }) },
          { value: 'list', label: <List className="size-3.5" />, ariaLabel: t({ ko: '자세히 보기', en: 'Details' }) },
        ]}
      />
      {searchOpen ? null : <IconButton variant="ghost" label={t({ ko: '검색', en: 'Search' })} onClick={() => setSearchOpen(true)}><Search /></IconButton>}
      {canWrite ? <IconButton variant="ghost" label={t({ ko: '새 폴더', en: 'New folder' })} disabled={busy} onClick={() => setNameDialog({ name: '' })}><FolderPlus /></IconButton> : null}
      {canWrite ? <IconButton variant="ghost" label={t({ ko: '텍스트 문서 가져오기', en: 'Import text documents' })} disabled={busy} onClick={() => uploadInput.current?.click()}><Upload /></IconButton> : null}
      <ActionMenuButton
        size="icon"
        label={t({ ko: '더 보기', en: 'More' })}
        entries={[
          canWrite && { key: 'new-document', label: t({ ko: '새 문서', en: 'New document' }), icon: FilePlus, disabled: busy, onSelect: () => setEditor({ entry: null }) },
          { key: 'changes', label: t({ ko: '변경 내역', en: 'Change history' }), icon: History, onSelect: () => setChangesOpen(true) },
          { key: 'refresh', label: t({ ko: '새로고침', en: 'Refresh' }), icon: RefreshCw, disabled: busy, onSelect: () => void refresh() },
        ]}
      />
    </>
  )
  const segments = dir ? dir.split('/') : []
  const breadcrumbs = (
    <PathBreadcrumbs
      ariaLabel={t({ ko: '현재 경로', en: 'Current path' })}
      items={[{ key: '', label: projectName, onClick: () => openFolder('') }, ...segments.map((segment, index) => ({ key: segments.slice(0, index + 1).join('/'), label: segment, onClick: () => openFolder(segments.slice(0, index + 1).join('/')) }))]}
    />
  )
  const searchField = (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <SearchField autoFocus value={searchInput} onChange={setSearchInput} placeholder={t({ ko: '문서 이름이나 내용 검색', en: 'Search document names and text' })} onKeyDown={(event) => { if (event.key === 'Escape') closeSearch() }} />
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '검색 닫기', en: 'Close search' })} onClick={closeSearch}><X /></IconButton>
    </div>
  )
  const sidebar = (
    <SidebarNav aria-label={t({ ko: '폴더', en: 'Folders' })}>
      <WorkspaceSidebarGroup activeId={projectId} onOpen={onProject} onCreate={canWrite ? onCreateProject : undefined} />
      <StoreFolderSidebarGroup activeId={undefined} onOpen={onStore} />
      {auth.data?.isAdmin ? <SystemFolderSidebarGroup active={null} onOpen={(root) => onSystem({ root, path: '' })} /> : null}
    </SidebarNav>
  )

  let list
  if (project.isError) list = <ErrorState title={t({ ko: '프로젝트를 열지 못했어.', en: 'Could not open the project.' })} error={project.error} onRetry={() => void project.refetch()} />
  else if (searching) {
    if (results.isPending) list = <LoadingState />
    else if (results.isError) list = <ErrorState title={t({ ko: '검색하지 못했어.', en: 'Search failed.' })} error={results.error} onRetry={() => void results.refetch()} />
    else list = (
      <div>
        {hits.length === 0 && !results.hasNextPage ? <EmptyState icon={Search} title={t({ ko: '찾은 문서가 없어', en: 'No matching documents' })} /> : null}
        {hits.map((hit) => (
          <ListRow key={hit.target} asChild interactive size="lg" leading={hit.kind === 'folder' ? <Folder className="size-4 text-warning" /> : <FileText className="size-4 text-muted-foreground" />}>
            <button type="button" onClick={() => (hit.kind === 'folder' ? openFolder(hit.target) : openDocument(hit))}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold"><HighlightText text={baseName(hit.target)} terms={searchQuery} /></span>
                  {parentOf(hit.target) ? <span className="truncate text-xs text-muted-foreground">{parentOf(hit.target)}</span> : null}
                </span>
                {hit.excerpt ? <span className="line-clamp-2 break-all text-xs leading-relaxed text-muted-foreground"><HighlightText text={hit.excerpt.replace(/\s+/g, ' ')} terms={searchQuery} /></span> : null}
              </span>
            </button>
          </ListRow>
        ))}
        {results.hasNextPage ? <Button variant="ghost" size="sm" className="mt-2 w-full" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>{t({ ko: '더 찾기', en: 'Search further' })}</Button> : null}
      </div>
    )
  } else if (entries.isPending) list = <LoadingState />
  else if (entries.isError) list = <ErrorState title={t({ ko: '파일을 불러오지 못했어.', en: 'Could not load files.' })} error={entries.error} onRetry={() => void entries.refetch()} />
  else if (shown.length === 0) list = <EmptyState icon={FolderKanban} title={t({ ko: '빈 폴더야', en: 'This folder is empty' })} />
  else list = (
    <FileEntryView
      items={shown.map(toItem)}
      mode={viewMode}
      selected={selected}
      onToggle={toggle}
      onSelectAll={(checked) => setSelected(checked ? shown.map((entry) => entry.target) : [])}
      menu={(item) => rowMenu(byTarget.get(item.id)!)}
      formatSize={formatFileSize}
      draggable={canWrite && !busy}
      onDragStart={(item, event) => {
        startMoveDrag(event, DRAG_TYPE, selected.includes(item.id) ? selection.map((entry) => entry.target) : [item.id])
      }}
      onFolderDragOver={dragOver}
      onFolderDrop={(item, event) => drop(event, item.id)}
      onOpen={(item) => {
        if (item.folder) openFolder(item.id)
        else if (viewMode === 'grid' && selected.length > 0) toggle(item.id, !selected.includes(item.id))
        else openDocument(byTarget.get(item.id)!)
      }}
    />
  )

  return (
    <>
      <PageWithSidebar storageKey="files" sidebarLabel={t({ ko: '파일 보관함', en: 'Files' })} sidebar={sidebar} toolbar={<PageToolbar sticky start={searchOpen ? searchField : breadcrumbs} actions={actions} />}>
        <div className="min-h-72 space-y-3" onDragOver={dragOver} onDrop={(event) => drop(event, dir)}>
          <input ref={uploadInput} type="file" multiple accept=".md,.markdown,.txt,.json,.csv,.yaml,.yml,.xml,.html,.css,.js,.ts" className="hidden" aria-label={t({ ko: '텍스트 문서 가져오기', en: 'Import text documents' })} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; importFiles(files) }} />
          {list}
          {searching ? null : (
            <ListPager
              hasPrevious={offset > 0}
              hasNext={entries.data?.nextOffset != null}
              onPrevious={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setSelected([]) }}
              onNext={() => { setOffset(entries.data!.nextOffset!); setSelected([]) }}
            />
          )}
        </div>
      </PageWithSidebar>

      <SelectionActionBar
        selectedCount={selection.length}
        onClear={() => setSelected([])}
        responsiveActions
        actions={canWrite ? (
          <>
            <SelectionBarAction icon={Pencil} label={t({ ko: '이름 변경', en: 'Rename' })} disabled={selection.length !== 1 || busy} onClick={() => setNameDialog({ target: selection[0].target, name: baseName(selection[0].target) })} />
            <SelectionBarAction icon={FolderInput} label={t({ ko: '이동', en: 'Move' })} disabled={busy} onClick={() => { setMoveTarget(dir); setMoveOpen(true) }} />
            {canDelete ? <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} variant="destructive" disabled={busy} onClick={() => void remove(selection.map((entry) => entry.target))} /> : null}
          </>
        ) : null}
      />

      <NameDialog
        open={nameDialog !== null}
        title={nameDialog?.target ? t({ ko: '이름 변경', en: 'Rename' }) : t({ ko: '새 폴더', en: 'New folder' })}
        value={nameDialog?.name ?? ''}
        onChange={(name) => setNameDialog((current) => (current ? { ...current, name } : null))}
        onSubmit={() => { if (nameDialog) { if (nameDialog.target) rename(nameDialog.target, nameDialog.name); else createFolder(nameDialog.name) } }}
        onClose={() => setNameDialog(null)}
        busy={busy}
      />
      <MoveDialog
        open={moveOpen}
        value={moveTarget}
        onChange={setMoveTarget}
        folders={(folders.data ?? []).map((target) => ({ value: target, label: `/${target}`, disabled: selected.some((source) => target === source || target.startsWith(`${source}/`)) }))}
        rootLabel={projectName}
        onSubmit={() => moveTo(selection.map((entry) => entry.target), moveTarget)}
        onClose={() => setMoveOpen(false)}
        busy={busy}
      />
      <WorkspaceProjectDialog open={projectOpen} project={project.data ?? null} canEdit={canWrite} onClose={() => setProjectOpen(false)} onSaved={(saved: WorkspaceProject) => { setProjectOpen(false); queryClient.setQueryData(['workspaces', projectId, 'info'], saved) }} />
      <WorkspaceChangesDialog open={changesOpen} projectId={projectId} onClose={() => setChangesOpen(false)} />
      {editor ? <TextDocumentEditor key={editor.entry?.id ?? 'new'} entry={editor.entry} store={store} chatPage={chatPage} onClose={() => setEditor(null)} /> : null}
    </>
  )
}

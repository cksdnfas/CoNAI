import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useNavigate } from 'react-router-dom'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, Download, FilePlus, Folder, FolderInput, FolderPlus, LayoutGrid, List, Pencil, Puzzle, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import type { FileSearchStatus, StoredFileEntry, StoredFileSearchHit } from '@conai/shared'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { ListPager } from '@/components/common/list-pager'
import { PathBreadcrumbs } from '@/components/common/path-breadcrumbs'
import { MoveDialog, NameDialog } from '@/components/common/entry-dialogs'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { SidebarNav } from '@/components/ui/sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SendToAudioDialog, useCanSendToAudio } from '@/features/audio/send-to-audio-dialog'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPageDataPermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, MAX_TEXT_DOCUMENT_BYTES, TEXT_FILE_PATTERN, createStoredFolder, deleteStoredFiles, listStoredFileRevisions, listStoredFiles, moveStoredFiles, renameStoredFile, restoreStoredFileRevision, searchStoredFiles, retryStoredFileIndex, storedFileDownloadUrl, storedFileThumbnailUrl, uploadStoredFiles } from '@/lib/api-files'
import { formatFileSize } from '@/lib/format-size'
import { getErrorMessage } from '@/lib/error-message'
import { FilePreview } from './file-preview'
import { FileEntryIcon as EntryIcon, fileMediaKind as mediaKind } from './file-preview-shared'
import { FileTextEditor } from './file-text-editor'
import { FileEntryView, type EntryItem } from './file-entry-views'
import { WorkspaceSidebarGroup } from './workspace-projects'
import { StoreFolderSidebarGroup, useStoreFolders } from './store-folders'
import { useFileViewMode, type FileViewMode } from './file-view-mode'
import { SystemFolderBrowser, SystemFolderSidebarGroup, type SystemFolderLocation } from './system-folder-browser'
import { HighlightText } from '@/components/common/highlight-text'
import { fileExtension } from '@/lib/file-extension'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { droppedIds, isMoveDrag, startMoveDrag } from './file-drag'

const FILE_DRAG_TYPE = 'application/x-conai-file-ids'
const PAGE_SIZE = 100
type NameDialog = { id?: string; name: string } | null

/** A stored item's grid face: image and video files show a thumbnail, everything else a type icon with its extension. */
function StoredFileFace({ entry }: { entry: StoredFileEntry }) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const { canViewImages } = useImagePermissions()
  const showThumb = canViewImages && entry.kind === 'file' && ['image', 'video'].includes(mediaKind(entry)) && entry.mimeType !== 'image/svg+xml' && !thumbFailed
  const extension = entry.kind === 'file' ? fileExtension(entry.name) : null
  if (showThumb) return <img src={storedFileThumbnailUrl(entry.id)} alt="" loading="lazy" draggable={false} onError={() => setThumbFailed(true)} className="size-full object-cover" />
  return (
    <span className="flex flex-col items-center gap-1">
      <EntryIcon entry={entry} className="size-9" />
      {extension ? <span className="text-2xs font-semibold tracking-wide text-muted-foreground">{extension}</span> : null}
    </span>
  )
}

/** Search results in place of the folder list: name, folder path and the text around the match. */
function SearchHits({ hits, terms, truncated, search, onOpen, onRetry, retrying }: { onRetry: (id: string) => void; retrying: boolean; search?: FileSearchStatus; hits: StoredFileSearchHit[]; terms: string[]; truncated: boolean; onOpen: (entry: StoredFileEntry) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {truncated ? t({ ko: '결과 {count}개 이상', en: '{count}+ results' }, { count: hits.length }) : t({ ko: '결과 {count}개', en: '{count} results' }, { count: hits.length })}
      </p>
      {search ? <p className="text-xs text-muted-foreground" role="status">
        {search.mode === 'hybrid' ? t({ ko: '키워드 + 의미 검색', en: 'Keyword + semantic search' }) : t({ ko: '키워드 검색', en: 'Keyword search' })}
        {search.semantic === 'disabled' ? ` · ${t({ ko: '의미 검색 꺼짐', en: 'Semantic search is off' })}` : null}
        {search.semantic === 'unavailable' ? ` · ${t({ ko: '의미 검색이 응답하지 않아 키워드 결과만 표시', en: 'Semantic search unavailable; showing keyword matches' })}` : null}
        {['partial', 'not_indexed'].includes(search.semantic) ? ` · ${t({ ko: '의미 색인 {done}/{total}개', en: 'Semantic index: {done}/{total} files' }, { done: search.indexedFiles, total: search.searchableFiles })}` : null}
        {search.pendingDocuments > 0 ? ` · ${t({ ko: '본문 추출 대기 {count}개', en: '{count} documents awaiting extraction' }, { count: search.pendingDocuments })}` : null}
        {search.partialDocuments + search.failedDocuments > 0 ? ` · ${t({ ko: '본문 추출이 불완전한 파일 {count}개', en: '{count} files with incomplete text extraction' }, { count: search.partialDocuments + search.failedDocuments })}` : null}
        {search.keywordTermsLimited ? ` · ${t({ ko: '긴 문장은 의미 검색에 전체를 사용하고 키워드 검색에는 앞 8개 검색어를 사용', en: 'Full sentence used for semantic search; first 8 terms used for keyword search' })}` : null}
        {search.unsupportedFiles > 0 ? ` · ${t({ ko: '파일명만 검색하는 파일 {count}개', en: '{count} files searchable by name only' }, { count: search.unsupportedFiles })}` : null}
      </p> : null}
      <ul className="divide-y divide-line">
        {hits.map(({ entry, path, snippet, location, extractionState }) => (
          <li key={entry.id}>
            <ListRow asChild interactive size="lg">
              <button type="button" onClick={() => onOpen(entry)}>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <EntryIcon entry={entry} />
                    <span className="min-w-0 truncate text-sm text-foreground"><HighlightText text={entry.name} terms={terms} /></span>
                    <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{path}</span>
                  </span>
                  {location ? <span className="pl-6 text-xs text-muted-foreground">{location}</span> : null}
                  {extractionState && ['partial', 'empty', 'error', 'unsupported'].includes(extractionState) ? <span className="pl-6 text-xs text-muted-foreground">{t({ ko: '본문 전체를 검색하지 못한 파일', en: 'Full content was not searched' })}</span> : null}
                  {snippet ? <span className="line-clamp-2 break-all pl-6 text-xs leading-relaxed text-muted-foreground"><HighlightText text={snippet} terms={terms} /></span> : null}
                </span>
              </button>
            </ListRow>
            {extractionState && ['partial', 'empty', 'error'].includes(extractionState) ? <Button size="sm" variant="ghost" disabled={retrying} onClick={() => onRetry(entry.id)}>{t({ ko: '다시 추출', en: 'Retry extraction' })}</Button> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Shared file store, also used as a file/folder picker. */
export function FileBrowser({ parentId, onNavigate, onPick, pickLabel, onPickFolder, pickFolderLabel, accept, system = null, onSystemNavigate, workspaces }: {
  /** The files page: project workspaces as the first sidebar group. */
  workspaces?: { onOpen: (id: string) => void; onCreate?: () => void }
  parentId: string | null
  onNavigate: (id: string | null) => void
  onPick?: (files: StoredFileEntry[]) => void
  /** Picker: also choose the open folder itself (not the top). */
  onPickFolder?: () => void
  pickFolderLabel?: string
  /** Picker: the confirm button's text for `count` chosen files (default: attach). */
  pickLabel?: (count: number) => string
  /** Picker: only files with these extensions (lowercase, with the dot) can be chosen. */
  accept?: readonly string[]
  /** Server folder shown instead of the store (administrators); null shows the store. */
  system?: SystemFolderLocation | null
  /** With it, administrators get the "서버 폴더" sidebar group. */
  onSystemNavigate?: (location: SystemFolderLocation) => void
}) {
  const { t, formatDateTime } = useI18n()
  const navigateToExtension = useNavigate()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const auth = useAuthStatusQuery()
  const permissions = useMemo(() => auth.data?.permissionKeys ?? [], [auth.data?.permissionKeys])
  const isPicker = onPick !== undefined
  const chatCanReadFiles = useChatPageDataPermissions().canReadFiles
  const canViewFiles = permissions.includes('files.view')
  const canUpload = canViewFiles && permissions.includes('files.edit')
  const canOrganize = permissions.includes('files.edit')
  const canDelete = permissions.includes('files.delete')
  // Restricted file types require administrator access.
  const canUploadAny = auth.data?.isAdmin === true || auth.data?.hasCredentials === false
  const canBrowseSystem = !isPicker && onSystemNavigate !== undefined && auth.data?.isAdmin === true
  const browsingSystem = canBrowseSystem && system !== null
  const accountKey = auth.data?.accountId ?? (auth.data?.hasCredentials ? 'anonymous' : 'bootstrap')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [preview, setPreview] = useState<StoredFileEntry | null>(null)
  /** The document editor: `entry` null writes a new document in this folder. */
  const [editor, setEditor] = useState<{ entry: StoredFileEntry | null } | null>(null)
  const [audioSend, setAudioSend] = useState<StoredFileEntry[] | null>(null)
  const canSendAudio = useCanSendToAudio()
  const [viewMode, changeViewMode] = useFileViewMode()
  const uploadInput = useRef<HTMLInputElement>(null)
  // Search replaces the folder list while open; the request waits for typing to pause.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const searchQuery = useDebouncedValue(searchInput.trim())
  const canSearch = !isPicker
  const searching = canSearch && searchOpen && searchQuery !== ''
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'list', parentId, offset], queryFn: ({ signal }) => listStoredFiles(parentId, offset, signal), enabled: canViewFiles && !browsingSystem })
  const { folders } = useStoreFolders(canViewFiles)
  const searchResults = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'search', searchQuery], queryFn: ({ signal }) => searchStoredFiles(searchQuery, signal), enabled: canViewFiles && searching })
  const retryExtraction = useMutation({
    mutationFn: (id: string) => retryStoredFileIndex(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY }) },
    onError: (error: unknown) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '본문을 다시 추출하지 못했어.', en: 'Could not retry extraction.' })) }),
  })
  const entries = query.data?.entries ?? []
  const rootLabel = t({ ko: '공용 파일', en: 'Shared files' })
  // The picker attaches files only; folders are for navigating.
  const selectable = isPicker ? entries.filter((entry) => entry.kind === 'file') : entries
  const selection = entries.filter((entry) => selected.includes(entry.id))
  const audioSelection = selection.length > 0 && selection.every((entry) => entry.kind === 'file' && mediaKind(entry) === 'audio')
  const refresh = () => queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY })
  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setSelected([])
      setNameDialog(null)
      setMoveOpen(false)
      await refresh()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '파일 작업에 실패했어.', en: 'File operation failed.' })) }),
  })
  const busy = mutation.isPending
  const chatPage = !isPicker && chatCanReadFiles && !browsingSystem
  // The previewed text file's earlier versions, so the connected chat can put one back (a review card).
  const previewVersioned = chatPage && preview !== null && preview.kind === 'file' && TEXT_FILE_PATTERN.test(preview.name)
  const versionsQuery = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'revisions', preview?.id, preview?.updatedAt], queryFn: () => listStoredFileRevisions(preview!.id), enabled: previewVersioned })
  const versions = previewVersioned ? versionsQuery.data?.revisions ?? [] : []
  const editableDocuments = entries.filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name) && entry.size <= MAX_TEXT_DOCUMENT_BYTES)
  const saveName = (dialog: NonNullable<NameDialog>) => mutation.mutateAsync(() => (dialog.id ? renameStoredFile(dialog.id, dialog.name) : createStoredFolder(parentId, dialog.name)))
  const writerName = (source: { via?: string; profileName?: string } | null) => (source ? [source.via, source.profileName].filter(Boolean).join(' · ') : null)

  useChatPageRegistration(chatPage ? {
    kind: 'files', title: t({ ko: '파일 보관함', en: 'File store' }), resourceId: `shared:${parentId ?? 'root'}`, localRevision: JSON.stringify([selected, preview?.id, nameDialog, moveOpen, searchOpen, searchInput]),
    fields: [
      { id: 'viewMode', label: t({ ko: '목록 표시', en: 'List view' }), type: 'select', value: viewMode, options: ['grid', 'list'] },
      { id: 'search', label: t({ ko: '파일 검색어 (이름·내용, 빈 값은 검색 닫기)', en: 'File search (name or text; empty closes search)' }), type: 'text', value: searchOpen ? searchInput : '' },
      ...(nameDialog ? [{ id: 'name', label: t({ ko: '폴더·파일 이름 입력', en: 'Folder or file name draft' }), type: 'text' as const, value: nameDialog.name }] : []),
      ...(moveOpen ? [{ id: 'moveTarget', label: t({ ko: '이동할 폴더 (빈 값은 최상위)', en: 'Destination folder (empty means root)' }), type: 'select' as const, value: moveTarget, options: ['', ...folders.filter((entry) => !selected.includes(entry.folder.id)).map((entry) => entry.folder.id)].slice(0, 100) }] : []),
    ],
    data: {
      files: entries.slice(0, 512).map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind, mimeType: entry.mimeType, bytes: entry.size })), selected: selection.map((entry) => ({ id: entry.id, name: entry.name })), total: query.data?.total ?? 0, offset,
      ...(preview ? { previewing: preview.id } : {}),
      // Names and writers of the previewed file's versions only: their text stays out (open the document to read it).
      ...(versions.length ? { previewVersions: versions.slice(0, 30).map((version) => ({ id: version.id, at: version.replacedAt, by: writerName(version.replacedBy) })) } : {}),
    },
    apply: (patch) => { if (patch.viewMode !== undefined) changeViewMode(patch.viewMode as FileViewMode); if (patch.search !== undefined) { setSearchInput(String(patch.search)); setSearchOpen(String(patch.search).trim() !== '') } if (patch.name !== undefined) setNameDialog((old) => old ? { ...old, name: String(patch.name) } : old); if (patch.moveTarget !== undefined) setMoveTarget(String(patch.moveTarget)) },
    actions: [
      pageAction('files.open', t({ ko: '폴더 열기', en: 'Open folder' }), t({ ko: '목록(data.files)의 폴더나 최상위(root)를 열어.', en: 'Open a listed folder or the top level (root).' }), pageObject({ id: pageChoice(['root', ...entries.filter((entry) => entry.kind === 'folder').slice(0, 200).map((entry) => entry.id)]) }, ['id'])),
      ...(entries.some((entry) => entry.kind !== 'folder') ? [pageAction('files.preview', t({ ko: '파일 미리보기', en: 'Preview file' }), t({ ko: '목록의 파일 미리보기를 열어.', en: 'Open a listed file preview.' }), pageObject({ id: pageChoice(entries.filter((entry) => entry.kind !== 'folder').slice(0, 300).map((entry) => entry.id)) }, ['id']))] : []),
      ...(entries.length ? [pageAction('files.select', t({ ko: '항목 선택', en: 'Select items' }), t({ ko: '빈 배열은 선택 해제', en: 'empty clears' }), pageObject({ ids: pageArray(pageText(32), 200) }, ['ids']))] : []),
      ...(canOrganize ? [
        pageAction('files.new_folder', t({ ko: '새 폴더 창 열기', en: 'Open new folder dialog' }), t({ ko: 'name을 채우고 files.name_save', en: 'fill name, then files.name_save' })),
        ...(entries.length ? [pageAction('files.rename', t({ ko: '이름 변경 창 열기', en: 'Open rename dialog' }), t({ ko: 'name을 채우고 files.name_save', en: 'fill name, then files.name_save' }), pageObject({ id: pageText(32) }, ['id']))] : []),
        ...(nameDialog && nameDialog.name.trim() ? [pageAction('files.name_save', nameDialog.id ? t({ ko: '이름 바꾸기', en: 'Rename' }) : t({ ko: '폴더 만들기', en: 'Create folder' }), '', undefined, 'save')] : []),
        ...(selection.length ? [pageAction('files.move', t({ ko: '이동 창 열기', en: 'Open move dialog' }), t({ ko: 'moveTarget을 고르고 files.move_save', en: 'pick moveTarget, then files.move_save' }))] : []),
        ...(moveOpen && selection.length ? [pageAction('files.move_save', t({ ko: '선택 항목 이동', en: 'Move selection' }), '', undefined, 'save')] : []),
      ] : []),
      ...(canDelete && selection.length ? [pageAction('files.delete', t({ ko: '선택 항목 삭제', en: 'Delete selection' }), '', undefined, 'save')] : []),
      ...(canUpload ? [pageAction('files.new_document', t({ ko: '새 문서 쓰기', en: 'New document' }), '')] : []),
      ...(canUpload && editableDocuments.length ? [pageAction('files.edit_document', t({ ko: '텍스트 문서 열기', en: 'Open text document' }), t({ ko: '열린 문서만 읽고 고칠 수 있어', en: 'only an open document can be read and edited' }), pageObject({ id: pageText(32) }, ['id']))] : []),
      ...(canOrganize && versions.length ? [pageAction('files.restore_version', t({ ko: '이전 버전 되돌리기', en: 'Restore earlier version' }), t({ ko: 'data.previewVersions의 id', en: 'an id in data.previewVersions' }), pageObject({ versionId: pageText(32) }, ['versionId']), 'save')] : []),
    ],
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'files.open') { navigate(args.id === 'root' ? null : String(args.id)); return }
      if (id === 'files.select') { setSelected((Array.isArray(args.ids) ? args.ids : []).map(String).filter((value) => entries.some((entry) => entry.id === value))); return }
      if (id === 'files.new_folder') { setNameDialog({ name: '' }); return }
      if (id === 'files.name_save' && nameDialog) { await saveName(nameDialog); return }
      if (id === 'files.move') { setMoveTarget(parentId ?? ''); setMoveOpen(true); return }
      if (id === 'files.move_save') { await mutation.mutateAsync(() => moveStoredFiles(selected, moveTarget || null)); return }
      if (id === 'files.delete') { await mutation.mutateAsync(() => deleteStoredFiles(selected)); return }
      if (id === 'files.new_document') { setEditor({ entry: null }); return }
      if (id === 'files.restore_version' && preview) {
        if (!versions.some((version) => version.id === args.versionId)) throw new Error('그 버전을 찾을 수 없어.')
        const saved = await restoreStoredFileRevision(preview.id, String(args.versionId))
        await refresh()
        setPreview(saved)
        return
      }
      const entry = entries.find((item) => item.id === String(args.id))
      if (!entry) throw new Error('보관함에 없는 파일이야.')
      if (id === 'files.preview') setPreview(entry)
      else if (id === 'files.rename') setNameDialog({ id: entry.id, name: entry.name })
      else if (id === 'files.edit_document' && editableDocuments.includes(entry)) { setPreview(null); setEditor({ entry }) }
      else throw new Error('보관함에 없는 작업이야.')
    },
  } : null)

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchInput('')
  }
  const navigate = (id: string | null) => {
    closeSearch()
    setSelected([])
    setOffset(0)
    onNavigate(id)
  }
  const toggle = (id: string, checked: boolean) => setSelected((current) => (checked ? [...current, id] : current.filter((entry) => entry !== id)))
  const upload = (files: File[], target: string | null = parentId) => {
    if (canUpload && !busy && files.length) mutation.mutate(() => uploadStoredFiles(target, files, { allowAnyType: canUploadAny }))
  }
  const drop = (event: DragEvent, target: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    const dragged = droppedIds(event, FILE_DRAG_TYPE)
    if (dragged) {
      // A folder dropped onto itself stays put; the server refuses moves into its own subfolders.
      const ids = dragged.filter((id) => id !== target)
      if (canOrganize && ids.length) mutation.mutate(() => moveStoredFiles(ids, target))
    } else if (event.dataTransfer.files.length) {
      upload(Array.from(event.dataTransfer.files), target)
    }
  }
  const dragOver = (event: DragEvent) => {
    if (busy) return
    const moving = isMoveDrag(event, FILE_DRAG_TYPE)
    if (moving ? !canOrganize : !canUpload) return
    event.preventDefault()
    event.dataTransfer.dropEffect = moving ? 'move' : 'copy'
  }
  const remove = async (ids: string[] = selected) => {
    const confirmed = await confirm({
      title: t({ ko: '선택한 항목을 삭제할까?', en: 'Delete selected items?' }),
      description: t({ ko: '원본 파일이 삭제돼. 빈 폴더만 삭제할 수 있고, 채팅에서 참조 중인 파일은 보호돼.', en: 'Original files will be deleted. Folders must be empty; files attached to chats are protected.' }),
      tone: 'destructive',
    })
    if (confirmed) mutation.mutate(() => deleteStoredFiles(ids))
  }
  const download = (entry: StoredFileEntry) => {
    const link = document.createElement('a')
    link.href = storedFileDownloadUrl(entry.id)
    link.download = ''
    link.click()
  }
  /** One row's actions, for its ⋯ button and its right-click / long-press menu. */
  const rowEntries = (entry: StoredFileEntry): ActionMenuEntry[] => [
    entry.kind === 'file' && canSendAudio && mediaKind(entry) === 'audio' && { key: 'audio', label: t({ ko: '오디오로 보내기', en: 'Send to Audio' }), icon: AudioLines, onSelect: () => setAudioSend([entry]) },
    entry.kind === 'file' && { key: 'download', label: t({ ko: '다운로드', en: 'Download' }), icon: Download, onSelect: () => download(entry) },
    '-',
    canOrganize && { key: 'rename', label: t({ ko: '이름 변경', en: 'Rename' }), icon: Pencil, disabled: busy, onSelect: () => setNameDialog({ id: entry.id, name: entry.name }) },
    canOrganize && { key: 'move', label: t({ ko: '이동', en: 'Move' }), icon: FolderInput, disabled: busy, onSelect: () => { setSelected([entry.id]); setMoveTarget(parentId ?? ''); setMoveOpen(true) } },
    '-',
    canDelete && { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy, onSelect: () => void remove([entry.id]) },
  ]

  const actions = (
    <>
      {!isPicker && !browsingSystem ? <IconButton variant="ghost" label={t({ ko: '플러그인으로 열기', en: 'Open with plugin' })} disabled={busy || selected.length > 20 || selection.some((entry) => entry.kind !== 'file')} onClick={() => navigateToExtension(`/extensions${selected.length ? `?files=${encodeURIComponent(selected.join(','))}` : ''}`)}><Puzzle /></IconButton> : null}
      <SegmentedControl
        size="xs"
        value={viewMode}
        onChange={(value) => changeViewMode(value === 'list' ? 'list' : 'grid')}
        ariaLabel={t({ ko: '보기', en: 'View' })}
        items={[
          { value: 'grid', label: <LayoutGrid className="size-3.5" />, ariaLabel: t({ ko: '아이콘 보기', en: 'Icons' }) },
          { value: 'list', label: <List className="size-3.5" />, ariaLabel: t({ ko: '자세히 보기', en: 'Details' }) },
        ]}
      />
      {canSearch && !searchOpen ? (
        <IconButton variant="ghost" label={t({ ko: '검색', en: 'Search' })} onClick={() => setSearchOpen(true)}>
          <Search />
        </IconButton>
      ) : null}
      {canOrganize ? (
        <IconButton variant="ghost" label={t({ ko: '새 폴더', en: 'New folder' })} disabled={busy} onClick={() => setNameDialog({ name: '' })}>
          <FolderPlus />
        </IconButton>
      ) : null}
      {canUpload ? (
        <IconButton variant="ghost" label={t({ ko: '파일 업로드', en: 'Upload files' })} disabled={busy} onClick={() => uploadInput.current?.click()}>
          <Upload />
        </IconButton>
      ) : null}
      <ActionMenuButton
        size="icon"
        label={t({ ko: '더 보기', en: 'More' })}
        entries={[
          canUpload && !isPicker && { key: 'new-document', label: t({ ko: '새 문서', en: 'New document' }), icon: FilePlus, disabled: busy, onSelect: () => setEditor({ entry: null }) },
          { key: 'refresh', label: t({ ko: '새로고침', en: 'Refresh' }), icon: RefreshCw, disabled: busy, onSelect: () => void refresh() },
        ]}
      />
    </>
  )

  const breadcrumbs = (
    <PathBreadcrumbs
      ariaLabel={t({ ko: '현재 경로', en: 'Current path' })}
      items={[{ key: 'root', label: rootLabel, onClick: () => navigate(null) }, ...(query.data?.breadcrumbs ?? []).map((folder) => ({ key: folder.id, label: folder.name, onClick: () => navigate(folder.id) }))]}
    />
  )

  const searchField = (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <Input
        autoFocus
        variant="settings"
        className="min-w-0 flex-1"
        aria-label={t({ ko: '파일 이름이나 내용 검색', en: 'Search file names and text' })}
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') closeSearch() }}
      />
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '검색 닫기', en: 'Close search' })} onClick={closeSearch}>
        <X />
      </IconButton>
    </div>
  )

  const sidebar = (
    <SidebarNav aria-label={t({ ko: '폴더', en: 'Folders' })}>
      {workspaces && canViewFiles ? <WorkspaceSidebarGroup activeId={null} onOpen={workspaces.onOpen} onCreate={workspaces.onCreate} /> : null}
      <StoreFolderSidebarGroup labelled={workspaces !== undefined} activeId={browsingSystem ? undefined : parentId} onOpen={navigate} onDragOver={dragOver} onDrop={drop} />
      {canBrowseSystem ? <SystemFolderSidebarGroup active={browsingSystem ? system.root : null} onOpen={(root) => onSystemNavigate({ root, path: '' })} /> : null}
    </SidebarNav>
  )

  if (browsingSystem) {
    return <SystemFolderBrowser key={`${system.root}:${system.path}`} location={system} onNavigate={onSystemNavigate} sidebar={sidebar} />
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const toItem = (entry: StoredFileEntry): EntryItem => ({
    id: entry.id, name: entry.name, folder: entry.kind === 'folder', size: entry.size, modified: formatDateTime(entry.updatedAt),
    icon: <EntryIcon entry={entry} />, face: <StoredFileFace entry={entry} />,
  })
  let list
  if (searching) {
    if (searchResults.isPending) list = <LoadingState />
    else if (searchResults.isError) list = <ErrorState title={t({ ko: '검색하지 못했어.', en: 'Search failed.' })} error={searchResults.error} onRetry={() => void searchResults.refetch()} />
    else if (searchResults.data.hits.length === 0) list = <EmptyState icon={Search} title={t({ ko: '찾은 파일이 없어', en: 'No matching files' })} />
    else list = <SearchHits hits={searchResults.data.hits} terms={searchResults.data.terms} truncated={searchResults.data.truncated} search={searchResults.data.search} onRetry={(id) => retryExtraction.mutate(id)} retrying={retryExtraction.isPending} onOpen={(entry) => (entry.kind === 'folder' ? navigate(entry.id) : setPreview(entry))} />
  } else if (query.isPending) {
    list = <LoadingState />
  } else if (query.isError) {
    list = <ErrorState title={t({ ko: '파일을 불러오지 못했어.', en: 'Could not load files.' })} error={query.error} onRetry={() => void query.refetch()} />
  } else if (entries.length === 0) {
    list = <EmptyState icon={Folder} title={t({ ko: '빈 폴더야', en: 'This folder is empty' })} />
  } else {
    list = (
      <FileEntryView
        items={entries.map(toItem)}
        mode={viewMode}
        compact={isPicker}
        selected={selected}
        onToggle={toggle}
        onSelectAll={(checked) => setSelected(checked ? selectable.map((entry) => entry.id) : [])}
        canSelect={(item) => !isPicker || !item.folder}
        menu={isPicker ? undefined : (item) => rowEntries(byId.get(item.id)!)}
        formatSize={formatFileSize}
        draggable={canOrganize && !busy && !isPicker}
        onDragStart={(item, event) => {
          startMoveDrag(event, FILE_DRAG_TYPE, selected.includes(item.id) ? selected : [item.id])
        }}
        onFolderDragOver={dragOver}
        onFolderDrop={(item, event) => drop(event, item.id)}
        onOpen={(item) => {
          const entry = byId.get(item.id)!
          if (entry.kind === 'folder') navigate(entry.id)
          else if (isPicker || (viewMode === 'grid' && selected.length > 0)) toggle(entry.id, !selected.includes(entry.id))
          else setPreview(entry)
        }}
      />
    )
  }

  const pager = !searching && query.data ? (
    <ListPager
      hasPrevious={offset > 0}
      hasNext={offset + query.data.limit < query.data.total}
      onPrevious={() => { setOffset((value) => Math.max(0, value - PAGE_SIZE)); setSelected([]) }}
      onNext={() => { setOffset((value) => value + PAGE_SIZE); setSelected([]) }}
    />
  ) : null

  const body = (
    <div className="min-h-72 space-y-3" onDragOver={dragOver} onDrop={(event) => drop(event, parentId)}>
      <input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { upload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      {list}
      {pager}
    </div>
  )

  const pickedFiles = selection.filter((entry) => entry.kind === 'file' && (!accept || accept.some((extension) => entry.name.toLowerCase().endsWith(extension))))

  return (
    <>
      {isPicker ? (
        <>
          <ModalBody spacing="sm">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">{breadcrumbs}</div>
              {actions}
            </div>
            {body}
          </ModalBody>
          <ModalFooter>
            <span className="flex-1" />
            {onPickFolder ? (
              <Button variant="secondary" disabled={parentId === null || busy} onClick={onPickFolder}>{pickFolderLabel ?? t({ ko: '이 폴더 선택', en: 'Choose this folder' })}</Button>
            ) : null}
            <Button disabled={pickedFiles.length === 0 || busy} onClick={() => onPick(pickedFiles)}>
              {pickLabel
                ? pickLabel(pickedFiles.length)
                : pickedFiles.length > 0
                  ? t({ ko: '{count}개 첨부', en: 'Attach {count}' }, { count: pickedFiles.length })
                  : t({ ko: '첨부', en: 'Attach' })}
            </Button>
          </ModalFooter>
        </>
      ) : (
        <PageWithSidebar
          storageKey="files"
          sidebarLabel={t({ ko: '파일 보관함', en: 'Files' })}
          sidebar={sidebar}
          toolbar={<PageToolbar sticky start={canSearch && searchOpen ? searchField : breadcrumbs} actions={actions} />}
        >
          {body}
        </PageWithSidebar>
      )}

      {isPicker ? null : (
        <SelectionActionBar
          selectedCount={selected.length}
          onClear={() => setSelected([])}
          responsiveActions
          actions={canOrganize || canDelete || (canSendAudio && audioSelection) ? (
            <>
              {canSendAudio && audioSelection ? <SelectionBarAction icon={AudioLines} label={t({ ko: '오디오로 보내기', en: 'Send to Audio' })} disabled={busy} onClick={() => setAudioSend(selection)} /> : null}
              {canOrganize ? <SelectionBarAction icon={Pencil} label={t({ ko: '이름 변경', en: 'Rename' })} disabled={selection.length !== 1 || busy} onClick={() => setNameDialog({ id: selection[0].id, name: selection[0].name })} /> : null}
              {canOrganize ? <SelectionBarAction icon={FolderInput} label={t({ ko: '이동', en: 'Move' })} disabled={busy} onClick={() => { setMoveTarget(parentId ?? ''); setMoveOpen(true) }} /> : null}
              {canDelete ? <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} variant="destructive" disabled={busy} onClick={() => void remove()} /> : null}
            </>
          ) : null}
        />
      )}

      <NameDialog
        open={nameDialog !== null}
        title={nameDialog?.id ? t({ ko: '이름 변경', en: 'Rename' }) : t({ ko: '새 폴더', en: 'New folder' })}
        value={nameDialog?.name ?? ''}
        onChange={(name) => setNameDialog((current) => (current ? { ...current, name } : null))}
        onSubmit={() => { if (nameDialog) void saveName(nameDialog).catch(() => undefined) }}
        onClose={() => setNameDialog(null)}
        busy={busy}
      />

      <MoveDialog
        open={moveOpen}
        value={moveTarget}
        onChange={setMoveTarget}
        folders={folders.map(({ folder, path }) => ({ value: folder.id, label: path, disabled: selected.includes(folder.id) }))}
        rootLabel={rootLabel}
        onSubmit={() => mutation.mutate(() => moveStoredFiles(selected, moveTarget || null))}
        onClose={() => setMoveOpen(false)}
        busy={busy}
      />

      <SendToAudioDialog files={audioSend} onClose={() => setAudioSend(null)} />
      {preview ? <FilePreview entry={preview} onClose={() => setPreview(null)} onNavigate={setPreview} onEdit={canUpload ? (entry) => { setPreview(null); setEditor({ entry }) } : undefined} /> : null}
      {editor ? (
        <FileTextEditor
          key={editor.entry?.id ?? 'new'}
          chatPage={chatPage}
          entry={editor.entry}
          parentId={parentId}

          // An edit opened from the preview returns to it, showing the saved text.
          onClose={(saved) => { const { entry } = editor; setEditor(null); if (entry) setPreview(saved ?? entry) }}
        />
      ) : null}
    </>
  )
}

/** Choose stored files to attach (chat). */
export function FilePicker({ onClose, onPick, onPickFolder, pickFolderLabel, title, pickLabel, accept, initialParentId = null }: {
  onClose: () => void
  onPick: (entries: StoredFileEntry[]) => void
  /** Also choose the open folder (its id); the top of the store cannot be chosen. */
  onPickFolder?: (folderId: string) => void
  pickFolderLabel?: string
  title?: string
  pickLabel?: (count: number) => string
  accept?: readonly string[]
  /** The folder it opens in (null: the top). */
  initialParentId?: string | null
}) {
  const { t } = useI18n()
  const [parentId, setParentId] = useState<string | null>(initialParentId)
  return (
    <Modal open title={title ?? t({ ko: '보관함에서 첨부', en: 'Attach from files' })} onClose={onClose} size="lg" height="tall">
      <FileBrowser key={parentId ?? 'root'} parentId={parentId} onNavigate={setParentId} onPick={onPick} pickLabel={pickLabel} onPickFolder={onPickFolder ? () => { if (parentId) onPickFolder(parentId) } : undefined} pickFolderLabel={pickFolderLabel} accept={accept} />
    </Modal>
  )
}

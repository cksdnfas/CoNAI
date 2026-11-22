import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useNavigate } from 'react-router-dom'
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, ClipboardPaste, Download, FilePlus, Folder, FolderUp, FolderInput, FolderPlus, LayoutGrid, List, Pencil, Puzzle, RefreshCw, Reply, Scissors, Search, Trash2, Upload } from 'lucide-react'
import type { FileSearchStatus, StoredFileEntry, StoredFileSearchHit } from '@conai/shared'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageToolbarSearch } from '@/components/common/page-toolbar-search'
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
import { LoadingState } from '@/components/ui/loading-state'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody } from '@/components/ui/modal'
import { EditorFooter } from '@/components/ui/editor-footer'
import { SidebarNav } from '@/components/ui/sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SendToAudioDialog, useCanSendToAudio } from '@/features/audio/send-to-audio-dialog'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatDockedBesidePage } from '@/features/codex-chat/chat-reference'
import { useCodexChatReference } from '@/features/codex-chat/codex-chat-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPageDataPermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { triggerBrowserDownload } from '@/lib/api-client'
import { FILES_QUERY_KEY, MAX_TEXT_DOCUMENT_BYTES, TEXT_FILE_PATTERN, createStoredFolder, deleteStoredFiles, isRestrictedFileName, listStoredFileRevisions, listStoredFiles, moveStoredFiles, renameStoredFile, restoreStoredFileRevision, searchStoredFiles, retryStoredFileIndex, storedFileDownloadUrl, storedFileRevisionsQueryKey, storedFileThumbnailUrl, uploadStoredFiles } from '@/lib/api-files'
import { formatFileSize } from '@/lib/format-size'
import { getErrorMessage } from '@/lib/error-message'
import { FilePreview } from './file-preview'
import { FileEntryIcon as EntryIcon, fileMediaKind as mediaKind } from './file-preview-shared'
import { FileTextEditor } from './file-text-editor'
import { FileEntryView, type EntryItem } from './file-entry-views'
import { WorkspaceSidebarGroup } from './workspace-projects'
import { isInsideFolders, StoreFolderSidebarGroup, useStoreFolders } from './store-folders'
import { nextFileSort, useFileSort, useFileViewMode, type FileSort, type FileViewMode } from './file-view-mode'
import { FileSortMenu } from './file-sort-menu'
import { clearCutItems, cutItems, forgetCutItems, STORE_CUT_SCOPE, useCutItems } from './cut-items'
import { SystemFolderBrowser, SystemFolderSidebarGroup, type SystemFolderLocation } from './system-folder-browser'
import { HighlightText } from '@/components/common/highlight-text'
import { fileExtension } from '@/lib/file-extension'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { FileListSurface } from './file-list-surface'
import { advanceTreeUpload, entriesFromPickedFolder, finishTreeUpload, startTreeUpload, treeUploadRunning, treeUploadStopping, uploadBatches, useTreeUploadProgress, type UploadEntry } from './folder-upload'
import { TreeUploadStatus } from './tree-upload-status'
import { UPLOAD_LIMITS } from '@/lib/upload-limits'
import { useEntryDrop } from './use-entry-drop'

const FILE_DRAG_TYPE = 'application/x-conai-file-ids'
const PAGE_SIZE = 100
/**
 * `id` renames that item; without it a folder is created in `parent` (default: the open folder). `inline`: a person's
 * gesture (F2, the item menu, the selection bar) edits the listed item's name in place, committing when the field is
 * left. Everything else, the assistant's rename included, is the dialog: a review card's click would otherwise leave the
 * field and rename before the person decided.
 */
type NameDialog = { id?: string; name: string; parent?: string | null; inline?: boolean } | null

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
      {search && (['disabled', 'unavailable', 'partial', 'not_indexed'].includes(search.semantic) || search.keywordTermsLimited || search.unsupportedFiles + search.pendingDocuments + search.partialDocuments + search.failedDocuments > 0) ? <p className="text-xs text-muted-foreground" role="status">
        {search.mode === 'hybrid' ? t({ ko: '키워드 + 의미 검색', en: 'Keyword + semantic search' }) : t({ ko: '키워드 검색', en: 'Keyword search' })}
        {search.semantic === 'disabled' ? ` · ${t({ ko: '의미 검색 꺼짐', en: 'Semantic off' })}` : null}
        {search.semantic === 'unavailable' ? ` · ${t({ ko: '의미 검색 불가 (키워드만 표시)', en: 'Semantic unavailable (keyword only)' })}` : null}
        {['partial', 'not_indexed'].includes(search.semantic) ? ` · ${t({ ko: '의미 색인 {done}/{total}', en: 'Semantic index {done}/{total}' }, { done: search.indexedFiles, total: search.searchableFiles })}` : null}
        {search.pendingDocuments > 0 ? ` · ${t({ ko: '추출 대기 {count}', en: 'Extraction pending {count}' }, { count: search.pendingDocuments })}` : null}
        {search.partialDocuments + search.failedDocuments > 0 ? ` · ${t({ ko: '추출 불완전 {count}', en: 'Incomplete extraction {count}' }, { count: search.partialDocuments + search.failedDocuments })}` : null}
        {search.keywordTermsLimited ? ` · ${t({ ko: '키워드 앞 8어 적용', en: 'First 8 keyword terms used' })}` : null}
        {search.unsupportedFiles > 0 ? ` · ${t({ ko: '파일명 검색 {count}', en: 'Name-only {count}' }, { count: search.unsupportedFiles })}` : null}
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
export function FileBrowser({ parentId, onNavigate, onPick, pickLabel, pickFolders = false, accept, refuse, refuseReason, system = null, onSystemNavigate, workspaces }: {
  /** The files page: project workspaces as the first sidebar group. */
  workspaces?: { onOpen: (id: string) => void; onCreate?: () => void }
  parentId: string | null
  onNavigate: (id: string | null) => void
  /** Picker: the chosen entries (folders too with `pickFolders`). The choice survives moving between folders. */
  onPick?: (files: StoredFileEntry[]) => void
  /** Picker: folders get a checkbox as files do (they still open on a click). */
  pickFolders?: boolean
  /** Picker: the confirm button's text for `count` chosen entries (default: attach). */
  pickLabel?: (count: number) => string
  /** Picker: only files with these extensions (lowercase, with the dot) can be chosen; the others are dimmed. */
  accept?: readonly string[]
  /** Picker: entries (folders too) that can be neither chosen nor opened; they are dimmed. */
  refuse?: (entry: StoredFileEntry) => boolean
  /** Picker: why `refuse` dims an entry, shown on hover. */
  refuseReason?: string
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
  const [marked, setSelected] = useState<string[]>([])
  /** Picker only: what is ticked, kept across folders (the list shows one folder at a time). */
  const [chosen, setChosen] = useState<StoredFileEntry[]>([])
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
  const folderInput = useRef<HTMLInputElement>(null)
  // A folder upload goes on while the files page remounts this browser for another folder: its progress is not state here.
  const treeUploadProgress = useTreeUploadProgress()
  const treeUpload = isPicker ? null : treeUploadProgress
  // Search replaces the folder list while open; the request waits for typing to pause.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const searchQuery = useDebouncedValue(searchInput.trim())
  const canSearch = !isPicker
  const searching = canSearch && searchOpen && searchQuery !== ''
  if ((searching || browsingSystem) && marked.length) setSelected([])
  const [sortOrder, changeSortOrder, sortKeys] = useFileSort('files')
  const order = { sort: sortOrder.sort, direction: sortOrder.direction }
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'list', parentId, offset, sortOrder.sort, sortOrder.direction], queryFn: ({ signal }) => listStoredFiles(parentId, offset, signal, order), enabled: canViewFiles && !browsingSystem && !searching })
  // The server sorts the whole folder, so a new order starts again at the first page.
  const setSort = (next: FileSort) => { changeSortOrder(next); setOffset(0); setSelected([]) }
  const { folders, entries: folderEntries, byId: folderById } = useStoreFolders(canViewFiles)
  const searchResults = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'search', searchQuery], queryFn: ({ signal }) => searchStoredFiles(searchQuery, signal), enabled: canViewFiles && searching })
  const retryExtraction = useMutation({
    mutationFn: (id: string) => retryStoredFileIndex(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY }) },
    onError: (error: unknown) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '본문을 다시 추출하지 못했어.', en: 'Could not retry extraction.' })) }),
  })
  const entries = searching ? searchResults.data?.hits.map(hit => hit.entry) ?? [] : query.data?.entries ?? []
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const selection = marked.flatMap(id => { const entry = byId.get(id); return entry ? [entry] : [] })
  const selected = selection.map(entry => entry.id)
  const rootLabel = t({ ko: '공용 파일', en: 'Shared files' })
  // A picker takes files of the accepted types, and folders only when asked; everything else is just shown.
  const pickable = (entry: StoredFileEntry) => refuse?.(entry) !== true && (entry.kind === 'folder' ? pickFolders : !accept || accept.some((extension) => entry.name.toLowerCase().endsWith(extension)))
  const selectable = isPicker ? entries.filter(pickable) : entries
  const checked = isPicker ? chosen.map((entry) => entry.id) : selected
  const audioSelection = selection.length > 0 && selection.every((entry) => entry.kind === 'file' && mediaKind(entry) === 'audio')
  // "채팅에 참조": files go on the docked chat's next message, the same reference as the paperclip's "보관함에서 고르기".
  const chatDocked = useChatDockedBesidePage()
  const chatReference = useCodexChatReference()
  const chatRef = !isPicker && chatDocked ? chatReference : null
  const selectedFiles = selection.filter((entry) => entry.kind === 'file')
  // A name edited in place needs its item on this page; once it is gone (another page, a delete, a search) the draft goes too.
  const renamingEntry = nameDialog?.inline && !searching ? entries.find((entry) => entry.id === nameDialog.id) : undefined
  if (nameDialog?.inline && renamingEntry === undefined) setNameDialog(null)
  const refresh =() => queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY })
  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setSelected([])
      // A name being edited in place belongs to its own commit: another operation (a drop of files) must not discard it.
      setNameDialog((current) => (current?.inline ? current : null))
      setMoveOpen(false)
      await refresh()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '파일 작업에 실패했어.', en: 'File operation failed.' })) }),
  })
  const busy = mutation.isPending || treeUpload !== null
  const chatPage = !isPicker && chatCanReadFiles && !browsingSystem
  // The previewed text file's earlier versions, so the connected chat can put one back (a review card).
  const previewVersioned = chatPage && preview !== null && preview.kind === 'file' && TEXT_FILE_PATTERN.test(preview.name)
  const versionsQuery = useQuery({ queryKey: storedFileRevisionsQueryKey(accountKey, preview?.id, preview?.updatedAt), queryFn: () => listStoredFileRevisions(preview!.id), enabled: previewVersioned })
  const versions = previewVersioned ? versionsQuery.data?.revisions ?? [] : []
  const editableDocuments = entries.filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name) && entry.size <= MAX_TEXT_DOCUMENT_BYTES)
  // Every route that deletes, moves or renames (the list, the sidebar, the assistant) goes through these, so a cut mark
  // is dropped whenever its items, or the folder they were cut in (or one above it), are changed.
  const forgetCut = (changed: string[]) => forgetCutItems(STORE_CUT_SCOPE, (cut) => cut.ids.some((id) => changed.includes(id)) || isInsideFolders(folderById, cut.from, changed))
  const saveName = (dialog: NonNullable<NameDialog>) => mutation.mutateAsync(() => (dialog.id ? renameStoredFile(dialog.id, dialog.name) : createStoredFolder(dialog.parent === undefined ? parentId : dialog.parent, dialog.name))).then(() => { if (dialog.id) forgetCut([dialog.id]) })
  const moveItems = (ids: string[], folderId: string) => mutation.mutateAsync(() => moveStoredFiles(ids, folderId || null)).then(() => forgetCut(ids))
  const deleteItems = (ids: string[]) => mutation.mutateAsync(() => deleteStoredFiles(ids)).then(() => forgetCut(ids))
  const writerName = (source: { via?: string; profileName?: string } | null) => (source ? [source.via, source.profileName].filter(Boolean).join(' · ') : null)

  useChatPageRegistration(chatPage ? {
    kind: 'files', title: t({ ko: '파일 보관함', en: 'File store' }), resourceId: `shared:${parentId ?? 'root'}`, localRevision: JSON.stringify([selected, preview?.id, nameDialog, moveOpen, searchOpen, searchInput, sortOrder]),
    reviewRevision: JSON.stringify([selected, preview?.id, nameDialog]),
    fields: [
      { id: 'viewMode', label: t({ ko: '목록 표시', en: 'List view' }), type: 'select', value: viewMode, options: ['grid', 'list'], viewOnly: true },
      { id: 'sort', label: t({ ko: '목록 정렬 (기준:방향, 폴더가 먼저)', en: 'List order (key:direction, folders first)' }), type: 'select', value: `${sortOrder.sort}:${sortOrder.direction}`, options: sortKeys.flatMap((key) => [`${key}:asc`, `${key}:desc`]), viewOnly: true },
      { id: 'search', label: t({ ko: '파일 검색어 (이름·내용, 빈 값은 검색 닫기)', en: 'File search (name or text; empty closes search)' }), type: 'text', value: searchOpen ? searchInput : '' },
      ...(nameDialog ? [{ id: 'name', label: t({ ko: '폴더·파일 이름 입력', en: 'Folder or file name draft' }), type: 'text' as const, value: nameDialog.name }] : []),
      ...(moveOpen ? [{ id: 'moveTarget', label: t({ ko: '이동할 폴더 (빈 값은 최상위)', en: 'Destination folder (empty means root)' }), type: 'select' as const, value: moveTarget, options: ['', ...folders.filter((entry) => !selected.includes(entry.folder.id)).map((entry) => entry.folder.id)].slice(0, 100) }] : []),
    ],
    data: {
      files: entries.slice(0, 512).map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind, mimeType: entry.mimeType, bytes: entry.size })), selected: selection.map((entry) => ({ id: entry.id, name: entry.name })), total: searching ? entries.length : query.data?.total ?? 0, offset: searching ? 0 : offset,
      ...(preview ? { previewing: preview.id } : {}),
      // Names and writers of the previewed file's versions only: their text stays out (open the document to read it).
      ...(versions.length ? { previewVersions: versions.slice(0, 30).map((version) => ({ id: version.id, at: version.replacedAt, by: writerName(version.replacedBy) })) } : {}),
    },
    apply: (patch) => { if (patch.viewMode !== undefined) changeViewMode(patch.viewMode as FileViewMode); if (patch.sort !== undefined) { const [key, direction] = String(patch.sort).split(':'); const next = sortKeys.find((value) => value === key); if (next && (direction === 'asc' || direction === 'desc')) setSort({ sort: next, direction }) } if (patch.search !== undefined) { setSearchInput(String(patch.search)); setSearchOpen(String(patch.search).trim() !== '') } if (patch.name !== undefined) setNameDialog((old) => old ? { ...old, name: String(patch.name) } : old); if (patch.moveTarget !== undefined) setMoveTarget(String(patch.moveTarget)) },
    actions: [
      pageAction('files.open', t({ ko: '폴더 열기', en: 'Open folder' }), t({ ko: '목록(data.files)의 폴더나 최상위(root)를 열어.', en: 'Open a listed folder or the top level (root).' }), pageObject({ id: pageChoice(['root', ...entries.filter((entry) => entry.kind === 'folder').slice(0, 200).map((entry) => entry.id)]) }, ['id'])),
      ...(entries.some((entry) => entry.kind !== 'folder') ? [pageAction('files.preview', t({ ko: '파일 미리보기', en: 'Preview file' }), t({ ko: '목록의 파일 미리보기를 열어.', en: 'Open a listed file preview.' }), pageObject({ id: pageChoice(entries.filter((entry) => entry.kind !== 'folder').slice(0, 300).map((entry) => entry.id)) }, ['id']))] : []),
      ...(!searching && entries.length ? [pageAction('files.select', t({ ko: '항목 선택', en: 'Select items' }), t({ ko: '빈 배열은 선택 해제', en: 'empty clears' }), pageObject({ ids: pageArray(pageText(32), 200) }, ['ids']))] : []),
      ...(canOrganize ? [
        pageAction('files.new_folder', t({ ko: '새 폴더 창 열기', en: 'Open new folder dialog' }), t({ ko: 'name을 채우고 files.name_save', en: 'fill name, then files.name_save' })),
        ...(entries.length ? [pageAction('files.rename', t({ ko: '이름 변경 창 열기', en: 'Open rename dialog' }), t({ ko: 'name을 채우고 files.name_save', en: 'fill name, then files.name_save' }), pageObject({ id: pageText(32) }, ['id']))] : []),
        // Not while a name is edited in place: leaving that field commits it, so a review card could never decide first.
        ...(nameDialog && !nameDialog.inline && nameDialog.name.trim() ? [pageAction('files.name_save', nameDialog.id ? t({ ko: '이름 바꾸기', en: 'Rename' }) : t({ ko: '폴더 만들기', en: 'Create folder' }), '', undefined, 'save')] : []),
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
      if (id === 'files.move_save') { await moveItems(selected, moveTarget); return }
      if (id === 'files.delete') { await deleteItems(selected); return }
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
  const toggle = (id: string, on: boolean) => {
    if (!isPicker) { setSelected((current) => (on ? [...current, id] : current.filter((entry) => entry !== id))); return }
    const entry = entries.find((item) => item.id === id)
    setChosen((current) => (on && entry && !current.some((item) => item.id === id) ? [...current, entry] : on ? current : current.filter((item) => item.id !== id)))
  }
  const selectAll = (on: boolean) => {
    if (!isPicker) { setSelected(on ? selectable.map((entry) => entry.id) : []); return }
    const here = new Set(selectable.map((entry) => entry.id))
    setChosen((current) => [...current.filter((item) => !here.has(item.id)), ...(on ? selectable : [])])
  }
  const upload = (files: File[], target: string | null = parentId) => {
    if (canUpload && !busy && files.length) mutation.mutate(() => uploadStoredFiles(target, files, { allowAnyType: canUploadAny }))
  }
  /**
   * Files and folders from the computer (dropped or picked) into `target`: batched requests, in order, stoppable between
   * batches. Its progress is `useTreeUploadProgress`, from the first read of the dropped folders on.
   */
  const uploadTree = (source: Promise<UploadEntry[]> | UploadEntry[], target: string | null) => {
    if (!canUpload || busy || treeUploadRunning()) return
    startTreeUpload()
    void mutation.mutateAsync(async () => {
      try {
        const entries = await source
        if (entries.length === 0) {
          showSnackbar({ tone: 'info', message: t({ ko: '올릴 파일이 없어.', en: 'No files to upload.' }) })
          return
        }
        const restricted = canUploadAny ? undefined : entries.find((entry) => isRestrictedFileName(entry.file.name))
        if (restricted) throw new Error(t({ ko: '이 형식은 올릴 수 없어: {name}', en: 'Restricted file type: {name}' }, { name: restricted.file.name }))
        const oversized = entries.find((entry) => entry.file.size > UPLOAD_LIMITS.maxFileBytes)
        if (oversized) throw new Error(t({ ko: '파일 하나는 {limit}까지 올릴 수 있어: {name}', en: 'A file can be up to {limit}: {name}' }, { limit: formatFileSize(UPLOAD_LIMITS.maxFileBytes), name: oversized.file.name }))
        const folders = entries.some((entry) => entry.path.includes('/'))
        let done = 0
        try {
          for (const batch of uploadBatches(entries, UPLOAD_LIMITS.maxFilesPerRequest, UPLOAD_LIMITS.maxRequestBytes)) {
            if (treeUploadStopping()) break
            advanceTreeUpload(done, entries.length)
            await uploadStoredFiles(target, batch.map((entry) => entry.file), { allowAnyType: canUploadAny, relativePaths: folders ? batch.map((entry) => entry.path) : undefined })
            done += batch.length
          }
        } catch (error) {
          await refresh()
          throw new Error(`${t({ ko: '{done}개 올리고 {rest}개는 올리지 못했어.', en: 'Uploaded {done}; {rest} were not uploaded.' }, { done, rest: entries.length - done })} ${getErrorMessage(error, '')}`.trim(), { cause: error })
        }
        if (done < entries.length) showSnackbar({ tone: 'info', message: t({ ko: '업로드를 멈췄어. {done}개 올리고 {rest}개는 올리지 않았어.', en: 'Upload stopped. Uploaded {done}; {rest} were not uploaded.' }, { done, rest: entries.length - done }) })
      } finally {
        finishTreeUpload()
      }
    }).catch(() => undefined)
  }
  const move = (ids: string[], folderId: string) => { void moveItems(ids, folderId).catch(() => undefined) }
  // Cut marks items; a paste in another folder moves them through the same move as a drag does.
  const cut = useCutItems(STORE_CUT_SCOPE, accountKey)
  const cutSelection = (ids: string[] = selected) => { if (canOrganize && ids.length) cutItems({ scope: STORE_CUT_SCOPE, account: accountKey, ids, from: parentId ?? '' }) }
  const canPasteInto = (folderId: string) => cut !== null && canOrganize && !busy && folderId !== cut.from && !isInsideFolders(folderById, folderId, cut.ids)
  // A paste that did not go through drops the mark: the person cuts again from the refreshed list.
  const paste = (folderId: string = parentId ?? '') => { if (cut && canPasteInto(folderId)) void moveItems(cut.ids, folderId).catch(clearCutItems) }
  // Drop targets are folder ids ('' is the top): tiles, rows, the sidebar tree, the breadcrumbs and the list itself.
  const { drop, startMove, endMove } = useEntryDrop({
    moveType: FILE_DRAG_TYPE,
    canMove: canOrganize,
    canUpload,
    busy,
    // Moving into the open folder is no move; the server also refuses a folder moved into its own subfolders.
    allowsMove: (folderId, ids) => folderId !== (parentId ?? '') && !isInsideFolders(folderById, folderId, ids),
    onMove: move,
    onUpload: (files, folderId) => upload(files, folderId || null),
    // Pickers keep the plain file upload.
    onUploadTree: isPicker ? undefined : (entries, folderId) => uploadTree(entries, folderId || null),
  })
  /** True once the person confirmed and the server deleted. */
  const remove = async (ids: string[] = selected) => {
    const confirmed = await confirm({
      title: t({ ko: '선택한 항목을 삭제할까?', en: 'Delete selected items?' }),
      description: t({ ko: '선택한 항목과 원본 파일을 삭제해. 빈 폴더가 아니거나 채팅에서 쓰는 파일은 남겨. 삭제한 항목은 되돌릴 수 없어.', en: 'Delete selected items and original files, keeping non-empty folders and files used in chats. Deleted items cannot be restored.' }),
      tone: 'destructive',
    })
    if (!confirmed) return false
    return deleteItems(ids).then(() => true, () => false)
  }
  /** A sidebar folder, deleted like a listed one; when it held the open folder and is really gone (the server keeps a non-empty one), the view steps out of it. */
  const removeFolder = async (folder: StoredFileEntry) => {
    const viewing = parentId !== null && isInsideFolders(folderById, parentId, [folder.id])
    if (!await remove([folder.id]) || !viewing) return
    const remaining = queryClient.getQueryData<StoredFileEntry[]>([...FILES_QUERY_KEY, accountKey, 'folders'])
    if (remaining && !remaining.some((entry) => entry.id === folder.id)) navigate(folder.parentId)
  }
  const download = (entry: StoredFileEntry) => {
    triggerBrowserDownload(storedFileDownloadUrl(entry.id), entry.name)
  }
  /** One row's actions, for its ⋯ button and its right-click / long-press menu. */
  const rowEntries = (entry: StoredFileEntry): ActionMenuEntry[] => [
    entry.kind === 'file' && canSendAudio && mediaKind(entry) === 'audio' && { key: 'audio', label: t({ ko: '오디오로 보내기', en: 'Send to Audio' }), icon: AudioLines, onSelect: () => setAudioSend([entry]) },
    entry.kind === 'file' && { key: 'download', label: t({ ko: '다운로드', en: 'Download' }), icon: Download, onSelect: () => download(entry) },
    entry.kind === 'file' && chatRef && (chatRef.draftAttachments.some((file) => file.id === entry.id)
      ? { key: 'chat-reference', label: t({ ko: '채팅 참조 빼기', en: 'Remove chat reference' }), icon: Reply, onSelect: () => chatRef.removeAttachment(entry.id) }
      : { key: 'chat-reference', label: t({ ko: '채팅에 참조', en: 'Reference in chat' }), icon: Reply, onSelect: () => chatRef.addAttachments([entry]) }),
    '-',
    canOrganize && { key: 'cut', label: t({ ko: '잘라내기', en: 'Cut' }), icon: Scissors, disabled: busy, onSelect: () => cutSelection(selected.includes(entry.id) ? selected : [entry.id]) },
    canOrganize && { key: 'rename', label: t({ ko: '이름 변경', en: 'Rename' }), icon: Pencil, disabled: busy, onSelect: () => setNameDialog({ id: entry.id, name: entry.name, inline: true }) },
    canOrganize && { key: 'move', label: t({ ko: '이동', en: 'Move' }), icon: FolderInput, disabled: busy, onSelect: () => { setSelected([entry.id]); setMoveTarget(parentId ?? ''); setMoveOpen(true) } },
    '-',
    canDelete && { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy, onSelect: () => void remove([entry.id]) },
  ]
  /** A sidebar folder's actions (null: the top row): the list's dialogs and confirmation, for that folder. */
  const folderMenu = (folder: StoredFileEntry | null): ActionMenuEntry[] => [
    canOrganize && { key: 'new-folder', label: t({ ko: '새 폴더', en: 'New folder' }), icon: FolderPlus, disabled: busy, onSelect: () => setNameDialog({ name: '', parent: folder?.id ?? null }) },
    folder && canOrganize && { key: 'rename', label: t({ ko: '이름 변경', en: 'Rename' }), icon: Pencil, disabled: busy, onSelect: () => setNameDialog({ id: folder.id, name: folder.name }) },
    canPasteInto(folder?.id ?? '') && { key: 'paste', label: t({ ko: '붙여넣기', en: 'Paste' }), icon: ClipboardPaste, onSelect: () => paste(folder?.id ?? '') },
    '-',
    folder && canDelete && { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy, onSelect: () => void removeFolder(folder) },
  ]
  /** Right-click on empty list space: the ways to add something to the open folder. */
  const emptySpaceMenu: ActionMenuEntry[] = [
    canOrganize && { key: 'new-folder', label: t({ ko: '새 폴더', en: 'New folder' }), icon: FolderPlus, disabled: busy, onSelect: () => setNameDialog({ name: '' }) },
    canUpload && { key: 'new-document', label: t({ ko: '새 문서', en: 'New document' }), icon: FilePlus, disabled: busy, onSelect: () => setEditor({ entry: null }) },
    canPasteInto(parentId ?? '') && { key: 'paste', label: t({ ko: '붙여넣기', en: 'Paste' }), icon: ClipboardPaste, onSelect: () => paste() },
    canUpload && { key: 'upload', label: t({ ko: '파일 업로드', en: 'Upload files' }), icon: Upload, disabled: busy, onSelect: () => uploadInput.current?.click() },
    canUpload && { key: 'upload-folder', label: t({ ko: '폴더 업로드', en: 'Upload folder' }), icon: FolderUp, disabled: busy, onSelect: () => folderInput.current?.click() },
  ]

  const actions = (
    <>
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
      {viewMode === 'grid' ? <FileSortMenu value={sortOrder} keys={sortKeys} onChange={setSort} /> : null}
      {canSearch ? (
        <IconButton size="icon-sm" variant="ghost" active={searchOpen} label={t({ ko: '검색', en: 'Search' })} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>
          <Search />
        </IconButton>
      ) : null}
      {canOrganize ? (
        <IconButton size="icon-sm" variant="ghost" label={t({ ko: '새 폴더', en: 'New folder' })} disabled={busy} onClick={() => setNameDialog({ name: '' })}>
          <FolderPlus />
        </IconButton>
      ) : null}
      <ActionMenuButton
        size="icon-sm"
        label={t({ ko: '더 보기', en: 'More' })}
        entries={[
          !isPicker && !browsingSystem && { key: 'plugin', label: t({ ko: '플러그인으로 열기', en: 'Open with plugin' }), icon: Puzzle, disabled: busy || selected.length > 20 || selection.some((entry) => entry.kind !== 'file'), onSelect: () => navigateToExtension(`/extensions${selected.length ? `?files=${encodeURIComponent(selected.join(','))}` : ''}`) },
          canUpload && !isPicker && { key: 'new-document', label: t({ ko: '새 문서', en: 'New document' }), icon: FilePlus, disabled: busy, onSelect: () => setEditor({ entry: null }) },
          canUpload && !isPicker && { key: 'upload-folder', label: t({ ko: '폴더 업로드', en: 'Upload folder' }), icon: FolderUp, disabled: busy, onSelect: () => folderInput.current?.click() },
          { key: 'refresh', label: t({ ko: '새로고침', en: 'Refresh' }), icon: RefreshCw, disabled: busy, onSelect: () => void refresh() },
        ]}
      />
      {/* The picker dialog already has its primary key (첨부) in the footer: upload stays a quiet icon there. */}
      {canUpload ? isPicker ? (
        <IconButton size="icon-sm" variant="ghost" disabled={busy} label={t({ ko: '파일 업로드', en: 'Upload files' })} onClick={() => uploadInput.current?.click()}><Upload /></IconButton>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => uploadInput.current?.click()}>
          <Upload />
          {t({ ko: '파일 업로드', en: 'Upload files' })}
        </Button>
      ) : null}
    </>
  )

  const breadcrumbs = (
    <PathBreadcrumbs
      ariaLabel={t({ ko: '현재 경로', en: 'Current path' })}
      items={[{ key: 'root', label: rootLabel, dropId: '', onClick: () => navigate(null) }, ...(query.data?.breadcrumbs ?? []).map((folder) => ({ key: folder.id, label: folder.name, dropId: folder.id, onClick: () => navigate(folder.id) }))]}
      dropTarget={isPicker ? undefined : drop}
    />
  )

  const searchField = (
    <PageToolbarSearch value={searchInput} onChange={setSearchInput} onClose={closeSearch} placeholder={t({ ko: '파일 이름이나 내용 검색', en: 'Search file names and text' })} />
  )

  // A server folder is open instead of the store: the tree only navigates (the dialogs below belong to the store view).
  const sidebar = (
    <SidebarNav aria-label={t({ ko: '폴더', en: 'Folders' })} {...(browsingSystem ? undefined : drop.containerProps)}>
      {workspaces && canViewFiles ? <WorkspaceSidebarGroup activeId={null} onOpen={workspaces.onOpen} onCreate={workspaces.onCreate} /> : null}
      <StoreFolderSidebarGroup labelled={workspaces !== undefined} activeId={browsingSystem ? undefined : parentId} onOpen={navigate} dropTarget={browsingSystem ? undefined : drop} getFolderMenu={browsingSystem ? undefined : folderMenu} />
      {canBrowseSystem ? <SystemFolderSidebarGroup active={browsingSystem ? system.root : null} onOpen={(root) => onSystemNavigate({ root, path: '' })} /> : null}
    </SidebarNav>
  )

  if (browsingSystem) {
    return <SystemFolderBrowser key={`${system.root}:${system.path}`} location={system} onNavigate={onSystemNavigate} sidebar={sidebar} />
  }

  const toItem = (entry: StoredFileEntry): EntryItem => ({
    id: entry.id, name: entry.name, folder: entry.kind === 'folder', size: entry.size, modified: formatDateTime(entry.updatedAt),
    icon: <EntryIcon entry={entry} />, face: <StoredFileFace entry={entry} />,
    disabled: isPicker && (entry.kind === 'file' ? !pickable(entry) : refuse?.(entry) === true),
    disabledReason: isPicker && refuse?.(entry) === true ? refuseReason : undefined,
  })
  const commitRename = async () => {
    if (!nameDialog?.id || !renamingEntry) return
    const name = nameDialog.name.trim()
    if (!name || name === renamingEntry.name) { setNameDialog(null); return }
    if (!busy) {
      await saveName({ ...nameDialog, name })
      setNameDialog(null)
    }
  }
  const openEntry = (entry: StoredFileEntry) => { if (entry.kind === 'folder') navigate(entry.id); else setPreview(entry) }
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
        selected={checked}
        onToggle={toggle}
        onSelectAll={selectAll}
        canSelect={(item) => !isPicker || pickable(byId.get(item.id)!)}
        menu={isPicker ? undefined : (item) => rowEntries(byId.get(item.id)!)}
        formatSize={formatFileSize}
        onSelect={isPicker ? undefined : setSelected}
        sort={sortOrder}
        sortKeys={sortKeys}
        onSort={(key) => setSort(nextFileSort(sortOrder, key))}
        cutIds={isPicker ? undefined : cut?.ids}
        renaming={renamingEntry && nameDialog ? { id: renamingEntry.id, value: nameDialog.name, onChange: (name) => setNameDialog((current) => (current ? { ...current, name } : null)), onCommit: commitRename, onCancel: () => setNameDialog(null) } : undefined}
        draggable={canOrganize && !busy && !isPicker}
        onDragStart={(ids, event) => startMove(event, ids)}
        onDragEnd={endMove}
        dropTarget={drop}
        onOpen={(item) => {
          const entry = byId.get(item.id)!
          if (isPicker && entry.kind !== 'folder') toggle(entry.id, !checked.includes(entry.id))
          else openEntry(entry)
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

  const crumbs = query.data?.breadcrumbs ?? []
  const body = (
    <FileListSurface
      drop={drop}
      dropId={parentId ?? ''}
      dropLabel={t({ ko: '여기에 놓으면 "{folder}"에 업로드해', en: 'Drop to upload to "{folder}"' }, { folder: crumbs.at(-1)?.name ?? rootLabel })}
      selection={isPicker || searching ? undefined : {
        selectedIds: selected,
        pageIds: entries.map((entry) => entry.id),
        onSelectedIdsChange: setSelected,
        onOpen: selection.length === 1 ? () => openEntry(selection[0]) : undefined,
        onDelete: canDelete && selection.length > 0 && !busy ? () => void remove() : undefined,
        onRename: canOrganize && selection.length === 1 && !busy ? () => setNameDialog({ id: selection[0].id, name: selection[0].name, inline: true }) : undefined,
        // The parent is known from the path of the open folder: until that has loaded there is none to go to.
        onParent: parentId !== null && crumbs.length > 0 ? () => navigate(crumbs.length > 1 ? crumbs[crumbs.length - 2].id : null) : undefined,
        onCut: canOrganize && !busy && selection.length > 0 ? () => cutSelection() : undefined,
        onPaste: canPasteInto(parentId ?? '') ? () => paste() : undefined,
        onCancelCut: cut ? clearCutItems : undefined,
        menu: emptySpaceMenu,
      }}
    >
      <input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { upload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      {isPicker ? null : <input ref={folderInput} type="file" multiple className="hidden" aria-label={t({ ko: '폴더 업로드', en: 'Upload folder' })} {...{ webkitdirectory: '' }} onChange={(event) => { const picked = entriesFromPickedFolder(Array.from(event.target.files ?? [])); event.target.value = ''; uploadTree(picked, parentId) }} />}
      {isPicker ? null : <TreeUploadStatus />}
      {list}
      {pager}
    </FileListSurface>
  )

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
          <EditorFooter
            onSave={() => onPick(chosen)}
            canSave={chosen.length > 0}
            saving={busy}
            saveLabel={pickLabel
                ? pickLabel(chosen.length)
                : chosen.length > 0
                  ? t({ ko: '{count}개 첨부', en: 'Attach {count}' }, { count: chosen.length })
                  : t({ ko: '첨부', en: 'Attach' })}
          />
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
          actions={canOrganize || canDelete || (canSendAudio && audioSelection) || (chatRef && selectedFiles.length > 0) ? (
            <>
              {chatRef && selectedFiles.length > 0 ? <SelectionBarAction icon={Reply} label={t({ ko: '채팅에 참조', en: 'Reference in chat' })} onClick={() => { chatRef.addAttachments(selectedFiles); setSelected([]) }} /> : null}
              {canSendAudio && audioSelection ? <SelectionBarAction icon={AudioLines} label={t({ ko: '오디오로 보내기', en: 'Send to Audio' })} disabled={busy} onClick={() => setAudioSend(selection)} /> : null}
              {canOrganize ? <SelectionBarAction icon={Pencil} label={t({ ko: '이름 변경', en: 'Rename' })} disabled={selection.length !== 1 || busy} onClick={() => setNameDialog({ id: selection[0].id, name: selection[0].name, inline: true })} /> : null}
              {canOrganize ? <SelectionBarAction icon={FolderInput} label={t({ ko: '이동', en: 'Move' })} disabled={busy} onClick={() => { setMoveTarget(parentId ?? ''); setMoveOpen(true) }} /> : null}
              {canDelete ? <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} variant="destructive" disabled={busy} onClick={() => void remove()} /> : null}
            </>
          ) : null}
        />
      )}

      <NameDialog
        open={nameDialog !== null && !nameDialog.inline}
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
        folders={moveOpen ? folderEntries.filter((folder) => !isInsideFolders(folderById, folder.id, selected)).map((folder) => ({ value: folder.id, label: folder.name, parent: folder.parentId ?? '' })) : []}
        rootLabel={rootLabel}
        onSubmit={() => move(selected, moveTarget)}
        onClose={() => setMoveOpen(false)}
        busy={busy}
      />

      <SendToAudioDialog files={audioSend} onClose={() => setAudioSend(null)} />
      {preview ? <FilePreview entry={preview} order={order} onClose={() => setPreview(null)} onNavigate={setPreview} onEdit={canUpload ? (entry) => { setPreview(null); setEditor({ entry }) } : undefined} /> : null}
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

/** Choose stored files (and, with `pickFolders`, folders) to attach or link. The ticks stay while you move between folders. */
export function FilePicker({ onClose, onPick, pickFolders, title, pickLabel, accept, refuse, refuseReason, initialParentId = null }: {
  onClose: () => void
  onPick: (entries: StoredFileEntry[]) => void
  /** Folders get a checkbox too. */
  pickFolders?: boolean
  title?: string
  pickLabel?: (count: number) => string
  /** Only files with these extensions can be chosen; the others are dimmed. */
  accept?: readonly string[]
  /** Entries (folders too) that can be neither chosen nor opened; they are dimmed. */
  refuse?: (entry: StoredFileEntry) => boolean
  /** Why `refuse` dims an entry, shown on hover. */
  refuseReason?: string
  /** The folder it opens in (null: the top). */
  initialParentId?: string | null
}) {
  const { t } = useI18n()
  const [parentId, setParentId] = useState<string | null>(initialParentId)
  return (
    <Modal open title={title ?? t({ ko: '보관함에서 첨부', en: 'Attach from files' })} onClose={onClose} size="lg" height="tall">
      <FileBrowser parentId={parentId} onNavigate={setParentId} onPick={onPick} pickLabel={pickLabel} pickFolders={pickFolders} accept={accept} refuse={refuse} refuseReason={refuseReason} />
    </Modal>
  )
}

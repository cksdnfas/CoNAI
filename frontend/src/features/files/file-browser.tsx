import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Download, File, FileText, Film, Folder, FolderInput, FolderPlus, Image as ImageIcon, LayoutGrid, List, Music, Pencil, RefreshCw, Trash2, Upload, Users } from 'lucide-react'
import type { StoredFileEntry, StoredFileOwner } from '@conai/shared'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatPageDataPermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, createStoredFolder, deleteStoredFiles, formatFileSize, listStoredFileOwners, listStoredFiles, listStoredFolders, moveStoredFiles, renameStoredFile, storedFileDownloadUrl, storedFileThumbnailUrl, uploadStoredFiles } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { FilePreview } from './file-preview'

const FILE_DRAG_TYPE = 'application/x-conai-file-ids'
const PAGE_SIZE = 100
/** `owner` value that shows the account list instead of a store. */
export const ALL_OWNERS = 'all'
type NameDialog = { id?: string; name: string } | null

function folderTree(folders: StoredFileEntry[]) {
  const children = new Map<string | null, StoredFileEntry[]>()
  for (const folder of folders) children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder])
  const result: Array<{ folder: StoredFileEntry; depth: number; path: string }> = []
  const walk = (parentId: string | null, depth: number, parentPath: string) => {
    if (depth >= 64) return
    for (const folder of children.get(parentId) ?? []) {
      const path = `${parentPath}/${folder.name}`
      result.push({ folder, depth, path })
      walk(folder.id, depth + 1, path)
    }
  }
  walk(null, 0, '')
  return result
}

function mediaKind(entry: StoredFileEntry) {
  const type = entry.mimeType ?? ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'other'
}

function EntryIcon({ entry, className = 'size-4' }: { entry: StoredFileEntry; className?: string }) {
  if (entry.kind === 'folder') return <Folder className={cn('shrink-0 text-warning', className)} />
  const kind = mediaKind(entry)
  const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? Film : kind === 'audio' ? Music : (entry.mimeType ?? '').startsWith('text/') ? FileText : File
  return <Icon className={cn('shrink-0 text-muted-foreground', className)} />
}

type FileViewMode = 'grid' | 'list'
const VIEW_MODE_STORAGE_KEY = 'conai.files.view'

function readViewMode(): FileViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/** Extension in capitals under the icon, so PDF / ZIP / TXT read at a glance. */
function extensionOf(name: string) {
  const match = /\.([a-z0-9]{1,6})$/i.exec(name)
  return match ? match[1].toUpperCase() : null
}

/** One file or folder as a tile: image files show a thumbnail, everything else a type icon. */
function FileTile({ entry, owner, selected, showCheckbox, canSelect, draggable, onOpen, onToggle, onDragStart, onDragOver, onDrop }: {
  entry: StoredFileEntry
  owner: string | null
  selected: boolean
  /** Checkboxes stay visible once anything is selected (and on hover otherwise). */
  showCheckbox: boolean
  canSelect: boolean
  draggable: boolean
  onOpen: () => void
  onToggle: (checked: boolean) => void
  onDragStart: (event: DragEvent) => void
  onDragOver?: (event: DragEvent) => void
  onDrop?: (event: DragEvent) => void
}) {
  const { t } = useI18n()
  const [thumbFailed, setThumbFailed] = useState(false)
  const { canViewImages } = useImagePermissions()
  const showThumb = canViewImages && entry.kind === 'file' && ['image', 'video'].includes(mediaKind(entry)) && entry.mimeType !== 'image/svg+xml' && !thumbFailed
  const extension = entry.kind === 'file' ? extensionOf(entry.name) : null

  return (
    <div className="group relative min-w-0" draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}>
      <Button
        variant="ghost"
        onClick={onOpen}
        title={entry.name}
        className={cn('flex h-auto w-full flex-col items-stretch gap-1.5 whitespace-normal p-1.5 text-left font-normal', selected && 'bg-primary/10 hover:bg-primary/15')}
      >
        <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm bg-surface-low">
          {showThumb ? (
            <img src={storedFileThumbnailUrl(entry.id, owner)} alt="" loading="lazy" draggable={false} onError={() => setThumbFailed(true)} className="size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <EntryIcon entry={entry} className="size-9" />
              {extension ? <span className="text-2xs font-semibold tracking-wide text-muted-foreground">{extension}</span> : null}
            </span>
          )}
        </span>
        <span className="line-clamp-2 break-all px-0.5 text-xs leading-snug text-foreground">{entry.name}</span>
        {entry.kind === 'file' ? <span className="px-0.5 text-2xs text-muted-foreground">{formatFileSize(entry.size)}</span> : null}
      </Button>
      {canSelect ? (
        <span className={cn('absolute left-2.5 top-2.5 rounded-sm bg-background/80 p-0.5 transition-opacity', selected || showCheckbox ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
          <Checkbox aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: entry.name })} checked={selected} onCheckedChange={(checked) => onToggle(checked === true)} />
        </span>
      ) : null}
    </div>
  )
}

/** Display name of one account's store; deleted accounts and the pre-auth bootstrap store have no username. */
function ownerLabel(owner: StoredFileOwner, t: ReturnType<typeof useI18n>['t']) {
  if (owner.username) return owner.username
  if (owner.status === 'bootstrap') return t({ ko: '초기 설정 전 파일', en: 'Pre-setup files' })
  return t({ ko: '삭제된 계정 {key}', en: 'Deleted account {key}' }, { key: owner.ownerKey })
}

/** Every account's store at a glance (administrators); choosing one opens it. */
function OwnerList({ owners, onOpen }: { owners: StoredFileOwner[]; onOpen: (owner: StoredFileOwner) => void }) {
  const { t } = useI18n()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-xs text-muted-foreground">
          <tr>
            <th className="py-3 font-normal">{t({ ko: '계정', en: 'Account' })}</th>
            <th className="hidden px-3 font-normal sm:table-cell">{t({ ko: '상태', en: 'Status' })}</th>
            <th className="px-3 text-right font-normal">{t({ ko: '파일', en: 'Files' })}</th>
            <th className="px-3 text-right font-normal">{t({ ko: '용량', en: 'Size' })}</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((owner) => (
            <tr key={owner.ownerKey} className="border-b border-line last:border-0 hover:bg-fill">
              <td className="min-w-40">
                <Button variant="ghost" className="max-w-full justify-start" onClick={() => onOpen(owner)}>
                  <Folder className="shrink-0 text-warning" />
                  <span className="max-w-80 truncate">{ownerLabel(owner, t)}</span>
                  {owner.self ? <span className="text-xs text-muted-foreground">{t({ ko: '나', en: 'me' })}</span> : null}
                </Button>
              </td>
              <td className="hidden whitespace-nowrap px-3 text-xs text-muted-foreground sm:table-cell">
                {owner.status === 'active' ? (owner.accountType === 'admin' ? t({ ko: '관리자', en: 'Admin' }) : t({ ko: '게스트', en: 'Guest' }))
                  : owner.status === 'disabled' ? t({ ko: '비활성', en: 'Disabled' })
                    : owner.status === 'deleted' ? t({ ko: '삭제됨', en: 'Deleted' }) : ''}
              </td>
              <td className="whitespace-nowrap px-3 text-right text-xs text-muted-foreground">{owner.fileCount}</td>
              <td className="whitespace-nowrap px-3 text-right text-xs text-muted-foreground">{formatFileSize(owner.totalSize)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The account's private file store: folder tree, list, upload / drag-in, move, rename, delete.
 * With `onPick` it becomes a picker (inside a modal): only files can be chosen and nothing is changed but uploads.
 * With `owner` + `onOwnerChange`, administrators can switch to any account's store (`ALL_OWNERS` lists them).
 */
export function FileBrowser({ parentId, onNavigate, onPick, pickLabel, accept, owner = null, onOwnerChange }: {
  parentId: string | null
  onNavigate: (id: string | null) => void
  onPick?: (files: StoredFileEntry[]) => void
  /** Picker: the confirm button's text for `count` chosen files (default: attach). */
  pickLabel?: (count: number) => string
  /** Picker: only files with these extensions (lowercase, with the dot) can be chosen. */
  accept?: readonly string[]
  owner?: string | null
  onOwnerChange?: (owner: string | null) => void
}) {
  const { t, formatDateTime } = useI18n()
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
  // Restricted file types and other accounts' stores are for administrators (the local owner before accounts exist).
  const canUploadAny = auth.data?.isAdmin === true || auth.data?.hasCredentials === false
  const canBrowseAll = !isPicker && onOwnerChange !== undefined && auth.data?.isAdmin === true
  const browsingAll = canBrowseAll && owner === ALL_OWNERS
  /** Store sent to the API: null for the requester's own store. */
  const storeOwner = canBrowseAll && owner && owner !== ALL_OWNERS ? owner : null
  const accountKey = auth.data?.accountId ?? (auth.data?.hasCredentials ? 'anonymous' : 'bootstrap')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [preview, setPreview] = useState<StoredFileEntry | null>(null)
  const [viewMode, setViewMode] = useState<FileViewMode>(readViewMode)
  const changeViewMode = (mode: FileViewMode) => {
    setViewMode(mode)
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }
  const uploadInput = useRef<HTMLInputElement>(null)
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, storeOwner, 'list', parentId, offset], queryFn: () => listStoredFiles(parentId, offset, storeOwner), enabled: canViewFiles && !browsingAll })
  const foldersQuery = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, storeOwner, 'folders'], queryFn: () => listStoredFolders(storeOwner), enabled: canViewFiles && !browsingAll })
  const ownersQuery = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'owners'], queryFn: listStoredFileOwners, enabled: canBrowseAll })
  const folders = useMemo(() => folderTree(foldersQuery.data ?? []), [foldersQuery.data])
  const entries = query.data?.entries ?? []
  const currentOwner = storeOwner ? ownersQuery.data?.find((item) => item.ownerKey === storeOwner) : undefined
  const rootLabel = storeOwner ? (currentOwner ? ownerLabel(currentOwner, t) : storeOwner) : t({ ko: '내 파일', en: 'My files' })
  // The picker attaches files only; folders are for navigating.
  const selectable = isPicker ? entries.filter((entry) => entry.kind === 'file') : entries
  const selection = entries.filter((entry) => selected.includes(entry.id))
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

  useChatPageRegistration(!isPicker && chatCanReadFiles && !browsingAll ? {
    kind: 'files', title: t({ ko: '파일 보관함', en: 'File store' }), resourceId: `${storeOwner ?? 'self'}:${parentId ?? 'root'}`, localRevision: JSON.stringify([selected, preview?.id, nameDialog, moveOpen]),
    fields: [
      { id: 'viewMode', label: t({ ko: '목록 표시', en: 'List view' }), type: 'select', value: viewMode, options: ['grid', 'list'] },
      ...(nameDialog ? [{ id: 'name', label: t({ ko: '폴더·파일 이름 입력', en: 'Folder or file name draft' }), type: 'text' as const, value: nameDialog.name }] : []),
      ...(moveOpen ? [{ id: 'moveTarget', label: t({ ko: '이동할 폴더 (빈 값은 최상위)', en: 'Destination folder (empty means root)' }), type: 'select' as const, value: moveTarget, options: ['', ...folders.filter((entry) => !selected.includes(entry.folder.id)).map((entry) => entry.folder.id)].slice(0, 100) }] : []),
    ],
    data: { files: entries.slice(0, 512).map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind, mimeType: entry.mimeType, bytes: entry.size })), selected: selection.map((entry) => ({ id: entry.id, name: entry.name })), total: query.data?.total ?? 0, offset },
    apply: (patch) => { if (patch.viewMode !== undefined) changeViewMode(patch.viewMode as FileViewMode); if (patch.name !== undefined) setNameDialog((old) => old ? { ...old, name: String(patch.name) } : old); if (patch.moveTarget !== undefined) setMoveTarget(String(patch.moveTarget)) },
  } : null)

  const navigate = (id: string | null) => {
    setSelected([])
    setOffset(0)
    onNavigate(id)
  }
  const openOwner = (next: StoredFileOwner | null) => {
    setSelected([])
    setOffset(0)
    onOwnerChange?.(next === null ? ALL_OWNERS : next.self ? null : next.ownerKey)
  }
  const toggle = (id: string, checked: boolean) => setSelected((current) => (checked ? [...current, id] : current.filter((entry) => entry !== id)))
  const upload = (files: File[], target: string | null = parentId) => {
    if (canUpload && !busy && files.length) mutation.mutate(() => uploadStoredFiles(target, files, { owner: storeOwner, allowAnyType: canUploadAny }))
  }
  const drop = (event: DragEvent, target: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE)
    if (dragged) {
      if (!canOrganize) return
      try {
        const ids: unknown = JSON.parse(dragged)
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) mutation.mutate(() => moveStoredFiles(ids, target, storeOwner))
      } catch {
        // Ignore unrelated drag payloads.
      }
    } else if (event.dataTransfer.files.length) {
      upload(Array.from(event.dataTransfer.files), target)
    }
  }
  const dragOver = (event: DragEvent) => {
    if (busy) return
    const moving = event.dataTransfer.types.includes(FILE_DRAG_TYPE)
    if (moving ? !canOrganize : !canUpload) return
    event.preventDefault()
    event.dataTransfer.dropEffect = moving ? 'move' : 'copy'
  }
  const remove = async () => {
    const confirmed = await confirm({
      title: t({ ko: '선택한 항목을 삭제할까?', en: 'Delete selected items?' }),
      description: t({ ko: '원본 파일이 삭제돼. 빈 폴더만 삭제할 수 있고, 채팅에서 참조 중인 파일은 보호돼.', en: 'Original files will be deleted. Folders must be empty; files attached to chats are protected.' }),
      tone: 'destructive',
    })
    if (confirmed) mutation.mutate(() => deleteStoredFiles(selected, storeOwner))
  }

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
      <IconButton variant="ghost" label={t({ ko: '새로고침', en: 'Refresh' })} onClick={() => void refresh()} disabled={busy}>
        <RefreshCw />
      </IconButton>
      {canOrganize && !browsingAll ? (
        <IconButton variant="ghost" label={t({ ko: '새 폴더', en: 'New folder' })} disabled={busy} onClick={() => setNameDialog({ name: '' })}>
          <FolderPlus />
        </IconButton>
      ) : null}
      {canUpload && !browsingAll ? (
        <Button disabled={busy} onClick={() => uploadInput.current?.click()}>
          <Upload />
          {t({ ko: '업로드', en: 'Upload' })}
        </Button>
      ) : null}
    </>
  )

  const crumb = (label: string, active: boolean, onClick: () => void, first = false) => (
    <span className="inline-flex min-w-0 items-center">
      {first ? null : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
      <Button variant="ghost" size="sm" className={cn('max-w-48 px-2', active && 'font-semibold')} onClick={onClick}>
        <span className="truncate">{label}</span>
      </Button>
    </span>
  )
  const breadcrumbs = (
    <nav aria-label={t({ ko: '현재 경로', en: 'Current path' })} className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
      {canBrowseAll ? crumb(t({ ko: '전체 계정', en: 'All accounts' }), browsingAll, () => openOwner(null), true) : null}
      {browsingAll ? null : crumb(rootLabel, parentId === null, () => navigate(null), !canBrowseAll)}
      {browsingAll ? null : query.data?.breadcrumbs.map((folder, index, all) => (
        <span key={folder.id} className="contents">{crumb(folder.name, index === all.length - 1, () => navigate(folder.id))}</span>
      ))}
    </nav>
  )

  const sidebar = (
    <SidebarNav aria-label={t({ ko: '폴더', en: 'Folders' })}>
      {canBrowseAll ? <SidebarItem icon={Users} label={t({ ko: '전체 계정', en: 'All accounts' })} active={browsingAll} onClick={() => openOwner(null)} /> : null}
      {browsingAll ? null : (
        <>
          <SidebarItem icon={Folder} label={rootLabel} active={parentId === null} onClick={() => navigate(null)} onDragOver={dragOver} onDrop={(event) => drop(event, null)} />
          {folders.map(({ folder, depth }) => (
            <SidebarItem key={folder.id} icon={Folder} depth={depth + 1} label={folder.name} active={folder.id === parentId} onClick={() => navigate(folder.id)} onDragOver={dragOver} onDrop={(event) => drop(event, folder.id)} />
          ))}
        </>
      )}
    </SidebarNav>
  )

  let list
  if (browsingAll) {
    if (ownersQuery.isPending) list = <LoadingState />
    else if (ownersQuery.isError) list = <ErrorState title={t({ ko: '계정 목록을 불러오지 못했어.', en: 'Could not load accounts.' })} error={ownersQuery.error} onRetry={() => void ownersQuery.refetch()} />
    else list = <OwnerList owners={ownersQuery.data} onOpen={openOwner} />
  } else if (query.isPending) {
    list = <LoadingState />
  } else if (query.isError) {
    list = <ErrorState title={t({ ko: '파일을 불러오지 못했어.', en: 'Could not load files.' })} error={query.error} onRetry={() => void query.refetch()} />
  } else if (entries.length === 0) {
    list = <EmptyState icon={Folder} title={t({ ko: '빈 폴더야', en: 'This folder is empty' })} />
  } else if (viewMode === 'grid') {
    // Folders first, as in a file manager; images show their thumbnail.
    const ordered = [...entries].sort((left, right) => (left.kind === right.kind ? 0 : left.kind === 'folder' ? -1 : 1))
    list = (
      <div className={cn('grid gap-1.5', isPicker ? 'grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]')}>
        {ordered.map((entry) => {
          const isSelected = selected.includes(entry.id)
          const canSelect = !isPicker || entry.kind === 'file'
          return (
            <FileTile
              key={entry.id}
              entry={entry}
              owner={storeOwner}
              selected={isSelected}
              showCheckbox={selected.length > 0}
              canSelect={canSelect}
              draggable={canOrganize && !busy && !isPicker}
              onOpen={() => {
                if (entry.kind === 'folder') navigate(entry.id)
                else if (isPicker || selected.length > 0) toggle(entry.id, !isSelected)
                else setPreview(entry)
              }}
              onToggle={(checked) => toggle(entry.id, checked)}
              onDragStart={(event) => {
                event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify(isSelected ? selected : [entry.id]))
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={entry.kind === 'folder' ? dragOver : undefined}
              onDrop={entry.kind === 'folder' ? (event) => drop(event, entry.id) : undefined}
            />
          )
        })}
      </div>
    )
  } else {
    const allSelected = selectable.length > 0 && selectable.every((entry) => selected.includes(entry.id))
    list = (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs text-muted-foreground">
            <tr>
              <th className="w-10 py-3 pr-3">
                <Checkbox aria-label={t({ ko: '전체 선택', en: 'Select all' })} disabled={selectable.length === 0} checked={allSelected} onCheckedChange={(checked) => setSelected(checked ? selectable.map((entry) => entry.id) : [])} />
              </th>
              <th className="py-3 font-normal">{t({ ko: '이름', en: 'Name' })}</th>
              <th className="hidden px-3 font-normal sm:table-cell">{t({ ko: '수정일', en: 'Modified' })}</th>
              <th className="px-3 text-right font-normal">{t({ ko: '크기', en: 'Size' })}</th>
              {isPicker ? null : <th className="w-10"><span className="sr-only">{t({ ko: '다운로드', en: 'Download' })}</span></th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isSelected = selected.includes(entry.id)
              const canSelect = !isPicker || entry.kind === 'file'
              return (
                <tr
                  key={entry.id}
                  className={cn('border-b border-line last:border-0 hover:bg-fill', isSelected && 'bg-fill')}
                  draggable={canOrganize && !busy && !isPicker}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify(isSelected ? selected : [entry.id]))
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={entry.kind === 'folder' ? dragOver : undefined}
                  onDrop={entry.kind === 'folder' ? (event) => drop(event, entry.id) : undefined}
                >
                  <td className="py-2 pr-3">
                    {canSelect ? <Checkbox aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: entry.name })} checked={isSelected} onCheckedChange={(checked) => toggle(entry.id, checked === true)} /> : null}
                  </td>
                  <td className="min-w-40">
                    <Button
                      variant="ghost"
                      className="max-w-full justify-start"
                      onClick={() => {
                        if (entry.kind === 'folder') navigate(entry.id)
                        else if (isPicker) toggle(entry.id, !isSelected)
                        else setPreview(entry)
                      }}
                    >
                      <EntryIcon entry={entry} />
                      <span className="max-w-80 truncate">{entry.name}</span>
                    </Button>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 text-xs text-muted-foreground sm:table-cell">{formatDateTime(entry.updatedAt)}</td>
                  <td className="whitespace-nowrap px-3 text-right text-xs text-muted-foreground">{entry.kind === 'folder' ? '' : formatFileSize(entry.size)}</td>
                  {isPicker ? null : (
                    <td>
                      {entry.kind === 'file' ? (
                        <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}>
                          <a href={storedFileDownloadUrl(entry.id, storeOwner)} download><Download /></a>
                        </IconButton>
                      ) : null}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const pager = !browsingAll && query.data && query.data.total > query.data.limit ? (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => { setOffset((value) => Math.max(0, value - PAGE_SIZE)); setSelected([]) }}>{t({ ko: '이전', en: 'Previous' })}</Button>
      <Button variant="ghost" size="sm" disabled={offset + query.data.limit >= query.data.total} onClick={() => { setOffset((value) => value + PAGE_SIZE); setSelected([]) }}>{t({ ko: '다음', en: 'Next' })}</Button>
    </div>
  ) : null

  const body = (
    <div className="min-h-72 space-y-3" onDragOver={browsingAll ? undefined : dragOver} onDrop={browsingAll ? undefined : (event) => drop(event, parentId)}>
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
          <ModalBody className="space-y-3">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">{breadcrumbs}</div>
              {actions}
            </div>
            {body}
          </ModalBody>
          <ModalFooter>
            <span className="flex-1" />
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
          toolbar={<PageToolbar sticky title={t({ ko: '파일 보관함', en: 'Files' })} start={breadcrumbs} actions={actions} />}
        >
          {body}
        </PageWithSidebar>
      )}

      {isPicker ? null : (
        <SelectionActionBar
          selectedCount={selected.length}
          onClear={() => setSelected([])}
          responsiveActions
          actions={canOrganize || canDelete ? (
            <>
              {canOrganize ? <SelectionBarAction icon={Pencil} label={t({ ko: '이름 변경', en: 'Rename' })} disabled={selection.length !== 1 || busy} onClick={() => setNameDialog({ id: selection[0].id, name: selection[0].name })} /> : null}
              {canOrganize ? <SelectionBarAction icon={FolderInput} label={t({ ko: '이동', en: 'Move' })} disabled={busy} onClick={() => { setMoveTarget(parentId ?? ''); setMoveOpen(true) }} /> : null}
              {canDelete ? <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} variant="destructive" disabled={busy} onClick={() => void remove()} /> : null}
            </>
          ) : null}
        />
      )}

      <Modal open={nameDialog !== null} title={nameDialog?.id ? t({ ko: '이름 변경', en: 'Rename' }) : t({ ko: '새 폴더', en: 'New folder' })} onClose={() => { if (!busy) setNameDialog(null) }} widthClassName="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!nameDialog || busy) return
            const dialog = nameDialog
            mutation.mutate(() => (dialog.id ? renameStoredFile(dialog.id, dialog.name, storeOwner) : createStoredFolder(parentId, dialog.name, storeOwner)))
          }}
        >
          <ModalBody>
            <Input variant="settings" autoFocus aria-label={t({ ko: '이름', en: 'Name' })} value={nameDialog?.name ?? ''} onChange={(event) => setNameDialog((current) => (current ? { ...current, name: event.target.value } : null))} />
          </ModalBody>
          <ModalFooter>
            <span className="flex-1" />
            <Button type="submit" disabled={busy || !nameDialog?.name.trim()}>{t({ ko: '저장', en: 'Save' })}</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={moveOpen} title={t({ ko: '폴더로 이동', en: 'Move to folder' })} onClose={() => { if (!busy) setMoveOpen(false) }} widthClassName="max-w-md">
        <ModalBody>
          <Select variant="settings" aria-label={t({ ko: '대상 폴더', en: 'Destination folder' })} value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)}>
            <option value="">{rootLabel}</option>
            {folders.map(({ folder, path }) => <option key={folder.id} value={folder.id} disabled={selected.includes(folder.id)}>{path}</option>)}
          </Select>
        </ModalBody>
        <ModalFooter>
          <span className="flex-1" />
          <Button disabled={busy} onClick={() => mutation.mutate(() => moveStoredFiles(selected, moveTarget || null, storeOwner))}>{t({ ko: '이동', en: 'Move' })}</Button>
        </ModalFooter>
      </Modal>

      {preview ? <FilePreview entry={preview} owner={storeOwner} onClose={() => setPreview(null)} onNavigate={setPreview} /> : null}
    </>
  )
}

/** Choose stored files to attach (chat). */
export function FilePicker({ onClose, onPick, title, pickLabel, accept, initialParentId = null }: {
  onClose: () => void
  onPick: (entries: StoredFileEntry[]) => void
  title?: string
  pickLabel?: (count: number) => string
  accept?: readonly string[]
  /** The folder it opens in (null: the top). */
  initialParentId?: string | null
}) {
  const { t } = useI18n()
  const [parentId, setParentId] = useState<string | null>(initialParentId)
  return (
    <Modal open title={title ?? t({ ko: '보관함에서 첨부', en: 'Attach from files' })} onClose={onClose} widthClassName="max-w-3xl">
      <FileBrowser key={parentId ?? 'root'} parentId={parentId} onNavigate={setParentId} onPick={onPick} pickLabel={pickLabel} accept={accept} />
    </Modal>
  )
}

import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Download, File, FileText, Film, Folder, FolderInput, FolderPlus, Image as ImageIcon, Music, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
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
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, createStoredFolder, deleteStoredFiles, formatFileSize, listStoredFiles, listStoredFolders, moveStoredFiles, readStoredFileText, renameStoredFile, storedFileDownloadUrl, uploadStoredFiles } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

const FILE_DRAG_TYPE = 'application/x-conai-file-ids'
const PAGE_SIZE = 100
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

function EntryIcon({ entry }: { entry: StoredFileEntry }) {
  if (entry.kind === 'folder') return <Folder className="size-4 shrink-0 text-warning" />
  const kind = mediaKind(entry)
  const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? Film : kind === 'audio' ? Music : (entry.mimeType ?? '').startsWith('text/') ? FileText : File
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

/**
 * The account's private file store: folder tree, list, upload / drag-in, move, rename, delete.
 * With `onPick` it becomes a picker (inside a modal): only files can be chosen and nothing is changed but uploads.
 */
export function FileBrowser({ parentId, onNavigate, onPick }: {
  parentId: string | null
  onNavigate: (id: string | null) => void
  onPick?: (files: StoredFileEntry[]) => void
}) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const auth = useAuthStatusQuery()
  const canManage = auth.data?.permissionKeys?.includes('files.manage') === true
  const isPicker = onPick !== undefined
  const accountKey = auth.data?.accountId ?? (auth.data?.hasCredentials ? 'anonymous' : 'bootstrap')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [preview, setPreview] = useState<StoredFileEntry | null>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'list', parentId, offset], queryFn: () => listStoredFiles(parentId, offset) })
  const foldersQuery = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'folders'], queryFn: listStoredFolders })
  const folders = useMemo(() => folderTree(foldersQuery.data ?? []), [foldersQuery.data])
  const entries = query.data?.entries ?? []
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

  const navigate = (id: string | null) => {
    setSelected([])
    setOffset(0)
    onNavigate(id)
  }
  const toggle = (id: string, checked: boolean) => setSelected((current) => (checked ? [...current, id] : current.filter((entry) => entry !== id)))
  const upload = (files: File[]) => {
    if (canManage && !busy && files.length) mutation.mutate(() => uploadStoredFiles(parentId, files))
  }
  const drop = (event: DragEvent, target: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canManage || busy) return
    const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE)
    if (dragged) {
      try {
        const ids: unknown = JSON.parse(dragged)
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) mutation.mutate(() => moveStoredFiles(ids, target))
      } catch {
        // Ignore unrelated drag payloads.
      }
    } else if (event.dataTransfer.files.length) {
      const files = Array.from(event.dataTransfer.files)
      mutation.mutate(() => uploadStoredFiles(target, files))
    }
  }
  const dragOver = (event: DragEvent) => {
    if (!canManage || busy) return
    event.preventDefault()
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(FILE_DRAG_TYPE) ? 'move' : 'copy'
  }
  const remove = async () => {
    const confirmed = await confirm({
      title: t({ ko: '선택한 항목을 삭제할까?', en: 'Delete selected items?' }),
      description: t({ ko: '원본 파일이 삭제돼. 빈 폴더만 삭제할 수 있고, 채팅에서 참조 중인 파일은 보호돼.', en: 'Original files will be deleted. Folders must be empty; files attached to chats are protected.' }),
      tone: 'destructive',
    })
    if (confirmed) mutation.mutate(() => deleteStoredFiles(selected))
  }

  const actions = (
    <>
      <IconButton variant="ghost" label={t({ ko: '새로고침', en: 'Refresh' })} onClick={() => void refresh()} disabled={busy}>
        <RefreshCw />
      </IconButton>
      {canManage ? (
        <>
          <IconButton variant="ghost" label={t({ ko: '새 폴더', en: 'New folder' })} disabled={busy} onClick={() => setNameDialog({ name: '' })}>
            <FolderPlus />
          </IconButton>
          <Button disabled={busy} onClick={() => uploadInput.current?.click()}>
            <Upload />
            {t({ ko: '업로드', en: 'Upload' })}
          </Button>
        </>
      ) : null}
    </>
  )

  const breadcrumbs = (
    <nav aria-label={t({ ko: '현재 경로', en: 'Current path' })} className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
      <Button variant="ghost" size="sm" className={cn('px-2', parentId === null && 'font-semibold')} onClick={() => navigate(null)}>
        {t({ ko: '내 파일', en: 'My files' })}
      </Button>
      {query.data?.breadcrumbs.map((folder, index, all) => (
        <span key={folder.id} className="inline-flex min-w-0 items-center">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <Button variant="ghost" size="sm" className={cn('max-w-48 px-2', index === all.length - 1 && 'font-semibold')} onClick={() => navigate(folder.id)}>
            <span className="truncate">{folder.name}</span>
          </Button>
        </span>
      ))}
    </nav>
  )

  const sidebar = (
    <SidebarNav aria-label={t({ ko: '폴더', en: 'Folders' })}>
      <SidebarItem icon={Folder} label={t({ ko: '내 파일', en: 'My files' })} active={parentId === null} onClick={() => navigate(null)} onDragOver={dragOver} onDrop={(event) => drop(event, null)} />
      {folders.map(({ folder, depth }) => (
        <SidebarItem key={folder.id} icon={Folder} depth={depth + 1} label={folder.name} active={folder.id === parentId} onClick={() => navigate(folder.id)} onDragOver={dragOver} onDrop={(event) => drop(event, folder.id)} />
      ))}
    </SidebarNav>
  )

  let list
  if (query.isPending) {
    list = <LoadingState />
  } else if (query.isError) {
    list = <ErrorState title={t({ ko: '파일을 불러오지 못했어.', en: 'Could not load files.' })} error={query.error} onRetry={() => void query.refetch()} />
  } else if (entries.length === 0) {
    list = <EmptyState icon={Folder} title={t({ ko: '빈 폴더야', en: 'This folder is empty' })} />
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
                  draggable={canManage && !busy && !isPicker}
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
                          <a href={storedFileDownloadUrl(entry.id)} download><Download /></a>
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

  const pager = query.data && query.data.total > query.data.limit ? (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => { setOffset((value) => Math.max(0, value - PAGE_SIZE)); setSelected([]) }}>{t({ ko: '이전', en: 'Previous' })}</Button>
      <Button variant="ghost" size="sm" disabled={offset + query.data.limit >= query.data.total} onClick={() => { setOffset((value) => value + PAGE_SIZE); setSelected([]) }}>{t({ ko: '다음', en: 'Next' })}</Button>
    </div>
  ) : null

  const body = (
    <div className="min-h-72 space-y-3" onDragOver={dragOver} onDrop={(event) => drop(event, parentId)}>
      <input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { upload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      {list}
      {pager}
    </div>
  )

  const pickedFiles = selection.filter((entry) => entry.kind === 'file')

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
              {pickedFiles.length > 0
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
          actions={canManage ? (
            <>
              <SelectionBarAction icon={Pencil} label={t({ ko: '이름 변경', en: 'Rename' })} disabled={selection.length !== 1 || busy} onClick={() => setNameDialog({ id: selection[0].id, name: selection[0].name })} />
              <SelectionBarAction icon={FolderInput} label={t({ ko: '이동', en: 'Move' })} disabled={busy} onClick={() => { setMoveTarget(parentId ?? ''); setMoveOpen(true) }} />
              <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} variant="destructive" disabled={busy} onClick={() => void remove()} />
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
            mutation.mutate(() => (dialog.id ? renameStoredFile(dialog.id, dialog.name) : createStoredFolder(parentId, dialog.name)))
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
            <option value="">{t({ ko: '내 파일', en: 'My files' })}</option>
            {folders.map(({ folder, path }) => <option key={folder.id} value={folder.id} disabled={selected.includes(folder.id)}>{path}</option>)}
          </Select>
        </ModalBody>
        <ModalFooter>
          <span className="flex-1" />
          <Button disabled={busy} onClick={() => mutation.mutate(() => moveStoredFiles(selected, moveTarget || null))}>{t({ ko: '이동', en: 'Move' })}</Button>
        </ModalFooter>
      </Modal>

      {preview ? <FilePreview entry={preview} onClose={() => setPreview(null)} /> : null}
    </>
  )
}

/** Images, video and audio play from the download URL; other files are read as text, page by page. */
function FilePreview({ entry, onClose }: { entry: StoredFileEntry; onClose: () => void }) {
  const { t } = useI18n()
  const [offset, setOffset] = useState(0)
  const kind = mediaKind(entry)
  const url = storedFileDownloadUrl(entry.id)
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, 'text', entry.id, offset], queryFn: () => readStoredFileText(entry.id, offset), retry: false, enabled: kind === 'other' })

  let content
  if (kind === 'image') {
    content = <img src={url} alt={entry.name} className="mx-auto max-h-[65vh] max-w-full rounded-sm object-contain" />
  } else if (kind === 'video') {
    content = <video src={url} controls className="mx-auto max-h-[65vh] max-w-full rounded-sm" />
  } else if (kind === 'audio') {
    content = <audio src={url} controls className="w-full" />
  } else if (query.isPending) {
    content = <LoadingState />
  } else if (query.isError) {
    content = <EmptyState icon={File} title={t({ ko: '미리 볼 수 없는 파일이야', en: 'No preview for this file' })} />
  } else {
    content = <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-low p-3 font-mono text-xs leading-relaxed">{query.data.text}</pre>
  }

  return (
    <Modal open title={entry.name} onClose={onClose} widthClassName="max-w-4xl">
      <ModalBody>{content}</ModalBody>
      <ModalFooter>
        <span className="flex-1 truncate text-xs text-muted-foreground">{formatFileSize(entry.size)}{entry.mimeType ? ` · ${entry.mimeType}` : ''}</span>
        {kind === 'other' && offset > 0 ? <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>{t({ ko: '처음', en: 'Beginning' })}</Button> : null}
        {kind === 'other' && query.data?.nextOffset != null ? <Button variant="secondary" size="sm" onClick={() => setOffset(query.data?.nextOffset ?? 0)}>{t({ ko: '다음 부분', en: 'Next part' })}</Button> : null}
        <IconButton asChild variant="secondary" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}>
          <a href={url} download><Download /></a>
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}

/** Choose stored files to attach (chat). */
export function FilePicker({ onClose, onPick }: { onClose: () => void; onPick: (entries: StoredFileEntry[]) => void }) {
  const { t } = useI18n()
  const [parentId, setParentId] = useState<string | null>(null)
  return (
    <Modal open title={t({ ko: '보관함에서 첨부', en: 'Attach from files' })} onClose={onClose} widthClassName="max-w-3xl">
      <FileBrowser key={parentId ?? 'root'} parentId={parentId} onNavigate={setParentId} onPick={onPick} />
    </Modal>
  )
}

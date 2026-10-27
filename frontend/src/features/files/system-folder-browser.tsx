import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Clock, Download, File, Folder, LayoutGrid, List, Lock, RefreshCw, RotateCcw, Save, ScrollText, Trash2, Upload } from 'lucide-react'
import type { SystemFolderEntry, SystemFolderRootId } from '@conai/shared'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
import { MediaCard } from '@/components/common/media-card'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { SidebarGroupLabel, SidebarItem } from '@/components/ui/sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { DataCheckTd, DataCheckTh, DataTable, DataTd, DataTh, DataTr } from '@/components/ui/data-table'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/format-size'
import {
  SYSTEM_FOLDERS_QUERY_KEY,
  SYSTEM_FOLDER_PAGE_SIZE,
  deleteRecycleBinFiles,
  emptyRecycleBin,
  listSystemFolder,
  listSystemFolderRoots,
  restoreRecycleBinFiles,
  systemFolderDownloadUrl,
  systemFolderThumbnailUrl,
  systemFolderViewUrl,
} from '@/lib/api-system-folders'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { useFileViewMode } from './file-view-mode'
import { FileEntryIcon as EntryIcon, FileMediaPreview, FilePreviewNavigation, fileMediaKind as mediaKind, filePreviewKind, readFilePreviewMime } from './file-preview-shared'
import { ListPager } from '@/components/common/list-pager'

const FileCodePreview = lazy(() => import('./file-code-preview'))

/** A server folder (root) and a `/`-separated path inside it. */
export type SystemFolderLocation = { root: SystemFolderRootId; path: string }

type Translate = ReturnType<typeof useI18n>['t']

const ROOTS: Array<{ id: SystemFolderRootId; icon: typeof Trash2; label: { ko: string; en: string } }> = [
  { id: 'recycle-bin', icon: Trash2, label: { ko: '휴지통', en: 'Recycle bin' } },
  { id: 'uploads', icon: Upload, label: { ko: '업로드', en: 'Uploads' } },
  { id: 'save', icon: Save, label: { ko: '저장', en: 'Save' } },
  { id: 'temp', icon: Clock, label: { ko: '임시', en: 'Temp' } },
  { id: 'logs', icon: ScrollText, label: { ko: '로그', en: 'Logs' } },
]

const rootLabel = (root: SystemFolderRootId, t: Translate) => t(ROOTS.find((item) => item.id === root)?.label ?? { ko: root, en: root })

function sourceLabel(source: string | null, t: Translate) {
  if (source === 'library') return t({ ko: '라이브러리', en: 'Library' })
  if (source === 'metadata-edit') return t({ ko: '메타데이터 편집', en: 'Metadata edit' })
  if (source === 'audio') return t({ ko: '오디오', en: 'Audio' })
  if (source?.startsWith('workflow-')) return t({ ko: '워크플로 정리', en: 'Workflow cleanup' })
  return null
}

/** Thumbnail for images and videos, the type icon otherwise (or when the preview fails). */
function EntryThumb({ root, entry, className, iconClassName }: { root: SystemFolderRootId; entry: SystemFolderEntry; className: string; iconClassName?: string }) {
  const [failed, setFailed] = useState(false)
  const showThumb = entry.kind === 'file' && ['image', 'video'].includes(mediaKind(entry)) && entry.mimeType !== 'image/svg+xml' && !failed
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-low', className)}>
      {showThumb
        ? <img src={systemFolderThumbnailUrl(root, entry.path)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="size-full object-cover" />
        : <EntryIcon entry={entry} className={iconClassName} />}
    </span>
  )
}

/** Shown name: the original file name for RecycleBin items, the plain name elsewhere. */
const displayName = (entry: SystemFolderEntry) => entry.recycle?.originalName ?? entry.name

/** Administrator-only "서버 폴더" rows under the file store's folder tree. */
export function SystemFolderSidebarGroup({ active, onOpen }: { active: SystemFolderRootId | null; onOpen: (root: SystemFolderRootId) => void }) {
  const { t } = useI18n()
  const roots = useQuery({ queryKey: [...SYSTEM_FOLDERS_QUERY_KEY, 'roots'], queryFn: listSystemFolderRoots })
  const binCount = useQuery({
    queryKey: [...SYSTEM_FOLDERS_QUERY_KEY, 'list', 'recycle-bin', '', 'count'],
    queryFn: () => listSystemFolder('recycle-bin', '', 0, 1),
    enabled: roots.data?.some((root) => root.id === 'recycle-bin' && root.available) === true,
  })
  const known = new Set(roots.data?.map((root) => root.id) ?? [])
  return (
    <>
      <SidebarGroupLabel>{t({ ko: '서버 폴더', en: 'Server folders' })}</SidebarGroupLabel>
      {ROOTS.filter((root) => !roots.data || known.has(root.id)).map((root) => (
        <SidebarItem
          key={root.id}
          icon={root.icon}
          label={t(root.label)}
          count={root.id === 'recycle-bin' && binCount.data ? binCount.data.total.toLocaleString() : undefined}
          active={active === root.id}
          onClick={() => onOpen(root.id)}
        />
      ))}
    </>
  )
}

/**
 * One server folder: read-only browsing for uploads / save / temp / logs, and for the RecycleBin restore, permanent
 * delete and empty. `sidebar` is the file store's sidebar, so moving between the store and server folders keeps
 * the same column.
 */
export function SystemFolderBrowser({ location, onNavigate, sidebar }: {
  location: SystemFolderLocation
  onNavigate: (location: SystemFolderLocation) => void
  sidebar: ReactNode
}) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { root, path } = location
  const isBin = root === 'recycle-bin' && path === ''
  const [viewMode, changeViewMode] = useFileViewMode(isBin ? 'recycle-bin' : 'files')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [preview, setPreview] = useState<SystemFolderEntry | null>(null)
  const [conflicts, setConflicts] = useState<SystemFolderEntry[]>([])
  const query = useQuery({ queryKey: [...SYSTEM_FOLDERS_QUERY_KEY, 'list', root, path, offset], queryFn: () => listSystemFolder(root, path, offset) })
  const entries = query.data?.entries ?? []
  const files = entries.filter((entry) => entry.kind === 'file')
  const selection = entries.filter((entry) => selected.includes(entry.name))
  const refresh = () => queryClient.invalidateQueries({ queryKey: SYSTEM_FOLDERS_QUERY_KEY })

  const mutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSuccess: async () => {
      setSelected([])
      await refresh()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '휴지통 작업에 실패했어.', en: 'Recycle bin action failed.' })) }),
  })
  const busy = mutation.isPending

  const navigate = (next: SystemFolderLocation) => {
    setSelected([])
    setOffset(0)
    onNavigate(next)
  }
  const toggle = (name: string, checked: boolean) => setSelected((current) => (checked ? [...current, name] : current.filter((entry) => entry !== name)))
  const open = (entry: SystemFolderEntry) => {
    if (entry.kind === 'folder') navigate({ root, path: entry.path })
    else if (isBin && selected.length > 0) toggle(entry.name, !selected.includes(entry.name))
    else setPreview(entry)
  }

  const restore = (targets: SystemFolderEntry[], conflict: 'fail' | 'rename') => mutation.mutate(async () => {
    const result = await restoreRecycleBinFiles(targets.map((entry) => entry.name), conflict)
    const conflicting = result.failed.filter((item) => item.code === 'conflict').map((item) => item.name)
    const otherFailure = result.failed.find((item) => item.code !== 'conflict')
    setConflicts(targets.filter((entry) => conflicting.includes(entry.name)))
    if (result.done.length > 0) showSnackbar({ tone: 'info', message: t({ ko: '{count}개 복원했어.', en: 'Restored {count}.' }, { count: result.done.length }) })
    const warning = result.done.find((item) => item.warning)?.warning
    if (warning) showSnackbar({ tone: 'error', message: warning })
    if (otherFailure) showSnackbar({ tone: 'error', message: otherFailure.error })
  })
  const removeForever = async (targets: SystemFolderEntry[]) => {
    const confirmed = await confirm({
      title: t({ ko: '{count}개를 영구 삭제할까?', en: 'Delete {count} permanently?' }, { count: targets.length }),
      confirmLabel: t({ ko: '영구 삭제', en: 'Delete permanently' }),
      tone: 'destructive',
    })
    if (!confirmed) return
    mutation.mutate(async () => {
      const result = await deleteRecycleBinFiles(targets.map((entry) => entry.name))
      if (result.failed.length > 0) showSnackbar({ tone: 'error', message: result.failed[0].error })
    })
  }
  const empty = async () => {
    const confirmed = await confirm({
      title: t({ ko: '휴지통을 비울까?', en: 'Empty the recycle bin?' }),
      confirmLabel: t({ ko: '비우기', en: 'Empty' }),
      tone: 'destructive',
    })
    if (!confirmed) return
    mutation.mutate(async () => {
      const result = await emptyRecycleBin()
      if (result.failed > 0) showSnackbar({ tone: 'error', message: t({ ko: '{count}개는 지우지 못했어.', en: 'Could not delete {count}.' }, { count: result.failed }) })
    })
  }

  const crumb = (label: string, active: boolean, onClick: () => void, first = false) => (
    <span className="inline-flex min-w-0 items-center">
      {first ? null : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
      <Button variant="ghost" size="sm" className="max-w-48" aria-current={active ? 'location' : undefined} onClick={onClick}>
        <span className="truncate">{label}</span>
      </Button>
    </span>
  )
  const breadcrumbs = (
    <nav aria-label={t({ ko: '현재 경로', en: 'Current path' })} className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
      {crumb(rootLabel(root, t), path === '', () => navigate({ root, path: '' }), true)}
      {query.data?.breadcrumbs.map((item, index, all) => (
        <span key={item.path} className="contents">{crumb(item.name, index === all.length - 1, () => navigate({ root, path: item.path }))}</span>
      ))}
      {root === 'recycle-bin' ? null : (
        <span className="ml-1 inline-flex items-center gap-1 text-2xs text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          {t({ ko: '읽기 전용', en: 'Read-only' })}
        </span>
      )}
    </nav>
  )

  const actions = (
    <>
      <SegmentedControl
        size="xs"
        value={viewMode}
        onChange={(value) => changeViewMode(value === 'grid' ? 'grid' : 'list')}
        ariaLabel={t({ ko: '보기', en: 'View' })}
        items={[
          { value: 'list', label: <List className="size-3.5" />, ariaLabel: t({ ko: '자세히 보기', en: 'Details' }) },
          { value: 'grid', label: <LayoutGrid className="size-3.5" />, ariaLabel: t({ ko: '아이콘 보기', en: 'Icons' }) },
        ]}
      />
      <IconButton variant="ghost" label={t({ ko: '새로고침', en: 'Refresh' })} onClick={() => void refresh()} disabled={busy}>
        <RefreshCw />
      </IconButton>
      {isBin ? (
        <IconButton variant="destructive-ghost" label={t({ ko: '휴지통 비우기', en: 'Empty recycle bin' })} onClick={() => void empty()} disabled={busy || entries.length === 0}>
          <Trash2 />
        </IconButton>
      ) : null}
    </>
  )

  const restoreButton = (entry: SystemFolderEntry) => (
    <IconButton
      variant="ghost"
      size="icon-sm"
      label={entry.recycle?.restorable ? t({ ko: '복원', en: 'Restore' }) : t({ ko: '원래 위치 기록이 없어', en: 'No recorded location' })}
      disabled={busy || !entry.recycle?.restorable}
      onClick={() => restore([entry], 'fail')}
    >
      <RotateCcw />
    </IconButton>
  )
  const deleteButton = (entry: SystemFolderEntry) => (
    <IconButton variant="destructive-ghost" size="icon-sm" label={t({ ko: '영구 삭제', en: 'Delete permanently' })} disabled={busy} onClick={() => void removeForever([entry])}>
      <Trash2 />
    </IconButton>
  )
  const downloadButton = (entry: SystemFolderEntry) => (
    <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}>
      <a href={systemFolderDownloadUrl(root, entry.path)} download><Download /></a>
    </IconButton>
  )

  let list
  if (query.isPending) {
    list = <LoadingState />
  } else if (query.isError) {
    // A RecycleBin nothing was deleted into yet does not exist on disk: that is just empty.
    list = root === 'recycle-bin' && path === '' && /아직 없어|not exist/i.test(getErrorMessage(query.error, ''))
      ? <EmptyState icon={Trash2} title={t({ ko: '휴지통이 비어 있어', en: 'The recycle bin is empty' })} />
      : <ErrorState title={t({ ko: '폴더를 불러오지 못했어.', en: 'Could not load the folder.' })} error={query.error} onRetry={() => void query.refetch()} />
  } else if (entries.length === 0) {
    list = isBin
      ? <EmptyState icon={Trash2} title={t({ ko: '휴지통이 비어 있어', en: 'The recycle bin is empty' })} />
      : <EmptyState icon={Folder} title={t({ ko: '빈 폴더야', en: 'This folder is empty' })} />
  } else if (viewMode === 'grid') {
    list = (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
        {entries.map((entry) => {
          const isSelected = selected.includes(entry.name)
          return (
            <div key={entry.path} title={displayName(entry)} className="group relative min-w-0">
              <MediaCard
                onClick={() => open(entry)}
                title={<span className="line-clamp-2 whitespace-normal wrap-anywhere">{displayName(entry)}</span>}
                selected={isSelected}
                className="w-full"
                mediaClassName="aspect-square w-full"
                media={<EntryThumb root={root} entry={entry} className="size-full" iconClassName="size-9" />}
                meta={entry.kind === 'file' ? formatFileSize(entry.size) : undefined}
              />
              {isBin && entry.kind === 'file' ? (
                <span className={cn('absolute left-2.5 top-2.5 rounded-sm bg-background/80 p-0.5 transition-opacity', isSelected || selected.length > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                  <Checkbox aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: displayName(entry) })} checked={isSelected} onCheckedChange={(checked) => toggle(entry.name, checked === true)} />
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  } else if (isBin) {
    const allSelected = files.length > 0 && files.every((entry) => selected.includes(entry.name))
    list = (
      <DataTable
        head={(
          <>
            <DataCheckTh>
              <Checkbox aria-label={t({ ko: '전체 선택', en: 'Select all' })} disabled={files.length === 0} checked={allSelected} onCheckedChange={(checked) => setSelected(checked ? files.map((entry) => entry.name) : [])} />
            </DataCheckTh>
            <DataTh>{t({ ko: '이름', en: 'Name' })}</DataTh>
            <DataTh className="hidden md:table-cell">{t({ ko: '원래 위치', en: 'Original location' })}</DataTh>
            <DataTh className="hidden lg:table-cell">{t({ ko: '삭제한 곳', en: 'Deleted by' })}</DataTh>
            <DataTh className="hidden sm:table-cell">{t({ ko: '삭제일', en: 'Deleted' })}</DataTh>
            <DataTh className="hidden text-right sm:table-cell">{t({ ko: '크기', en: 'Size' })}</DataTh>
            <DataTh className="w-20"><span className="sr-only">{t({ ko: '작업', en: 'Actions' })}</span></DataTh>
          </>
        )}
      >
        {entries.map((entry) => {
          const isSelected = selected.includes(entry.name)
          const recycle = entry.recycle
          return (
            <DataTr interactive key={entry.path} selected={isSelected}>
              <DataCheckTd>
                {entry.kind === 'file' ? <Checkbox aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: displayName(entry) })} checked={isSelected} onCheckedChange={(checked) => toggle(entry.name, checked === true)} /> : null}
              </DataCheckTd>
              {/* w-full + max-w-0: the name takes the free width and truncates instead of widening the table. */}
              <DataTd flush className="w-full max-w-0">
                <Button variant="ghost" className="max-w-full justify-start" title={entry.name} onClick={() => open(entry)}>
                  <EntryThumb root={root} entry={entry} className="size-7" />
                  <span className="truncate">{displayName(entry)}</span>
                </Button>
              </DataTd>
              <DataTd meta flush className="hidden max-w-56 md:table-cell" title={recycle?.originalPath ?? undefined}>
                {/* Right-to-left clipping keeps the file end of a long path visible. */}
                <span className="block truncate [direction:rtl] text-left">{recycle?.originalPath ?? '—'}</span>
              </DataTd>
              <DataTd meta flush className="hidden lg:table-cell">{sourceLabel(recycle?.source ?? null, t) ?? '—'}</DataTd>
              <DataTd meta flush className="hidden sm:table-cell">{formatDateTime(recycle?.deletedAt ?? entry.modifiedAt)}</DataTd>
              <DataTd meta flush className="hidden text-right sm:table-cell">{entry.kind === 'folder' ? '' : formatFileSize(entry.size)}</DataTd>
              <DataTd flush className="whitespace-nowrap text-right">
                {entry.kind === 'file' ? <>{restoreButton(entry)}{deleteButton(entry)}</> : null}
              </DataTd>
            </DataTr>
          )
        })}
      </DataTable>
    )
  } else {
    list = (
      <DataTable
        head={(
          <>
            <DataTh>{t({ ko: '이름', en: 'Name' })}</DataTh>
            <DataTh className="hidden sm:table-cell">{t({ ko: '수정일', en: 'Modified' })}</DataTh>
            <DataTh className="text-right">{t({ ko: '크기', en: 'Size' })}</DataTh>
            <DataTh className="w-10"><span className="sr-only">{t({ ko: '다운로드', en: 'Download' })}</span></DataTh>
          </>
        )}
      >
        {entries.map((entry) => (
          <DataTr interactive key={entry.path}>
            <DataTd flush className="w-full max-w-0">
              <Button variant="ghost" className="max-w-full justify-start" title={entry.name} onClick={() => open(entry)}>
                <EntryIcon entry={entry} />
                <span className="truncate">{entry.name}</span>
              </Button>
            </DataTd>
            <DataTd meta flush className="hidden sm:table-cell">{entry.kind === 'folder' ? '' : formatDateTime(entry.modifiedAt)}</DataTd>
            <DataTd meta flush className="text-right">{entry.kind === 'folder' ? '' : formatFileSize(entry.size)}</DataTd>
            <DataTd flush>{entry.kind === 'file' ? downloadButton(entry) : null}</DataTd>
          </DataTr>
        ))}
      </DataTable>
    )
  }

  const pager = query.data ? (
    <ListPager
      hasPrevious={offset > 0}
      hasNext={offset + query.data.limit < query.data.total}
      onPrevious={() => { setOffset((value) => Math.max(0, value - SYSTEM_FOLDER_PAGE_SIZE)); setSelected([]) }}
      onNext={() => { setOffset((value) => value + SYSTEM_FOLDER_PAGE_SIZE); setSelected([]) }}
    />
  ) : null

  const restorable = selection.filter((entry) => entry.recycle?.restorable)

  return (
    <>
      <PageWithSidebar
        storageKey="files"
        sidebarLabel={t({ ko: '파일 보관함', en: 'Files' })}
        sidebar={sidebar}
        toolbar={<PageToolbar sticky start={breadcrumbs} actions={actions} />}
      >
        <div className="min-h-72 space-y-3">
          {list}
          {pager}
        </div>
      </PageWithSidebar>

      {isBin ? (
        <SelectionActionBar
          selectedCount={selected.length}
          onClear={() => setSelected([])}
          responsiveActions
          actions={(
            <>
              <SelectionBarAction icon={RotateCcw} label={t({ ko: '복원', en: 'Restore' })} disabled={busy || restorable.length === 0} onClick={() => restore(restorable, 'fail')} />
              <SelectionBarAction icon={Trash2} label={t({ ko: '영구 삭제', en: 'Delete permanently' })} variant="destructive" disabled={busy} onClick={() => void removeForever(selection)} />
            </>
          )}
        />
      ) : null}

      <Modal open={conflicts.length > 0} title={t({ ko: '원래 자리에 같은 이름 파일이 있어', en: 'A file with the same name is already there' })} onClose={() => { if (!busy) setConflicts([]) }} size="sm">
        <ModalBody>
          <ul className="max-h-72 overflow-y-auto">
            {conflicts.map((entry) => (
              <li key={entry.name} className="flex items-center gap-2.5 border-b border-line py-3 last:border-0">
                <EntryThumb root={root} entry={entry} className="size-9" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{displayName(entry)}</span>
                  <span className="block truncate text-xs text-muted-foreground" title={entry.recycle?.originalPath ?? undefined}>{entry.recycle?.originalPath}</span>
                </span>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <span className="flex-1" />
          <Button variant="ghost" disabled={busy} onClick={() => setConflicts([])}>{t({ ko: '건너뛰기', en: 'Skip' })}</Button>
          <Button disabled={busy} onClick={() => { const targets = conflicts; setConflicts([]); restore(targets, 'rename') }}>{t({ ko: '이름 바꿔서 복원', en: 'Restore with a new name' })}</Button>
        </ModalFooter>
      </Modal>

      {preview ? <SystemFilePreview root={root} entry={preview} files={files} onClose={() => setPreview(null)} onNavigate={setPreview} /> : null}
    </>
  )
}

/** Bytes of a text file shown in the preview (first part only). */
const TEXT_PREVIEW_BYTES = 256 * 1024

/** Preview of one server-folder file; arrows move through the files on the current page. */
function SystemFilePreview({ root, entry, files, onClose, onNavigate }: {
  root: SystemFolderRootId
  entry: SystemFolderEntry
  files: SystemFolderEntry[]
  onClose: () => void
  onNavigate: (entry: SystemFolderEntry) => void
}) {
  const { t } = useI18n()
  const index = files.findIndex((file) => file.path === entry.path)
  const previous = index > 0 ? files[index - 1] : null
  const next = index >= 0 && index < files.length - 1 ? files[index + 1] : null
  return (
    <Modal open title={displayName(entry)} onClose={onClose} size="xl" headerContent={(
      <div className="flex items-center gap-1">
        <FilePreviewNavigation previous={previous} next={next} onNavigate={onNavigate} />
        <span className="flex-1 text-xs text-muted-foreground">{formatFileSize(entry.size)}</span>
        <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}><a href={systemFolderDownloadUrl(root, entry.path)} download><Download /></a></IconButton>
      </div>
    )}>
      <SystemFilePreviewContent key={entry.path} root={root} entry={entry} />
    </Modal>
  )
}

function SystemFilePreviewContent({ root, entry }: { root: SystemFolderRootId; entry: SystemFolderEntry }) {
  const { t } = useI18n()
  const [mediaFailed, setMediaFailed] = useState(false)
  const url = systemFolderViewUrl(root, entry.path)
  const extension = entry.name.split('.').at(-1)?.toLowerCase() ?? ''
  // The server decides the safe inline type; the extension is only a hint.
  const mime = useQuery({
    queryKey: [...SYSTEM_FOLDERS_QUERY_KEY, 'view-type', root, entry.path, entry.modifiedAt],
    queryFn: () => readFilePreviewMime(url),
    retry: false,
  })
  const kind = filePreviewKind(mime.data)
  const text = useQuery({
    queryKey: [...SYSTEM_FOLDERS_QUERY_KEY, 'text', root, entry.path, entry.modifiedAt],
    queryFn: async () => {
      const response = await fetch(url, { credentials: 'include', headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } })
      if (!response.ok) throw new Error('No preview')
      return response.text()
    },
    enabled: kind === 'text',
    retry: false,
  })
  const unavailable = <EmptyState icon={File} title={t({ ko: '미리 볼 수 없는 파일이야', en: 'No preview for this file' })} />
  let content
  if (mime.isPending) content = <LoadingState />
  else if (mime.isError || mediaFailed || kind === null) content = unavailable
  else if (kind !== 'text') content = <FileMediaPreview kind={kind} url={url} name={entry.name} onError={() => setMediaFailed(true)} />
  else if (text.isPending) content = <LoadingState />
  else if (text.isError) content = unavailable
  else content = <FileCodePreview text={text.data} extension={extension} wrap firstLine={1} />
  return <ModalBody><Suspense fallback={<LoadingState />}>{content}</Suspense></ModalBody>
}

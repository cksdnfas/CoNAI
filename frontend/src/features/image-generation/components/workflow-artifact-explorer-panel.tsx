import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { VirtuosoGrid } from 'react-virtuoso'
import { ArrowLeft, Download, File, FileAudio, FileText, FileVideo, Folder, ImageIcon, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MediaCard } from '@/components/common/media-card'
import { SearchField } from '@/components/common/search-field'
import { CodeBlock } from '@/components/ui/code-block'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Modal } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { useImageListColumnCount } from '@/features/images/components/image-list/use-image-list-column-count'
import { triggerBrowserDownload } from '@/lib/api-client'
import type { WorkflowArtifactEntry } from '@/lib/api-image-generation-types'
import { getGenerationWorkflowArtifacts } from '@/lib/api-image-generation-workflows'
import { getPublicGenerationWorkflowArtifacts } from '@/lib/api-public-workflows'
import { cn } from '@/lib/utils'
import { FLOATING_DROPDOWN_MENU_CLASS } from './floating-dropdown-utils'
import { getErrorMessage } from '../image-generation-shared'
import { formatFileSize } from '@/lib/format-size'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type WorkflowArtifactExplorerPanelProps = {
  workflowId: number
  publicWorkflowSlug?: string | null
  refreshNonce?: number
  splitPaneScroll?: boolean
  onBack?: () => void
}

function getParentPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function getPreviewKind(entry: WorkflowArtifactEntry) {
  const mimeType = entry.mimeType ?? ''
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('text/') || mimeType.includes('json')) return 'text'
  return 'file'
}

function isTextPreviewEntry(entry: WorkflowArtifactEntry) {
  const extension = entry.name.split('.').pop()?.toLowerCase()
  return getPreviewKind(entry) === 'text' || extension === 'toml' || extension === 'yaml' || extension === 'yml' || extension === 'md'
}

function ArtifactFileIcon({ entry }: { entry: WorkflowArtifactEntry }) {
  const previewKind = getPreviewKind(entry)
  if (previewKind === 'image') return <ImageIcon className="h-9 w-9 text-info" />
  if (previewKind === 'video') return <FileVideo className="h-9 w-9 text-secondary-text" />
  if (previewKind === 'audio') return <FileAudio className="h-9 w-9 text-success" />
  if (previewKind === 'text') return <FileText className="h-9 w-9 text-warning" />
  return <File className="h-9 w-9 text-muted-foreground" />
}

function FolderThumbnail({ entry }: { entry: WorkflowArtifactEntry }) {
  return (
    <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-sm bg-surface-container">
      {entry.thumbnailUrl ? (
        <img src={entry.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <ImageIcon className="h-9 w-9 text-muted-foreground/50" />
      )}
      <div className="absolute right-2 bottom-2 rounded-sm bg-warning-soft p-1.5 text-warning-soft-foreground shadow-elevation-1">
        <Folder className="h-5 w-5" />
      </div>
    </div>
  )
}

function FileThumbnail({ entry }: { entry: WorkflowArtifactEntry }) {
  const previewKind = getPreviewKind(entry)

  return (
    <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-sm bg-surface-container">
      {previewKind === 'image' && entry.fileUrl ? (
        <img src={entry.fileUrl} alt={entry.name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <ArtifactFileIcon entry={entry} />
      )}
    </div>
  )
}

type HoverPreviewState = {
  entry: WorkflowArtifactEntry
  x: number
  y: number
}

type ArtifactModalState =
  | { kind: 'image'; entry: WorkflowArtifactEntry }
  | { kind: 'text'; entry: WorkflowArtifactEntry; content: string; isLoading: boolean; error?: string }

function ArtifactCard({
  entry,
  onOpenDirectory,
  onHoverPreviewChange,
  onOpenFile,
}: {
  entry: WorkflowArtifactEntry
  onOpenDirectory: (path: string) => void
  onHoverPreviewChange: (preview: HoverPreviewState | null) => void
  onOpenFile: (entry: WorkflowArtifactEntry) => void
}) {
  const { t, formatDateTime } = useI18n()
  const isDirectory = entry.kind === 'directory'
  const canHoverPreview = !isDirectory && getPreviewKind(entry) === 'image' && Boolean(entry.fileUrl)
  const updateHoverPreview = (event: MouseEvent) => {
    if (!canHoverPreview) {
      return
    }
    onHoverPreviewChange({ entry, x: event.clientX, y: event.clientY })
  }
  const cardBody = (
    <>
      <div className="min-w-0 text-center whitespace-normal">
        <div className="line-clamp-2 break-words text-xs font-medium text-foreground" title={entry.name}>{entry.name}</div>
        <div className="mt-1 text-2xs text-muted-foreground">{isDirectory ? t({ ko: '폴더', en: 'Folder' }) : entry.size > 0 ? formatFileSize(entry.size) : '—'}</div>
        <div className="text-2xs text-muted-foreground/80">{formatDateTime(entry.modifiedAt)}</div>
      </div>
    </>
  )

  return (
    <div
      className="group relative"
      onMouseEnter={updateHoverPreview}
      onMouseMove={updateHoverPreview}
      onMouseLeave={() => onHoverPreviewChange(null)}
    >
      {isDirectory || entry.fileUrl ? (
        <MediaCard
          type="button"
          className="w-full"
          media={isDirectory ? <FolderThumbnail entry={entry} /> : <FileThumbnail entry={entry} />}
          mediaClassName="h-28 w-full"
          title={cardBody}
          onClick={() => (isDirectory ? onOpenDirectory(entry.relativePath) : onOpenFile(entry))}
        />
      ) : (
        <div>
          {isDirectory ? <FolderThumbnail entry={entry} /> : <FileThumbnail entry={entry} />}
          <div className="pt-2">{cardBody}</div>
        </div>
      )}

      {entry.downloadUrl ? (
        <span className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton size="icon-xs" variant="overlay" label={t({ ko: '{name} 다운로드', en: 'Download {name}' }, { name: entry.name })} onClick={(event) => {
            event.stopPropagation()
            triggerBrowserDownload(entry.downloadUrl!, isDirectory ? `${entry.name}.zip` : entry.name)
          }}>
            <Download className="h-3 w-3" />
          </IconButton>
        </span>
      ) : null}
    </div>
  )
}

export function WorkflowArtifactExplorerPanel({ workflowId, publicWorkflowSlug = null, refreshNonce = 0, splitPaneScroll = false, onBack }: WorkflowArtifactExplorerPanelProps) {
  const { t } = useI18n()
  const [currentPath, setCurrentPath] = useState('')
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const [artifactModal, setArtifactModal] = useState<ArtifactModalState | null>(null)
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim())
  const activeSearch = search.trim() ? debouncedSearch : ''
  const [refreshVersion, setRefreshVersion] = useState(0)
  const refreshNext = useRef(false)
  const snapshotRef = useRef<{ scope: string; id: string | null } | null>(null)
  const snapshotScope = JSON.stringify([publicWorkflowSlug, workflowId, currentPath, refreshNonce, refreshVersion])
  const columnCount = useImageListColumnCount(scrollContainer, 152, 16)
  const artifactsQuery = useInfiniteQuery({
    queryKey: ['workflow-artifacts', publicWorkflowSlug ?? 'private', workflowId, currentPath, refreshNonce, refreshVersion, activeSearch],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (snapshotRef.current?.scope !== snapshotScope) snapshotRef.current = { scope: snapshotScope, id: null }
      const refresh = pageParam === null && refreshNext.current
      if (refresh) refreshNext.current = false
      const params = { limit: 60, search: activeSearch, cursor: pageParam, snapshot: !refresh && pageParam === null ? snapshotRef.current.id : undefined, refresh }
      const page = await (publicWorkflowSlug
        ? getPublicGenerationWorkflowArtifacts(publicWorkflowSlug, currentPath, params)
        : getGenerationWorkflowArtifacts(workflowId, currentPath, params))
      if (snapshotRef.current?.scope === snapshotScope) snapshotRef.current.id = page.snapshot
      return page
    },
    getNextPageParam: (page) => page.nextCursor,
    gcTime: 0,
    refetchOnWindowFocus: false,
    enabled: search.trim() === activeSearch,
  })

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean)
    return [
      { label: t('image-generation.components.workflow.artifact.explorer.panel.explorer.view'), path: '' },
      ...parts.map((part, index) => ({
        label: part,
        path: parts.slice(0, index + 1).join('/'),
      })),
    ]
  }, [currentPath, t])

  const entries = (artifactsQuery.data?.pages ?? []).flatMap((page) => page.entries)
  const hoverPreviewStyle = hoverPreview
    ? {
        left: Math.min(hoverPreview.x + 18, Math.max(16, window.innerWidth - 304)),
        top: Math.min(hoverPreview.y + 18, Math.max(16, window.innerHeight - 328)),
      }
    : undefined

  const handleOpenFile = async (entry: WorkflowArtifactEntry) => {
    const previewKind = getPreviewKind(entry)
    if (previewKind === 'image') {
      setArtifactModal({ kind: 'image', entry })
      return
    }

    if (isTextPreviewEntry(entry) && entry.fileUrl) {
      setArtifactModal({ kind: 'text', entry, content: '', isLoading: true })
      try {
        const response = await fetch(entry.fileUrl)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const content = await response.text()
        setArtifactModal({ kind: 'text', entry, content, isLoading: false })
      } catch (error) {
        setArtifactModal({ kind: 'text', entry, content: '', isLoading: false, error: getErrorMessage(error, t('image-generation.components.workflow.artifact.explorer.panel.could.not.load.the.text.file')) })
      }
      return
    }

    if (entry.downloadUrl) {
      triggerBrowserDownload(entry.downloadUrl, entry.name)
    }
  }

  const openDirectory = (path: string) => {
    setHoverPreview(null)
    setSearch('')
    if (splitPaneScroll && scrollContainer) scrollContainer.scrollTop = 0
    setCurrentPath(path)
  }

  return (
    <section className={cn('min-w-0', splitPaneScroll && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <IconButton size="icon-sm" variant="ghost" onClick={onBack} label={t('image-generation.components.workflow.artifact.explorer.panel.back.to.workflow.list')}>
              <ArrowLeft />
            </IconButton>
          ) : null}
          <div className="min-w-0">
            <Heading level={3}>{t('image-generation.components.workflow.artifact.explorer.panel.explorer.view')}</Heading>
            <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs text-muted-foreground" aria-label={t({ ko: '경로', en: 'Path' })}>
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.path || 'root'} className="inline-flex min-w-0 items-center gap-0.5">
                  {index > 0 ? <span aria-hidden>/</span> : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="max-w-[12rem]"
                    aria-current={index === breadcrumbs.length - 1 ? 'location' : undefined}
                    onClick={() => openDirectory(crumb.path)}
                  >
                    <span className="truncate">{crumb.label}</span>
                  </Button>
                </span>
              ))}
            </nav>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SearchField value={search} onChange={setSearch} placeholder={t({ ko: '이름 검색', en: 'Search by name' })} />
          <IconButton size="icon-sm" variant="ghost" onClick={() => { refreshNext.current = true; setRefreshVersion((version) => version + 1) }} label={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh')}>
            <RefreshCw />
          </IconButton>
        </div>
      </div>

      {artifactsQuery.isError ? (
        <div className="py-4">
          <Alert variant="destructive">
            <AlertTitle>{t('image-generation.components.workflow.artifact.explorer.panel.could.not.load.results')}</AlertTitle>
            <AlertDescription>{getErrorMessage(artifactsQuery.error, t('image-generation.components.workflow.artifact.explorer.panel.failed.to.fetch.result.list'))}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div ref={setScrollContainer} className={cn('overflow-auto py-4', splitPaneScroll && 'min-h-0 flex-1')}>
        {currentPath ? (
          <Button type="button" variant="ghost" size="sm" className="mb-4" onClick={() => openDirectory(getParentPath(currentPath))}>
            <Folder className="text-warning" />
            ..
          </Button>
        ) : null}

        {entries.length > 0 && (!splitPaneScroll || scrollContainer) ? (
          <VirtuosoGrid
            key={`${currentPath}\0${activeSearch}`}
            data={entries}
            useWindowScroll={!splitPaneScroll}
            customScrollParent={splitPaneScroll ? scrollContainer ?? undefined : undefined}
            style={{
              ['--image-list-column-repeat' as string]: String(columnCount),
              ['--image-list-column-gap' as string]: '16px',
              ['--image-list-row-gap' as string]: '16px',
            }}
            listClassName="image-list-grid"
            itemClassName="image-list-grid-item"
            computeItemKey={(_, entry) => entry.relativePath}
            endReached={() => {
              if (artifactsQuery.hasNextPage && !artifactsQuery.isFetching) void artifactsQuery.fetchNextPage()
            }}
            itemContent={(_, entry) => (
              <div className="h-52 w-full">
                <ArtifactCard entry={entry} onOpenDirectory={openDirectory} onHoverPreviewChange={setHoverPreview} onOpenFile={(item) => void handleOpenFile(item)} />
              </div>
            )}
          />
        ) : entries.length === 0 && artifactsQuery.data ? (
          <EmptyState icon={activeSearch ? Search : Folder} title={activeSearch ? t({ ko: '검색 결과가 없어', en: 'No search results' }) : t('image-generation.components.workflow.artifact.explorer.panel.no.saved.results.yet')} />
        ) : null}
        {artifactsQuery.hasNextPage ? (
          <Button variant="ghost" disabled={artifactsQuery.isFetching} onClick={() => void artifactsQuery.fetchNextPage()}>
            {artifactsQuery.isFetchingNextPage ? t({ ko: '불러오는 중', en: 'Loading' }) : t({ ko: '더 불러오기', en: 'Load more' })}
          </Button>
        ) : null}
      </div>

      {hoverPreview?.entry.fileUrl && hoverPreviewStyle ? (
        <div
          className={cn(FLOATING_DROPDOWN_MENU_CLASS, 'pointer-events-none w-72 p-2 text-foreground')}
          style={hoverPreviewStyle}
        >
          <img src={hoverPreview.entry.fileUrl} alt={hoverPreview.entry.name} className="max-h-72 w-full rounded-sm object-contain" />
          <div className="mt-2 truncate text-xs text-muted-foreground">{hoverPreview.entry.name}</div>
        </div>
      ) : null}

      <Modal
        open={artifactModal !== null}
        onClose={() => setArtifactModal(null)}
        title={<span className="block truncate">{artifactModal?.entry.name}</span>}
        size={artifactModal?.kind === 'text' ? 'lg' : 'xl'}
      >
        {artifactModal ? (
          <>
            {artifactModal.kind === 'image' ? (
              <div className="flex items-center justify-center rounded-sm bg-surface-lowest p-3">
                <img src={artifactModal.entry.fileUrl} alt={artifactModal.entry.name} className="max-h-[calc(92vh-8rem)] max-w-full object-contain" />
              </div>
            ) : (
              <div className="overflow-auto rounded-sm bg-surface-lowest p-4">
                {artifactModal.isLoading ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">{t('image-generation.components.workflow.artifact.explorer.panel.loading.text')}</div>
                ) : artifactModal.error ? (
                  <Alert variant="destructive">
                    <AlertTitle>{t('image-generation.components.workflow.artifact.explorer.panel.text.preview.failed')}</AlertTitle>
                    <AlertDescription>{artifactModal.error}</AlertDescription>
                  </Alert>
                ) : (
                  <CodeBlock fill={false}>{artifactModal.content}</CodeBlock>
                )}
              </div>
            )}
          </>
        ) : null}
      </Modal>
    </section>
  )
}

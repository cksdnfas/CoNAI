import { useMemo, useState, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, File, FileAudio, FileText, FileVideo, Folder, ImageIcon, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Modal } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import type { WorkflowArtifactEntry } from '@/lib/api-image-generation-types'
import { getGenerationWorkflowArtifacts } from '@/lib/api-image-generation-workflows'
import { getPublicGenerationWorkflowArtifacts } from '@/lib/api-public-workflows'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'

type WorkflowArtifactExplorerPanelProps = {
  workflowId: number
  publicWorkflowSlug?: string | null
  refreshNonce?: number
  splitPaneScroll?: boolean
  onBack?: () => void
}

function formatSize(value: number) {
  if (value <= 0) {
    return '—'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
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
      {isDirectory ? <FolderThumbnail entry={entry} /> : <FileThumbnail entry={entry} />}
      <div className="mt-2 min-w-0 text-center">
        <div className="line-clamp-2 break-words text-xs font-medium text-foreground" title={entry.name}>{entry.name}</div>
        <div className="mt-1 text-2xs text-muted-foreground">{isDirectory ? t({ ko: '폴더', en: 'Folder' }) : formatSize(entry.size)}</div>
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
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full flex-col items-stretch gap-0 p-2 font-normal whitespace-normal"
          onClick={() => (isDirectory ? onOpenDirectory(entry.relativePath) : onOpenFile(entry))}
        >
          {cardBody}
        </Button>
      ) : (
        <div className="p-2">{cardBody}</div>
      )}

      {entry.downloadUrl ? (
        <Button asChild size="icon-xs" variant="secondary" className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={t({ ko: '{name} 다운로드', en: 'Download {name}' }, { name: entry.name })}>
          <a href={entry.downloadUrl} download={isDirectory ? `${entry.name}.zip` : entry.name} onClick={(event) => event.stopPropagation()}>
            <Download className="h-3 w-3" />
          </a>
        </Button>
      ) : null}
    </div>
  )
}

export function WorkflowArtifactExplorerPanel({ workflowId, publicWorkflowSlug = null, refreshNonce = 0, splitPaneScroll = false, onBack }: WorkflowArtifactExplorerPanelProps) {
  const { t } = useI18n()
  const [currentPath, setCurrentPath] = useState('')
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const [artifactModal, setArtifactModal] = useState<ArtifactModalState | null>(null)
  const artifactsQuery = useQuery({
    queryKey: ['workflow-artifacts', publicWorkflowSlug ?? 'private', workflowId, currentPath, refreshNonce],
    queryFn: () => publicWorkflowSlug
      ? getPublicGenerationWorkflowArtifacts(publicWorkflowSlug, currentPath)
      : getGenerationWorkflowArtifacts(workflowId, currentPath),
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

  const entries = artifactsQuery.data?.entries ?? []
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
      const anchor = document.createElement('a')
      anchor.href = entry.downloadUrl
      anchor.download = entry.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    }
  }

  return (
    <section data-surface="raised" className={cn('ui-tone-plinth rounded-sm', splitPaneScroll && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-1">
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
                    size="xs"
                    className="max-w-[12rem] px-1 font-normal"
                    aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
                    onClick={() => setCurrentPath(crumb.path)}
                  >
                    <span className="truncate">{crumb.label}</span>
                  </Button>
                </span>
              ))}
            </nav>
          </div>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void artifactsQuery.refetch()}>
          <RefreshCw />
          {t('image-generation.components.wildcard.explorer.sidebar.panel.refresh')}
        </Button>
      </div>

      {artifactsQuery.isError ? (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertTitle>{t('image-generation.components.workflow.artifact.explorer.panel.could.not.load.results')}</AlertTitle>
            <AlertDescription>{getErrorMessage(artifactsQuery.error, t('image-generation.components.workflow.artifact.explorer.panel.failed.to.fetch.result.list'))}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className={cn('overflow-auto p-4', splitPaneScroll && 'min-h-0 flex-1')}>
        {currentPath ? (
          <Button type="button" variant="secondary" size="sm" className="mb-4" onClick={() => setCurrentPath(getParentPath(currentPath))}>
            <Folder className="text-warning" />
            ..
          </Button>
        ) : null}

        {entries.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
            {entries.map((entry) => (
              <ArtifactCard key={entry.relativePath} entry={entry} onOpenDirectory={setCurrentPath} onHoverPreviewChange={setHoverPreview} onOpenFile={(item) => void handleOpenFile(item)} />
            ))}
          </div>
        ) : !artifactsQuery.isLoading ? (
          <EmptyState icon={Folder} title={t('image-generation.components.workflow.artifact.explorer.panel.no.saved.results.yet')} />
        ) : null}
      </div>

      {hoverPreview?.entry.fileUrl && hoverPreviewStyle ? (
        <div
          className="pointer-events-none fixed z-popover w-72 rounded-md bg-surface-high p-2 text-foreground shadow-elevation-2"
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
        widthClassName={artifactModal?.kind === 'text' ? 'max-w-[860px]' : 'max-w-[min(92vw,1400px)]'}
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
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{artifactModal.content}</pre>
                )}
              </div>
            )}
          </>
        ) : null}
      </Modal>
    </section>
  )
}

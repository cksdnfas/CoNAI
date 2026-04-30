import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, File, FileAudio, FileText, FileVideo, Folder, ImageIcon, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getGenerationWorkflowArtifacts, getPublicGenerationWorkflowArtifacts, type WorkflowArtifactEntry } from '@/lib/api'
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

function formatModifiedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return date.toLocaleString()
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
  if (previewKind === 'image') return <ImageIcon className="h-9 w-9 text-sky-300" />
  if (previewKind === 'video') return <FileVideo className="h-9 w-9 text-purple-300" />
  if (previewKind === 'audio') return <FileAudio className="h-9 w-9 text-emerald-300" />
  if (previewKind === 'text') return <FileText className="h-9 w-9 text-amber-200" />
  return <File className="h-9 w-9 text-muted-foreground" />
}

function FolderThumbnail({ entry }: { entry: WorkflowArtifactEntry }) {
  return (
    <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-md border border-border/70 bg-surface-container shadow-sm">
      {entry.thumbnailUrl ? (
        <img src={entry.thumbnailUrl} alt="" className="h-full w-full rounded-md object-cover" loading="lazy" />
      ) : (
        <ImageIcon className="h-9 w-9 text-muted-foreground/50" />
      )}
      <div className="absolute bottom-2 right-2 rounded-md border border-yellow-100/50 bg-yellow-400/90 p-1.5 shadow-lg backdrop-blur-sm">
        <Folder className="h-5 w-5 text-yellow-950" />
      </div>
    </div>
  )
}

function FileThumbnail({ entry }: { entry: WorkflowArtifactEntry }) {
  const previewKind = getPreviewKind(entry)

  return (
    <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-md border border-border/70 bg-surface-container shadow-sm">
      {previewKind === 'image' && entry.fileUrl ? (
        <img src={entry.fileUrl} alt={entry.name} className="h-full w-full rounded-md object-cover" loading="lazy" />
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
        <div className="mt-1 text-[11px] text-muted-foreground">{isDirectory ? 'Folder' : formatSize(entry.size)}</div>
        <div className="text-[10px] text-muted-foreground/80">{formatModifiedAt(entry.modifiedAt)}</div>
      </div>
    </>
  )

  return (
    <div
      className="group relative rounded-md p-2 transition-colors hover:bg-surface-high"
      onMouseEnter={updateHoverPreview}
      onMouseMove={updateHoverPreview}
      onMouseLeave={() => onHoverPreviewChange(null)}
    >
      {isDirectory ? (
        <button type="button" className="block w-full text-left" onDoubleClick={() => onOpenDirectory(entry.relativePath)} onClick={() => onOpenDirectory(entry.relativePath)}>
          {cardBody}
        </button>
      ) : entry.fileUrl ? (
        <button type="button" className="block w-full text-left" onClick={() => onOpenFile(entry)}>
          {cardBody}
        </button>
      ) : (
        cardBody
      )}

      {entry.downloadUrl ? (
        <Button asChild size="icon-xs" variant="secondary" className="absolute right-3 top-3 opacity-0 shadow-sm transition-opacity group-hover:opacity-100" aria-label={`Download ${entry.name}`}>
          <a href={entry.downloadUrl} download={isDirectory ? `${entry.name}.zip` : entry.name} onClick={(event) => event.stopPropagation()}>
            <Download className="h-3 w-3" />
          </a>
        </Button>
      ) : null}
    </div>
  )
}

export function WorkflowArtifactExplorerPanel({ workflowId, publicWorkflowSlug = null, refreshNonce = 0, splitPaneScroll = false, onBack }: WorkflowArtifactExplorerPanelProps) {
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
      { label: '탐색형 뷰어', path: '' },
      ...parts.map((part, index) => ({
        label: part,
        path: parts.slice(0, index + 1).join('/'),
      })),
    ]
  }, [currentPath])

  const entries = artifactsQuery.data?.entries ?? []
  const hoverPreviewStyle = hoverPreview
    ? {
        left: Math.min(hoverPreview.x + 18, Math.max(16, window.innerWidth - 304)),
        top: Math.min(hoverPreview.y + 18, Math.max(16, window.innerHeight - 328)),
      }
    : undefined

  useEffect(() => {
    if (!artifactModal) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setArtifactModal(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [artifactModal])

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
        setArtifactModal({ kind: 'text', entry, content: '', isLoading: false, error: getErrorMessage(error, '텍스트 파일을 불러오지 못했어.') })
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
    <section className={cn('rounded-sm border border-border bg-surface-low', splitPaneScroll && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <Button type="button" size="icon-sm" variant="ghost" onClick={onBack} aria-label="워크플로우 목록으로 돌아가기">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">탐색형 뷰어</h2>
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.path || 'root'} className="inline-flex items-center gap-1">
                  {index > 0 ? <span>/</span> : null}
                  <button type="button" className="max-w-[12rem] truncate hover:text-foreground" onClick={() => setCurrentPath(crumb.path)}>
                    {crumb.label}
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void artifactsQuery.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          새로고침
        </Button>
      </div>

      {artifactsQuery.isError ? (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertTitle>결과물을 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(artifactsQuery.error, '결과물 목록 조회 실패')}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className={cn('overflow-auto p-4', splitPaneScroll && 'min-h-0 flex-1')}>
        {currentPath ? (
          <button type="button" className="mb-4 inline-flex items-center gap-2 rounded-sm border border-border bg-surface-container px-3 py-2 text-sm text-foreground hover:bg-surface-high" onClick={() => setCurrentPath(getParentPath(currentPath))}>
            <Folder className="h-4 w-4 text-yellow-300" />
            ..
          </button>
        ) : null}

        {entries.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
            {entries.map((entry) => (
              <ArtifactCard key={entry.relativePath} entry={entry} onOpenDirectory={setCurrentPath} onHoverPreviewChange={setHoverPreview} onOpenFile={(item) => void handleOpenFile(item)} />
            ))}
          </div>
        ) : !artifactsQuery.isLoading ? (
          <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">아직 저장된 결과물이 없어.</div>
        ) : null}
      </div>

      {hoverPreview?.entry.fileUrl && hoverPreviewStyle ? (
        <div
          className="pointer-events-none fixed z-[1000] w-72 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-2xl ring-1 ring-black/20"
          style={hoverPreviewStyle}
        >
          <img src={hoverPreview.entry.fileUrl} alt={hoverPreview.entry.name} className="max-h-72 w-full rounded-sm object-contain" />
          <div className="mt-2 truncate text-xs text-muted-foreground">{hoverPreview.entry.name}</div>
        </div>
      ) : null}

      {artifactModal ? createPortal(
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm" onClick={() => setArtifactModal(null)}>
          <div className={cn('relative max-h-[92vh] max-w-[92vw] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-2xl', artifactModal.kind === 'text' ? 'w-[min(860px,92vw)]' : '')} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 truncate text-sm font-medium">{artifactModal.entry.name}</div>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => setArtifactModal(null)} aria-label="결과물 미리보기 닫기">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {artifactModal.kind === 'image' ? (
              <div className="flex max-h-[calc(92vh-3.5rem)] items-center justify-center bg-black/30 p-3">
                <img src={artifactModal.entry.fileUrl} alt={artifactModal.entry.name} className="max-h-[calc(92vh-5rem)] max-w-[88vw] object-contain" />
              </div>
            ) : (
              <div className="max-h-[calc(92vh-3.5rem)] overflow-auto bg-background p-4">
                {artifactModal.isLoading ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">텍스트 불러오는 중…</div>
                ) : artifactModal.error ? (
                  <Alert variant="destructive">
                    <AlertTitle>텍스트 미리보기 실패</AlertTitle>
                    <AlertDescription>{artifactModal.error}</AlertDescription>
                  </Alert>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{artifactModal.content}</pre>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  )
}

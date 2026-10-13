import { lazy, useEffect } from 'react'
import { ChevronLeft, ChevronRight, File, FileText, Film, Folder, Image as ImageIcon, Music } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const FilePdfPreview = lazy(() => import('./file-pdf-preview'))
type FileIconEntry = { kind: 'file' | 'folder'; mimeType?: string | null }

export function fileMediaKind(entry: FileIconEntry) {
  const type = entry.mimeType ?? ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'other'
}

export function FileEntryIcon({ entry, className = 'size-4' }: { entry: FileIconEntry; className?: string }) {
  if (entry.kind === 'folder') return <Folder className={cn('shrink-0 text-warning', className)} />
  const kind = fileMediaKind(entry)
  const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? Film : kind === 'audio' ? Music : (entry.mimeType ?? '').startsWith('text/') ? FileText : File
  return <Icon className={cn('shrink-0 text-muted-foreground', className)} />
}

export type FilePreviewKind = 'text' | 'image' | 'video' | 'audio' | 'pdf' | null

export function filePreviewKind(mime: string | undefined): FilePreviewKind {
  if (mime?.startsWith('text/') || mime?.startsWith('application/json')) return 'text'
  if (mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('audio/')) return 'audio'
  return mime === 'application/pdf' ? 'pdf' : null
}

/** MIME comes from the guarded server route, never the uploaded file's claimed type. */
export async function readFilePreviewMime(url: string, onPermissionResult?: (denied: boolean) => void) {
  const response = await fetch(url, { method: 'HEAD', credentials: 'include' })
  if (response.status === 403 && onPermissionResult) {
    onPermissionResult(true)
    throw new Error('Image permission required')
  }
  if (!response.ok) throw new Error('No preview')
  onPermissionResult?.(false)
  return response.headers.get('Content-Type') ?? ''
}

export function FileMediaPreview({ kind, url, name, onError }: { kind: FilePreviewKind; url: string; name: string; onError: () => void }) {
  if (kind === 'image') return <img src={url} alt={name} onError={onError} className="mx-auto max-h-[65vh] max-w-full object-contain" />
  if (kind === 'video') return <video src={url} controls preload="metadata" onError={onError} className="mx-auto max-h-[65vh] max-w-full" />
  if (kind === 'audio') return <audio src={url} controls preload="metadata" onError={onError} className="w-full" />
  if (kind === 'pdf') return <FilePdfPreview url={url} name={name} />
  return null
}

export function FilePreviewNavigation<T>({ previous, next, onNavigate }: { previous: T | null | undefined; next: T | null | undefined; onNavigate: (entry: T) => void }) {
  const { t } = useI18n()
  useEffect(() => {
    const move = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, video, audio, [contenteditable=true]')) return
      const target = event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : null
      if (target) { event.preventDefault(); onNavigate(target) }
    }
    document.addEventListener('keydown', move)
    return () => document.removeEventListener('keydown', move)
  }, [previous, next, onNavigate])
  return <>
    <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이전 파일', en: 'Previous file' })} disabled={!previous} onClick={() => { if (previous) onNavigate(previous) }}><ChevronLeft /></IconButton>
    <IconButton size="icon-sm" variant="ghost" label={t({ ko: '다음 파일', en: 'Next file' })} disabled={!next} onClick={() => { if (next) onNavigate(next) }}><ChevronRight /></IconButton>
  </>
}

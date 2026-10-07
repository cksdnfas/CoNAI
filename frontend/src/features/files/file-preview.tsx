import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Code, Download, File, WrapText } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, formatFileSize, getStoredFileNeighbors, readStoredFileText, storedFileDownloadUrl, storedFileViewUrl } from '@/lib/api-files'

const FileCodePreview = lazy(() => import('./file-code-preview'))
const FilePdfPreview = lazy(() => import('./file-pdf-preview'))
const ChatMarkdown = lazy(() => import('@/features/codex-chat/chat-markdown').then((module) => ({ default: module.ChatMarkdown })))

/** Bounded CSV/TSV prefix, including quoted delimiters/newlines and doubled quotes. */
function tableRows(text: string, delimiter: string, complete: boolean) {
  const rows: string[][] = []
  let row: string[] = [], value = '', quoted = false
  for (let index = 0; index < text.length && rows.length < 200; index++) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++ }
      else if (quoted || !value) quoted = !quoted
      else value += char
    } else if (!quoted && (char === delimiter || char === '\n')) {
      if (row.length < 50) row.push(value.replace(/\r$/, ''))
      value = ''
      if (char === '\n') { rows.push(row); row = [] }
    } else value += char
  }
  if (complete && !quoted && (value || row.length) && rows.length < 200) rows.push([...row, value].slice(0, 50))
  return rows
}

/** `owner`: another account's store key when an admin browses it; null for the viewer's own store. */
export function FilePreview({ entry, owner = null, onClose, onNavigate }: { entry: StoredFileEntry; owner?: string | null; onClose: () => void; onNavigate: (entry: StoredFileEntry) => void }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  const { canViewImages } = useImagePermissions()
  const [deniedEntryId, setDeniedEntryId] = useState<string | null>(null)
  const accountKey = `${auth.data?.accountId ?? (auth.data?.hasCredentials ? 'anonymous' : 'bootstrap')}:${owner ?? ''}`
  const neighbors = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'neighbors', entry.id], queryFn: () => getStoredFileNeighbors(entry.id, owner) })
  useEffect(() => {
    const move = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, video, audio, [contenteditable=true]')) return
      const target = event.key === 'ArrowLeft' ? neighbors.data?.previous : event.key === 'ArrowRight' ? neighbors.data?.next : null
      if (target) { event.preventDefault(); onNavigate(target) }
    }
    document.addEventListener('keydown', move)
    return () => document.removeEventListener('keydown', move)
  }, [neighbors.data, onNavigate])
  return <Modal open title={entry.name} onClose={onClose} widthClassName="max-w-5xl" headerContent={<div className="flex items-center gap-1">
    <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이전 파일', en: 'Previous file' })} disabled={!neighbors.data?.previous} onClick={() => { if (neighbors.data?.previous) onNavigate(neighbors.data.previous) }}><ChevronLeft /></IconButton>
    <IconButton size="icon-sm" variant="ghost" label={t({ ko: '다음 파일', en: 'Next file' })} disabled={!neighbors.data?.next} onClick={() => { if (neighbors.data?.next) onNavigate(neighbors.data.next) }}><ChevronRight /></IconButton>
    <span className="flex-1 text-xs text-muted-foreground">{formatFileSize(entry.size)}</span>
    {deniedEntryId !== entry.id && (canViewImages || (!entry.mimeType?.startsWith('image/') && !entry.mimeType?.startsWith('video/'))) ? <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}><a href={storedFileDownloadUrl(entry.id, owner)} download><Download /></a></IconButton> : null}
  </div>}><FilePreviewContent key={entry.id} entry={entry} owner={owner} accountKey={accountKey} onPermissionResult={(denied) => setDeniedEntryId(denied ? entry.id : null)} /></Modal>
}

function FilePreviewContent({ entry, owner, accountKey, onPermissionResult }: { entry: StoredFileEntry; owner: string | null; accountKey: string; onPermissionResult: (denied: boolean) => void }) {
  const { canViewImages } = useImagePermissions()
  const { t } = useI18n()
  const [offset, setOffset] = useState(0)
  const [firstLine, setFirstLine] = useState(1)
  const [wrap, setWrap] = useState(true)
  const [raw, setRaw] = useState(false)
  const extension = entry.name.split('.').at(-1)?.toLowerCase() ?? ''
  const url = storedFileViewUrl(entry.id, owner)
  const [mediaFailed, setMediaFailed] = useState(false)
  // The server determines the actual safe MIME; uploaded MIME and renames are not trusted.
  const mime = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'view-type', entry.id, entry.updatedAt, canViewImages], queryFn: async () => {
    const response = await fetch(url, { method: 'HEAD', credentials: 'include' })
    if (response.status === 403) { onPermissionResult(true); throw new Error('Image permission required') }
    if (!response.ok) throw new Error('No preview')
    onPermissionResult(false)
    return response.headers.get('Content-Type') ?? ''
  }, retry: false })
  const kind = mime.data?.startsWith('text/plain') ? 'text' : mime.data?.startsWith('image/') ? 'image' : mime.data?.startsWith('video/') ? 'video' : mime.data?.startsWith('audio/') ? 'audio' : mime.data === 'application/pdf' ? 'pdf' : null
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'text', entry.id, offset], queryFn: () => readStoredFileText(entry.id, offset, owner), retry: false, enabled: kind === 'text' })
  const text = useMemo(() => {
    const source = query.data?.text ?? ''
    if (extension === 'json' && !raw && offset === 0 && query.data?.nextOffset === null) {
      try { return JSON.stringify(JSON.parse(source), null, 2) } catch { return source }
    }
    return source
  }, [extension, raw, offset, query.data])
  const tabular = extension === 'csv' || extension === 'tsv'
  const markdown = extension === 'md' || extension === 'markdown'
  const rows = useMemo(() => tabular ? tableRows(text, extension === 'tsv' ? '\t' : ',', query.data?.nextOffset === null) : [], [extension, tabular, text, query.data?.nextOffset])
  const unavailable = <EmptyState icon={File} title={t({ ko: '미리 볼 수 없는 파일이야', en: 'No preview for this file' })} />
  let content
  if (mime.error?.message === 'Image permission required' || (!canViewImages && (kind === 'image' || kind === 'video'))) content = <ImagePermissionNotice />
  else if (mime.isPending) content = <LoadingState />
  else if (mime.isError || mediaFailed) content = unavailable
  else if (kind === 'image') content = <img src={url} alt={entry.name} onError={() => setMediaFailed(true)} className="mx-auto max-h-[65vh] max-w-full object-contain" />
  else if (kind === 'video') content = <video src={url} controls preload="metadata" onError={() => setMediaFailed(true)} className="mx-auto max-h-[65vh] max-w-full" />
  else if (kind === 'audio') content = <audio src={url} controls preload="metadata" onError={() => setMediaFailed(true)} className="w-full" />
  else if (kind === 'pdf') content = <FilePdfPreview url={url} name={entry.name} />
  else if (query.isPending) content = <LoadingState />
  else if (query.isError) content = unavailable
  else if (!raw && markdown) content = <div className="max-h-[60vh] overflow-auto"><ChatMarkdown text={text} /></div>
  else if (!raw && tabular && offset === 0) content = <div className="max-h-[60vh] overflow-auto"><table className="w-full border-collapse text-left text-xs"><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-line">{row.map((cell, column) => index === 0 ? <th key={column} className="whitespace-pre-wrap px-3 py-2 font-semibold">{cell}</th> : <td key={column} className="whitespace-pre-wrap px-3 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>
  else content = <FileCodePreview text={text} extension={extension} wrap={wrap} firstLine={firstLine} />
  return <>
    <ModalBody><Suspense fallback={<LoadingState />}>{content}</Suspense></ModalBody>
    {kind === 'text' && query.data ? <ModalFooter>
      <IconButton size="icon-sm" variant="ghost" active={wrap} label={t({ ko: '자동 줄바꿈', en: 'Wrap lines' })} onClick={() => setWrap(!wrap)}><WrapText /></IconButton>
      {markdown || tabular || extension === 'json' ? <IconButton size="icon-sm" variant="ghost" active={raw} label={t({ ko: '원문 보기', en: 'Raw source' })} onClick={() => setRaw(!raw)}><Code /></IconButton> : null}
      <span className="flex-1" />
      {offset > 0 ? <Button variant="ghost" size="sm" onClick={() => { setOffset(0); setFirstLine(1) }}>{t({ ko: '처음', en: 'Beginning' })}</Button> : null}
      {query.data.nextOffset !== null ? <Button variant="secondary" size="sm" onClick={() => {
        setFirstLine(firstLine + (query.data.text.match(/\n/g)?.length ?? 0))
        setOffset(query.data.nextOffset ?? 0)
      }}>{t({ ko: '다음 부분', en: 'Next part' })}</Button> : null}
    </ModalFooter> : null}
  </>
}

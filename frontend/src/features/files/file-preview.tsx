import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Code, Download, File, History, SquarePen, WrapText } from 'lucide-react'
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
import { FILES_QUERY_KEY, MAX_TEXT_DOCUMENT_BYTES, TEXT_FILE_PATTERN, formatFileSize, getStoredFileNeighbors, readStoredFileText, storedFileDownloadUrl, storedFileViewUrl } from '@/lib/api-files'
import { ApiRequestError } from '@/lib/api-request'
import { FileRevisionsPanel } from './file-revisions'
import { FileMediaPreview, FilePreviewNavigation, filePreviewKind, readFilePreviewMime } from './file-preview-shared'

const FileCodePreview = lazy(() => import('./file-code-preview'))
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

/**
 * `onEdit`: offered
 * for text files small enough for the editor. Text files also show their earlier versions; `history` opens on them.
 */
export function FilePreview({ entry, onClose, onNavigate, onEdit, history: openHistory = false }: { entry: StoredFileEntry; onClose: () => void; onNavigate: (entry: StoredFileEntry) => void; onEdit?: (entry: StoredFileEntry) => void; history?: boolean }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  const { canViewImages } = useImagePermissions()
  const [deniedEntryId, setDeniedEntryId] = useState<string | null>(null)
  const [history, setHistory] = useState(openHistory)
  const versioned = TEXT_FILE_PATTERN.test(entry.name) && entry.size <= MAX_TEXT_DOCUMENT_BYTES
  const canWrite = auth.data?.permissionKeys?.includes('files.edit') === true
  const accountKey = `${auth.data?.accountId ?? (auth.data?.hasCredentials ? 'anonymous' : 'bootstrap')}`
  const neighbors = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'neighbors', entry.id], queryFn: () => getStoredFileNeighbors(entry.id) })
  return <Modal open title={entry.name} onClose={onClose} widthClassName="max-w-5xl" headerContent={<div className="flex items-center gap-1">
    <FilePreviewNavigation previous={neighbors.data?.previous} next={neighbors.data?.next} onNavigate={onNavigate} />
    <span className="flex-1 text-xs text-muted-foreground">{formatFileSize(entry.size)}</span>
    {versioned ? <IconButton variant="ghost" size="icon-sm" active={history} label={t({ ko: '버전 기록', en: 'Version history' })} onClick={() => setHistory(!history)}><History /></IconButton> : null}
    {onEdit && versioned ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '편집', en: 'Edit' })} onClick={() => onEdit(entry)}><SquarePen /></IconButton> : null}
    {deniedEntryId !== entry.id && (canViewImages || (!entry.mimeType?.startsWith('image/') && !entry.mimeType?.startsWith('video/'))) ? <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}><a href={storedFileDownloadUrl(entry.id)} download><Download /></a></IconButton> : null}
  </div>}>{history && versioned
    ? <ModalBody><FileRevisionsPanel key={entry.id} entry={entry} canRestore={canWrite} onRestored={(saved) => { setHistory(false); onNavigate(saved) }} /></ModalBody>
    : <FilePreviewContent key={`${entry.id}:${entry.updatedAt}`} entry={entry} accountKey={accountKey} onPermissionResult={(denied) => setDeniedEntryId(denied ? entry.id : null)} />}</Modal>
}

function FilePreviewContent({ entry, accountKey, onPermissionResult }: { entry: StoredFileEntry; accountKey: string; onPermissionResult: (denied: boolean) => void }) {
  const { canViewImages } = useImagePermissions()
  const { t } = useI18n()
  const [offset, setOffset] = useState(0)
  const [firstLine, setFirstLine] = useState(1)
  const [revision, setRevision] = useState<string | undefined>()
  const [readSession, setReadSession] = useState(0)
  const [wrap, setWrap] = useState(true)
  const [raw, setRaw] = useState(false)
  const extension = entry.name.split('.').at(-1)?.toLowerCase() ?? ''
  const url = storedFileViewUrl(entry.id)
  const [mediaFailed, setMediaFailed] = useState(false)
  // The server determines the actual safe MIME; uploaded MIME and renames are not trusted.
  const mime = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'view-type', entry.id, entry.updatedAt, canViewImages], queryFn: () => readFilePreviewMime(url, onPermissionResult), retry: false })
  const kind = filePreviewKind(mime.data)
  const query = useQuery({ queryKey: [...FILES_QUERY_KEY, accountKey, 'text', entry.id, entry.updatedAt, readSession, revision ?? null, offset], queryFn: ({ signal }) => readStoredFileText(entry.id, offset, revision, signal), retry: false, enabled: kind === 'text' })
  const restartRead = () => { setOffset(0); setFirstLine(1); setRevision(undefined); setReadSession((current) => current + 1) }
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
  else if (mime.isError || mediaFailed || kind === null) content = unavailable
  else if (kind !== 'text') content = <FileMediaPreview kind={kind} url={url} name={entry.name} onError={() => setMediaFailed(true)} />
  else if (query.isPending) content = <LoadingState />
  else if (query.isError) content = query.error instanceof ApiRequestError && query.error.status === 409
    ? <div className="space-y-3"><EmptyState icon={File} title={t({ ko: '읽는 동안 파일이 변경됐어', en: 'The file changed while you were reading' })} /><Button variant="secondary" size="sm" onClick={restartRead}>{t({ ko: '처음부터 다시 읽기', en: 'Read again from the beginning' })}</Button></div>
    : unavailable
  else if (!raw && markdown) content = <div className="max-h-[60vh] overflow-auto"><ChatMarkdown text={text} /></div>
  else if (!raw && tabular && offset === 0) content = <div className="max-h-[60vh] overflow-auto"><table className="w-full border-collapse text-left text-xs"><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-line">{row.map((cell, column) => index === 0 ? <th key={column} className="whitespace-pre-wrap px-3 py-2 font-semibold">{cell}</th> : <td key={column} className="whitespace-pre-wrap px-3 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>
  else content = <FileCodePreview text={text} extension={extension} wrap={wrap} firstLine={firstLine} />
  return <>
    <ModalBody><Suspense fallback={<LoadingState />}>{content}</Suspense></ModalBody>
    {kind === 'text' && query.data ? <ModalFooter>
      <IconButton size="icon-sm" variant="ghost" active={wrap} label={t({ ko: '자동 줄바꿈', en: 'Wrap lines' })} onClick={() => setWrap(!wrap)}><WrapText /></IconButton>
      {markdown || tabular || extension === 'json' ? <IconButton size="icon-sm" variant="ghost" active={raw} label={t({ ko: '원문 보기', en: 'Raw source' })} onClick={() => setRaw(!raw)}><Code /></IconButton> : null}
      <span className="flex-1" />
      {offset > 0 ? <Button variant="ghost" size="sm" onClick={restartRead}>{t({ ko: '처음', en: 'Beginning' })}</Button> : null}
      {query.data.nextOffset !== null ? <Button variant="secondary" size="sm" onClick={() => {
        setFirstLine(firstLine + (query.data.text.match(/\n/g)?.length ?? 0))
        setRevision(query.data.revision)
        setOffset(query.data.nextOffset ?? 0)
      }}>{t({ ko: '다음 부분', en: 'Next part' })}</Button> : null}
    </ModalFooter> : null}
  </>
}

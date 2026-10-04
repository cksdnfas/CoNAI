import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { exportChat, searchChatMessages, type ChatSearchResult } from '@/lib/api-codex-chat'
import { triggerBlobDownload } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/error-message'

export function ChatSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  return <Input type="search" value={value} maxLength={200} onChange={(event) => onChange(event.target.value)} placeholder={t({ ko: '채팅 검색', en: 'Search chats' })} aria-label={t({ ko: '채팅 검색', en: 'Search chats' })} />
}

export function ChatSearchResults({ query, disabled, onPick }: { query: string; disabled: boolean; onPick: (result: ChatSearchResult) => void }) {
  const { t } = useI18n()
  const [term, setTerm] = useState(query.trim())
  useEffect(() => { const timer = setTimeout(() => setTerm(query.trim()), 250); return () => clearTimeout(timer) }, [query])
  const results = useQuery({ queryKey: ['chat-search', term], queryFn: () => searchChatMessages(term), enabled: term.length > 0 && term.length <= 200, staleTime: 0 })
  if (!query.trim()) return null
  if (results.isError) return <p role="alert" className="p-2 text-xs text-destructive">{getErrorMessage(results.error, t({ ko: '검색 실패', en: 'Search failed' }))}</p>
  if (results.isPending || term !== query.trim()) return <p role="status" className="p-2 text-xs text-muted-foreground">{t({ ko: '검색 중…', en: 'Searching…' })}</p>
  return <div className="space-y-1">
    {!results.data?.length ? <p className="p-2 text-xs text-muted-foreground">{t({ ko: '검색 결과가 없어.', en: 'No results.' })}</p> : results.data.map((result) => (
      <ListRow key={result.messageId} asChild interactive><button type="button" disabled={disabled} onClick={() => onPick(result)} className="w-full flex-col items-start gap-1 text-left">
        <span className="max-w-full truncate text-xs font-semibold">{result.title || t({ ko: '새 채팅', en: 'New chat' })}</span>
        <span className="line-clamp-3 break-all text-xs text-muted-foreground">{result.excerpt}</span>
      </button></ListRow>
    ))}
  </div>
}

export function ChatExportDialog({ threadId, open, onClose }: { threadId: number | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const download = async (format: 'md' | 'json') => {
    if (threadId === null || busy) return
    setBusy(true)
    try { triggerBlobDownload(await exportChat(threadId, format), `chat-${threadId}.${format}`); onClose() }
    catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '내보내기 실패', en: 'Export failed' })), tone: 'error' }) }
    finally { setBusy(false) }
  }
  return <Modal open={open} onClose={onClose} title={t({ ko: '대화 내보내기', en: 'Export chat' })} widthClassName="max-w-sm">
    <ModalBody><div className="flex gap-2"><Button disabled={busy} onClick={() => void download('md')}>Markdown</Button><Button variant="secondary" disabled={busy} onClick={() => void download('json')}>JSON</Button></div></ModalBody>
  </Modal>
}

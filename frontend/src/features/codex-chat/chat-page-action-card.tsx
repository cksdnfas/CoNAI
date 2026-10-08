import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldInfo } from '@/components/ui/field'
import { useI18n } from '@/i18n'
import { useChatPage, type PageActionProposal } from './chat-page-context'

export function ChatPageActionCard({ proposal }: { proposal: PageActionProposal }) {
  const page = useChatPage()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = page?.states.get(proposal.id)
  const canUndo = state === 'applied' && page?.actionUndos.has(proposal.id)
  const handled = !!state || proposal.saved || proposal.dismissed
  const problem = !handled || canUndo ? page?.actionProblem(proposal, canUndo) ?? t({ ko: '대상 페이지를 연결해줘.', en: 'Connect the target page.' }) : ''
  const run = async () => {
    if (!page) return
    setBusy(true); setError('')
    try { await page.applyAction(proposal, canUndo) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t({ ko: '작업을 적용하지 못했어.', en: 'Could not apply the operation.' })) }
    finally { setBusy(false) }
  }
  return <div className="space-y-2.5 rounded-md border border-line px-3 py-2.5" aria-label={t({ ko: '페이지 작업 제안', en: 'Page operation proposal' })}>
    <p className="flex items-center gap-1 text-xs font-semibold">{proposal.page.title} · {proposal.action.label}{proposal.action.description ? <FieldInfo>{proposal.action.description}</FieldInfo> : null}</p>
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div><p className="mb-1 font-medium">{t({ ko: '현재 내용', en: 'Current contents' })}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{JSON.stringify(proposal.before, (key, value) => key === 'revision' || key === 'schema' ? undefined : value, 2)}</pre></div>
      <div><p className="mb-1 font-medium">{t({ ko: '적용할 내용', en: 'Proposed contents' })}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(proposal.arguments, null, 2)}</pre></div>
    </div>
    {error || problem ? <p className="text-xs text-muted-foreground" role={error ? 'alert' : undefined}>{error || problem}</p> : null}
    {!handled || canUndo ? <Button size="xs" variant={canUndo ? 'secondary' : 'default'} disabled={busy || !!problem} onClick={() => void run()}>{t(canUndo ? { ko: '작업 되돌리기', en: 'Undo operation' } : proposal.action.effect === 'save' ? { ko: '검토한 내용 저장', en: 'Save reviewed contents' } : { ko: '작업 적용', en: 'Apply operation' })}</Button> : <p className="text-xs text-muted-foreground">{t(state === 'undone' ? { ko: '작업을 되돌렸어.', en: 'Operation undone.' } : proposal.dismissed ? { ko: '무시한 제안이야.', en: 'Proposal dismissed.' } : { ko: '적용한 제안이야.', en: 'Proposal applied.' })}</p>}
  </div>
}

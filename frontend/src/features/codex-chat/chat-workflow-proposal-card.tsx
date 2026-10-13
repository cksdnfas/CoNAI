import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { useChatPage, type WorkflowPageProposal } from './chat-page-context'
import { ProposalChange, ProposalFrame } from './chat-proposal-parts'

export function ChatWorkflowProposalCard({ proposal }: { proposal: WorkflowPageProposal }) {
  const page = useChatPage()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = page?.states.get(proposal.id)
  const applied = state === 'applied'
  const handled = !!state || proposal.saved || proposal.dismissed
  const unavailable = handled && !applied ? '' : page?.workflowProblem(proposal, applied) ?? t({ ko: '워크플로 편집기를 연결해줘.', en: 'Connect the workflow editor.' })
  const run = async () => {
    if (!page) return
    setBusy(true); setError('')
    try { await page.applyWorkflow(proposal, applied) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t({ ko: '워크플로를 적용하지 못했어.', en: 'Could not apply the workflow.' })) }
    finally { setBusy(false) }
  }
  return <ProposalFrame aria-label={t({ ko: '워크플로 변경 제안', en: 'Workflow edit proposal' })}>
    <p className="text-xs font-semibold">{t({ ko: '워크플로 초안 변경 · 노드 {nodes}개 · 연결 {edges}개', en: 'Workflow draft edits · {nodes} nodes · {edges} edges' }, { nodes: proposal.nodeCount, edges: proposal.edgeCount })}</p>
    <dl className="max-h-80 space-y-2 overflow-auto text-xs">{proposal.changes.map((change, index) => <ProposalChange key={index} label={change.title} before={change.before} after={change.after} />)}</dl>
    {proposal.issues.length > 0 && <div className="space-y-1 text-xs text-muted-foreground"><p>{t({ ko: '저장·실행 전 확인할 항목', en: 'Review before saving or running' })}</p>{proposal.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div>}
    {(error || unavailable) && <p className="text-xs text-muted-foreground" role={error ? 'alert' : undefined}>{error || unavailable}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {state === 'undone' ? <span className="text-xs text-muted-foreground">{t({ ko: '워크플로 초안을 되돌렸어.', en: 'Workflow draft undone.' })}</span>
        : handled && !applied ? <span className="text-xs text-muted-foreground">{t(proposal.dismissed ? { ko: '무시한 제안이야.', en: 'Proposal dismissed.' } : { ko: '이전에 적용한 제안이야.', en: 'Previously applied.' })}</span>
          : <Button size="xs" variant={applied ? 'secondary' : 'default'} disabled={busy || !!unavailable} onClick={() => void run()}>{t(applied ? { ko: '워크플로 되돌리기', en: 'Undo workflow' } : { ko: '워크플로 적용', en: 'Apply workflow' })}</Button>}    </div>
  </ProposalFrame>
}

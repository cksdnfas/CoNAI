import { useState } from 'react'
import { chatPagePatch, type ChatProposal, type ChatPageValue } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { useChatPage } from './chat-page-context'
import { ProposalChange, ProposalFrame } from './chat-proposal-parts'

type PageProposal = Extract<ChatProposal, { kind: 'page_fields' }>
function display(value: ChatPageValue) { return Array.isArray(value) ? value.join('\n\n') : String(value) }

/** Review and apply only to the same connected form; never invokes Save, Generate or Delete. */
export function ChatPageProposalCard({ proposal }: { proposal: PageProposal }) {
  const page = useChatPage()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = page?.states.get(proposal.id)
  const applied = state === 'applied'
  const handled = !!state || proposal.saved === true || proposal.dismissed === true
  let unavailable = ''
  try {
    if (!page?.snapshot) throw new Error(t({ ko: '대상 페이지를 연결하면 적용할 수 있어.', en: 'Connect the target page to apply this proposal.' }))
    chatPagePatch(page.snapshot, proposal, applied)
  } catch (reason) { unavailable = reason instanceof Error ? reason.message : '' }
  const run = async () => {
    if (!page) return
    setBusy(true)
    setError('')
    try { await page.apply(proposal, applied) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t({ ko: '입력을 적용하지 못했어.', en: 'Could not apply the inputs.' })) }
    finally { setBusy(false) }
  }
  return <ProposalFrame aria-label={t({ ko: '페이지 입력 제안', en: 'Page input proposal' })}>
    <p className="text-xs font-semibold">{t({ ko: '{name} 입력 변경', en: 'Change inputs on {name}' }, { name: proposal.page.title })}</p>
    <dl className="space-y-2 text-xs">
      {proposal.changes.map((change) => <ProposalChange
        key={change.fieldId}
        label={change.label}
        before={display(change.before) || t({ ko: '(비어 있음)', en: '(empty)' })}
        after={display(change.value) || t({ ko: '(비어 있음)', en: '(empty)' })}
      />)}
    </dl>
    {error || unavailable ? <p className="text-xs text-muted-foreground" role={error ? 'alert' : undefined}>{error || unavailable}</p> : null}
    <div className="flex items-center gap-2">
      {state === 'undone' ? <span className="text-xs text-muted-foreground">{t({ ko: '입력을 되돌렸어.', en: 'Inputs undone.' })}</span>
        : handled && !applied ? <span className="text-xs text-muted-foreground">{t(proposal.dismissed ? { ko: '무시한 제안이야.', en: 'Proposal dismissed.' } : { ko: '이전에 적용한 제안이야.', en: 'Previously applied.' })}</span>
          : <Button size="xs" variant={applied ? 'secondary' : 'default'} disabled={busy || !!unavailable} onClick={() => void run()}>{t(applied ? { ko: '입력 되돌리기', en: 'Undo inputs' } : { ko: '입력 적용', en: 'Apply inputs' })}</Button>}    </div>
  </ProposalFrame>
}

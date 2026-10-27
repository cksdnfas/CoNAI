import { useEffect, useState } from 'react'
import { Clapperboard, FileText, FolderKanban, ShieldCheck, X } from 'lucide-react'
import type { PluginAppRequest, PluginMediaProposal, PluginWorkspaceProposal, PluginWriteProposal, WorkspaceOperation } from '@conai/shared'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { TextDiff } from '@/components/common/text-diff'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useRuntimeJob } from '@/lib/use-runtime-job'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { AppRequestDetail, useAppRequestActions } from './plugin-app-requests'

export type PluginProposal = PluginWriteProposal | PluginWorkspaceProposal | PluginMediaProposal
export type PluginMediaJob = { jobId: string; proposalId: string; status: string }
type ReviewItem = { key: string; proposal: PluginProposal; request?: undefined } | { key: string; request: PluginAppRequest; proposal?: undefined }

const proposalKind = (proposal: PluginProposal) => 'source' in proposal ? (proposal.source === 'media' ? 'media' : proposal.operations ? 'changes' : 'workspace') : 'file'

function useProposalLabel() {
  const { t } = useI18n()
  return (proposal: PluginProposal) => {
    const kind = proposalKind(proposal)
    return kind === 'media' ? t({ ko: '미디어 처리', en: 'Media processing' }) : kind === 'changes' ? t({ ko: '파일 변경', en: 'File changes' }) : t({ ko: '저장 제안', en: 'Save proposal' })
  }
}

/** One project change in words: what happens to which target. */
function OperationRow({ operation }: { operation: WorkspaceOperation }) {
  const { t } = useI18n()
  const verb = operation.kind === 'mkdir' ? t({ ko: '폴더 만들기', en: 'Create folder' })
    : operation.kind === 'write' ? (operation.expectedRevision === null ? t({ ko: '새 문서', en: 'New document' }) : t({ ko: '덮어쓰기', en: 'Overwrite' }))
      : operation.kind === 'edit' ? t({ ko: '부분 수정 {count}곳', en: '{count} edits' }, { count: operation.edits.length })
        : operation.kind === 'move' ? t({ ko: '이동', en: 'Move' }) : t({ ko: '삭제', en: 'Delete' })
  return (
    <ListRow size="sm" trailing={<span className="text-xs">{verb}</span>}>
      <span className="min-w-0 truncate font-mono text-xs">{operation.target}{operation.kind === 'move' ? ` → ${operation.destination}` : ''}</span>
    </ListRow>
  )
}

function ProposalDetail({ proposal }: { proposal: PluginProposal }) {
  if ('source' in proposal && proposal.source === 'media') return <CodeBlock maxHeight="md" wrap>{JSON.stringify({ source: proposal.sourceTarget, operation: proposal.operation }, null, 2)}</CodeBlock>
  if ('source' in proposal && proposal.operations) return <div>{proposal.operations.map((operation, index) => <OperationRow key={index} operation={operation} />)}</div>
  return <TextDiff before={proposal.before} after={proposal.text} className="max-h-[55vh]" />
}

/**
 * Everything waiting for a person on this plugin page: save proposals (what changes, line by line) and app operations
 * (exact inputs, with a cost warning for generation). Only Apply here changes anything.
 */
export function PluginReviewModal({ open, onClose, proposals, requests, initialKey, busy, closed, onApply, onDiscard, location }: {
  open: boolean
  onClose: () => void
  proposals: PluginProposal[]
  requests: PluginAppRequest[]
  initialKey?: string | null
  busy: boolean
  /** The plugin connection ended: proposals can no longer be applied (app operations still can). */
  closed: boolean
  onApply: (proposal: PluginProposal) => void | Promise<void>
  onDiscard: (proposal: PluginProposal) => void
  /** Where a proposal saves (project or file name), shown in the footer. */
  location?: (proposal: PluginProposal) => string | null
}) {
  const { t } = useI18n()
  const label = useProposalLabel()
  const actions = useAppRequestActions()
  const items: ReviewItem[] = [
    ...proposals.map((proposal) => ({ key: `p:${proposal.id}`, proposal })),
    ...requests.filter((request) => request.status === 'pending').map((request) => ({ key: `r:${request.id}`, request })),
  ]
  const [chosen, setChosen] = useState<string | null>(initialKey ?? null)
  useEffect(() => { if (open) setChosen(initialKey ?? null) }, [open, initialKey])
  // The item asked for, else the first; never a different one in place of the asked one that is gone.
  const current = items.find((item) => item.key === chosen) ?? (chosen && chosen === initialKey ? undefined : items[0])
  useEffect(() => { if (open && items.length === 0) onClose() }, [open, items.length, onClose])
  const working = busy || actions.busy !== null
  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '검토 대기 {count}', en: '{count} awaiting review' }, { count: items.length })} size="lg">
      <ModalBody spacing="none">
        {current ? (
          <div className="grid min-h-0 md:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="border-b border-line md:border-r md:border-b-0" role="listbox" aria-label={t({ ko: '검토할 항목', en: 'Items to review' })}>
              {items.map((item) => {
                const Icon = item.request ? ShieldCheck : proposalKind(item.proposal) === 'media' ? Clapperboard : proposalKind(item.proposal) === 'file' ? FileText : FolderKanban
                return (
                  <ListRow key={item.key} asChild interactive size="lg" selected={item.key === current.key} leading={<Icon className={cn('size-4', item.request?.scope === 'generate' ? 'text-warning' : 'text-muted-foreground')} aria-hidden />}>
                    <button type="button" role="option" aria-selected={item.key === current.key} onClick={() => setChosen(item.key)}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{item.request ? item.request.label : item.proposal.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{item.request ? (item.request.scope === 'generate' ? t({ ko: '앱 작업 · 비용', en: 'App operation · cost' }) : t({ ko: '앱 작업', en: 'App operation' })) : label(item.proposal)}</span>
                      </span>
                    </button>
                  </ListRow>
                )
              })}
            </div>
            <div className="min-w-0 space-y-3 p-4">
              {current.request ? (
                <>
                  <p className="text-sm"><span className="font-semibold">{current.request.label}</span> <span className="text-muted-foreground">· {[current.request.tool, current.request.project?.name].filter(Boolean).join(' · ')}</span></p>
                  <AppRequestDetail request={current.request} />
                </>
              ) : <ProposalDetail proposal={current.proposal} />}
              {actions.error ? <p role="alert" className="text-sm text-destructive">{actions.error}</p> : null}
            </div>
          </div>
        ) : <EmptyState title={t({ ko: '검토할 항목이 없어', en: 'Nothing to review' })} />}
      </ModalBody>
      {current ? (
        <ModalFooter>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{current.proposal ? location?.(current.proposal) ?? '' : ''}</span>
          {current.request ? (
            <>
              <Button variant="secondary" disabled={working} onClick={() => void actions.run(current.request.id, 'cancel')}>{t({ ko: '취소', en: 'Cancel' })}</Button>
              <Button disabled={working} onClick={() => void actions.run(current.request.id, 'apply')}>{t({ ko: '적용', en: 'Apply' })}</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={working} onClick={() => onDiscard(current.proposal)}>{t({ ko: '버리기', en: 'Discard' })}</Button>
              <Button disabled={working || closed} onClick={() => void onApply(current.proposal)}>{t({ ko: '적용', en: 'Apply' })}</Button>
            </>
          )}
        </ModalFooter>
      ) : null}
    </Modal>
  )
}

/** A media job started by an applied proposal: progress text and cancel while it runs; reports how it ended. */
function MediaJobLine({ job, onFinished }: { job: PluginMediaJob; onFinished: (status: string, result?: unknown, failure?: string | null) => void }) {
  const { t, formatNumber } = useI18n()
  const tracked = useRuntimeJob(job.jobId, {
    onCompleted: (record) => onFinished('completed', record.result),
    onFailed: (record) => onFinished('failed', undefined, record.failureMessage),
    onCancelled: () => onFinished('cancelled'),
  })
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="truncate">{tracked.job?.progress.currentLabel ?? t({ ko: '미디어 작업', en: 'Media job' })} · {formatNumber(tracked.percentage)}%</span>
      {tracked.isRunning ? <IconButton size="icon-xs" variant="ghost" label={t({ ko: '작업 취소', en: 'Cancel job' })} disabled={tracked.isCancelling} onClick={() => void tracked.cancel()}><X /></IconButton> : null}
    </span>
  )
}

/**
 * The floating bar of a plugin page: how many changes wait for review (opens the review) and the media jobs still
 * running. Nothing when there is neither.
 */
export function PluginReviewBar({ proposals, requests, jobs, onReview, onJobFinished }: {
  proposals: PluginProposal[]
  requests: PluginAppRequest[]
  jobs: PluginMediaJob[]
  onReview: () => void
  onJobFinished: (job: PluginMediaJob, status: string, result?: unknown, failure?: string | null) => void
}) {
  const { t } = useI18n()
  const pending = requests.filter((request) => request.status === 'pending')
  const running = jobs.filter((job) => job.status === 'running')
  const count = proposals.length + pending.length
  if (count === 0 && running.length === 0) return null
  const names = [...proposals.map((proposal) => proposal.name), ...pending.map((request) => request.label)]
  return (
    <SelectionActionBar
      selectedCount={count + running.length}
      summary={count ? (
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-warning" aria-hidden />
          {t({ ko: '검토 대기 {count}', en: '{count} awaiting review' }, { count })}
          {pending.some((request) => request.scope === 'generate') ? <Badge variant="warning">{t({ ko: '비용', en: 'Cost' })}</Badge> : null}
        </span>
      ) : t({ ko: '미디어 작업 중', en: 'Media job running' })}
      description={(
        <span className="flex flex-col">
          {names.length ? <span className="max-w-80 truncate">{names.join(' · ')}</span> : null}
          {running.map((job) => <MediaJobLine key={job.jobId} job={job} onFinished={(status, result, failure) => onJobFinished(job, status, result, failure)} />)}
        </span>
      )}
      actions={count ? <Button size="sm" onClick={onReview}>{t({ ko: '검토', en: 'Review' })}</Button> : null}
    />
  )
}

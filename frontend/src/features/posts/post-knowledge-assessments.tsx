import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PostAssessmentAuditEntry, PostAssessmentQuality, PostDetail } from '@conai/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Field } from '@/components/ui/field'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, listPostAssessmentAudit, moderatePostAssessment } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { usePostPermissions } from './use-post-permissions'

const qualityLabels = {
  up: { ko: '추천', en: 'Recommend' }, down: { ko: '비추천', en: 'Do not recommend' }, abstain: { ko: '기권', en: 'Abstain' },
}
const evaluatorLabels = {
  human: { ko: '사람', en: 'Person' }, use_ai: { ko: '사용 AI', en: 'AI using the document' }, judge: { ko: '판단모델', en: 'Judge model' },
}
const eventLabels = {
  assessment: { ko: '평가', en: 'Assessment' }, invalidate: { ko: '무효화', en: 'Invalidation' }, correction: { ko: '정정', en: 'Correction' },
}

function AssessmentModerationDialog({ post, entry, action, onClose }: { post: PostDetail; entry: PostAssessmentAuditEntry; action: 'invalidate' | 'correct'; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [quality, setQuality] = useState<PostAssessmentQuality>(entry.quality)
  const [reason, setReason] = useState('')
  const title = action === 'invalidate' ? t({ ko: 'AI 평가 무효화', en: 'Invalidate AI feedback' }) : t({ ko: 'AI 평가 정정', en: 'Correct AI feedback' })
  const save = useMutation({
    mutationFn: (idempotencyKey: string) => moderatePostAssessment(post.id, entry.eventId, { action, expectedHeadEventId: entry.eventId, idempotencyKey, reason, ...(action === 'correct' ? { quality } : {}) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가 변경을 저장하지 못했어.', en: 'Could not save the feedback change.' })) }),
  })
  return <Modal open onClose={onClose} title={title} size="narrow">
    <ModalBody>
      <p className="text-sm text-muted-foreground">{t({ ko: '내용 {version}판 · {evaluator} · 기존 {quality}', en: 'Content version {version} · {evaluator} · previously {quality}' }, { version: entry.contentVersion, evaluator: t(evaluatorLabels[entry.evaluator]), quality: t(qualityLabels[entry.quality]) })}</p>
      {entry.reason ? <p className="whitespace-pre-wrap text-sm">{entry.reason}</p> : null}
      {entry.evidenceQuote ? <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-muted-foreground">{entry.evidenceQuote}</blockquote> : null}
      {action === 'correct' ? <Field label={t({ ko: '변경할 품질 의견', en: 'Corrected quality feedback' })}><Select value={quality} onChange={(event) => setQuality(event.target.value as PostAssessmentQuality)}>{Object.entries(qualityLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</Select></Field> : null}
      <p className="text-sm text-muted-foreground">{action === 'invalidate' ? t({ ko: '이 평가의 기여를 집계에서 제외해. 기존 기록과 무효화 이유는 이력에 남아.', en: 'This feedback stops contributing to the aggregate. The original record and invalidation reason remain in history.' }) : t({ ko: '기존 기록을 보존하고 새 품질 의견으로 집계를 다시 계산해. 정정 이유도 이력에 남아.', en: 'The aggregate is recalculated with the corrected quality feedback. The original record and correction reason remain in history.' })}</p>
      <Field label={t({ ko: '변경 이유', en: 'Reason for the change' })}><Textarea rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    </ModalBody>
    <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button variant={action === 'invalidate' ? 'destructive' : 'default'} disabled={!reason.trim() || save.isPending} onClick={() => save.mutate(crypto.randomUUID())}>{title}</Button></ModalFooter>
  </Modal>
}

/** Server-redacted audit entries; private execution text is never part of this contract. */
export function PostKnowledgeAssessmentAudit({ post }: { post: PostDetail }) {
  const { t, formatDateTime } = useI18n()
  const permissions = usePostPermissions()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<{ entry: PostAssessmentAuditEntry; action: 'invalidate' | 'correct' } | null>(null)
  const canReview = post.knowledge?.canReview === true
  const query = useInfiniteQuery({
    queryKey: [POSTS_QUERY_KEY, 'assessments', permissions.viewerKey, post.id, post.knowledge?.contentVersion],
    queryFn: ({ pageParam }) => listPostAssessmentAudit(post.id, { offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.offset + page.items.length < page.total ? page.offset + page.items.length : undefined,
    enabled: canReview && open,
  })
  if (!canReview) return null
  const entries = query.data?.pages.flatMap((page) => page.items) ?? []
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm text-muted-foreground">{t({ ko: '평가 이력과 정정', en: 'Feedback history and corrections' })}</summary>
    {open ? <div className="mt-3">
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState size="compact" error={query.error} onRetry={() => void query.refetch()} /> : !entries.length ? <EmptyState title={t({ ko: '평가 이력이 없어', en: 'No feedback history' })} /> : entries.map((entry) => <div key={entry.eventId} className="space-y-2 border-b border-line py-3 last:border-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={entry.currentContent ? 'ghost' : 'secondary'}>{t({ ko: '내용 {version}판', en: 'Content version {version}' }, { version: entry.contentVersion })}</Badge>
          <span>{t(evaluatorLabels[entry.evaluator])} · {t(eventLabels[entry.eventKind])} · {t(qualityLabels[entry.quality])}</span>
          {entry.taskFit !== 'unknown' ? <span>{entry.taskFit === 'useful' ? t({ ko: '내 작업 적합성: 유용', en: 'My task fit: useful' }) : t({ ko: '내 작업 적합성: 맞지 않음', en: 'My task fit: unsuitable' })}</span> : null}
          {!entry.isLatest ? <span>{t({ ko: '이전 기록', en: 'Previous record' })}</span> : null}
          <span>{formatDateTime(entry.createdAt)}</span>
        </div>
        {entry.reason ? <p className="whitespace-pre-wrap text-sm">{entry.reason}</p> : null}
        {entry.evidenceQuote ? <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-muted-foreground">{entry.evidenceQuote}</blockquote> : null}
        {entry.moderationReason ? <p className="whitespace-pre-wrap text-sm">{t({ ko: '변경 이유: {reason}', en: 'Change reason: {reason}' }, { reason: entry.moderationReason })}</p> : null}
        {entry.supersedesEventId ? <p className="text-xs text-muted-foreground">{t({ ko: '평가 #{id}의 변경 기록', en: 'Change to feedback #{id}' }, { id: entry.supersedesEventId })}</p> : null}
        {entry.canModerate && entry.evaluator !== 'human' ? <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => setPicked({ entry, action: 'correct' })}>{t({ ko: '정정', en: 'Correct' })}</Button><Button variant="ghost" size="sm" onClick={() => setPicked({ entry, action: 'invalidate' })}>{t({ ko: '무효화', en: 'Invalidate' })}</Button></div> : null}
      </div>)}
      {query.hasNextPage ? <Button className="mt-3" variant="ghost" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t({ ko: '더 보기', en: 'Load more' })}</Button> : null}
    </div> : null}
    {picked ? <AssessmentModerationDialog post={post} {...picked} onClose={() => setPicked(null)} /> : null}
  </details>
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostAssessmentAuditEntry, PostAssessmentQuality, PostDetail } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, invalidatePostScope, listPostAssessmentAudit, moderatePostAssessment } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { PostQuote } from './post-quote'
import { usePostPermissions } from './use-post-permissions'

const qualityLabels = {
  up: { ko: '추천', en: 'Recommend' }, down: { ko: '비추천', en: 'Do not recommend' }, abstain: { ko: '기권', en: 'Abstain' },
}
const evaluatorLabels = {
  human: { ko: '사람', en: 'Person' }, use_ai: { ko: '사용 AI', en: 'AI using the document' }, judge: { ko: '판단모델', en: 'Judge model' },
}

export function AssessmentModerationDialog({ post, entry, action, onClose }: { post: PostDetail; entry: PostAssessmentAuditEntry; action: 'invalidate' | 'correct'; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [quality, setQuality] = useState<PostAssessmentQuality>(entry.quality)
  const [reason, setReason] = useState('')
  const title = action === 'invalidate' ? t({ ko: 'AI 평가 무효화', en: 'Invalidate AI feedback' }) : t({ ko: 'AI 평가 정정', en: 'Correct AI feedback' })
  const save = useMutation({
    mutationFn: (idempotencyKey: string) => moderatePostAssessment(post.id, entry.eventId, { action, expectedHeadEventId: entry.eventId, idempotencyKey, reason, ...(action === 'correct' ? { quality } : {}) }),
    onSuccess: async () => { await invalidatePostScope(queryClient, post.id, 'post'); onClose() },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가 변경을 저장하지 못했어.', en: 'Could not save the feedback change.' })) }),
  })
  return <Modal open onClose={onClose} title={title} size="md">
    <ModalBody>
      <p className="text-sm text-muted-foreground">{t({ ko: '내용 {version}판 · {evaluator} · 기존 {quality}', en: 'Content version {version} · {evaluator} · previously {quality}' }, { version: entry.contentVersion, evaluator: t(evaluatorLabels[entry.evaluator]), quality: t(qualityLabels[entry.quality]) })}</p>
      {entry.reason ? <p className="whitespace-pre-wrap text-sm">{entry.reason}</p> : null}
      {entry.evidenceQuote ? <PostQuote>{entry.evidenceQuote}</PostQuote> : null}
      {action === 'correct' ? <Field label={t({ ko: '변경할 품질 의견', en: 'Corrected quality feedback' })}><Select value={quality} onChange={(event) => setQuality(event.target.value as PostAssessmentQuality)}>{Object.entries(qualityLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</Select></Field> : null}
      <Field label={t({ ko: '변경 이유', en: 'Reason for the change' })}><Textarea rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    </ModalBody>
    <ModalFooter><Button variant="ghost" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button variant={action === 'invalidate' ? 'destructive' : 'default'} disabled={!reason.trim() || save.isPending} onClick={() => save.mutate(crypto.randomUUID())}>{title}</Button></ModalFooter>
  </Modal>
}

/**
 * Server-redacted audit entries of the current version, by event id, for reviewers: the 평가 feed attaches the
 * 정정/무효화 actions and change reasons to its rows. Private execution text is never part of this contract.
 */
export function useAssessmentAudit(post: PostDetail, enabled: boolean) {
  const permissions = usePostPermissions()
  const canReview = post.knowledge?.canReview === true
  const query = useQuery({
    queryKey: [POSTS_QUERY_KEY, 'assessments', permissions.viewerKey, post.id, post.knowledge?.contentVersion],
    queryFn: () => listPostAssessmentAudit(post.id, { offset: 0, limit: 100 }),
    enabled: canReview && enabled,
  })
  return useMemo(() => new Map((query.data?.items ?? []).filter((entry) => entry.isLatest).map((entry) => [entry.eventId, entry])), [query.data])
}

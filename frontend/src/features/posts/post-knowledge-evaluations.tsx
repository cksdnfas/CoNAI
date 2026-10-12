import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostDetail, PostEvaluationStatus, PostKnowledgeTaskContext, PostKnowledgeTaskObservation, PostKnowledgeTaskPurpose } from '@conai/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, cancelPostEvaluation, getPostsSettings, listPostEvaluations, requestPostEvaluation } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { usePostPermissions } from './use-post-permissions'

const statusLabels: Record<PostEvaluationStatus, { ko: string; en: string }> = {
  queued: { ko: '대기', en: 'Queued' }, running: { ko: '평가 중', en: 'Running' }, completed: { ko: '완료', en: 'Completed' }, skipped: { ko: '건너뜀', en: 'Skipped' }, failed: { ko: '실패', en: 'Failed' }, cancelled: { ko: '취소됨', en: 'Cancelled' },
}
const purposeLabels: Record<PostKnowledgeTaskPurpose['kind'], { ko: string; en: string }> = {
  image_generation: { ko: '이미지 생성', en: 'Image generation' }, image_redraw: { ko: '이미지 다시 그리기', en: 'Image redraw' }, audio_generation: { ko: '오디오 생성', en: 'Audio generation' }, lore_save: { ko: '로어북 저장', en: 'Save lore' }, choices: { ko: '선택지', en: 'Choices' },
}
const operationStatusLabels: Record<PostKnowledgeTaskObservation['status'], { ko: string; en: string }> = {
  pending: { ko: '대기', en: 'Pending' }, succeeded: { ko: '성공', en: 'Succeeded' }, failed: { ko: '실패', en: 'Failed' }, cancelled: { ko: '취소됨', en: 'Cancelled' }, unknown: { ko: '확인 안 됨', en: 'Unknown' },
}

/** One muted line: what the run's task was and what was observed of it. */
function taskContextLine(context: PostKnowledgeTaskContext, t: ReturnType<typeof useI18n>['t']) {
  const parts = [
    context.purpose ? t(purposeLabels[context.purpose.kind]) : null,
    ...context.observations.map((observation) => t({ ko: '{operation} {status} · 산출물 {count}개', en: '{operation} {status} · {count} artifacts' }, { operation: t(purposeLabels[observation.operation]), status: t(operationStatusLabels[observation.status]), count: observation.artifactCount })),
    !context.evidenceAvailable ? t({ ko: '근거 부족', en: 'Insufficient evidence' }) : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

/** Whether the judge model is set up, and a command to evaluate the current version with it. */
export function useJudgeEvaluation(post: PostDetail) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, staleTime: 60_000 })
  const request = useMutation({
    mutationFn: () => requestPostEvaluation(post.id, post.knowledge!.contentVersion, crypto.randomUUID()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 요청하지 못했어.', en: 'Could not request evaluation.' })) }),
  })
  const configured = Boolean(settings.data?.knowledge.judgeProvider && settings.data?.knowledge.judgeModel)
  return { available: configured && post.knowledge?.canReview === true, pending: request.isPending, request: () => request.mutate() }
}

/** Judge runs on this post, newest first: status, version, time, and why one failed. */
export function PostKnowledgeEvaluations({ post, empty }: { post: PostDetail; empty?: ReactNode }) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = usePostPermissions()
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'evaluations', permissions.viewerKey, post.id], queryFn: () => listPostEvaluations(post.id), refetchInterval: (current) => current.state.data?.some((item) => item.status === 'queued' || item.status === 'running') ? 5000 : false })
  const cancel = useMutation({
    mutationFn: (requestId: string) => cancelPostEvaluation(post.id, requestId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 취소하지 못했어.', en: 'Could not cancel evaluation.' })) }),
  })
  if (query.isError) return <ErrorState size="compact" error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data) return null
  if (!query.data.length) return empty ?? null
  return (
    <section className="pt-6" aria-label={t({ ko: '판단모델 평가', en: 'Judge evaluations' })}>
      <h3 className="pb-2 text-sm font-semibold">{t({ ko: '판단모델', en: 'Judge model' })}</h3>
      {query.data.slice(0, 20).map((item) => {
        const details = [
          item.taskContext ? taskContextLine(item.taskContext, t) : null,
          item.reasonCode === 'evidence_expired' ? t({ ko: '근거 보관 기간 지남', en: 'Evidence expired' }) : null,
          item.failureDiagnostic ? [item.failureDiagnostic.errorClass, item.failureDiagnostic.httpStatus !== null ? `HTTP ${item.failureDiagnostic.httpStatus}` : null, item.failureDiagnostic.errorCode].filter(Boolean).join(' · ') : null,
        ].filter(Boolean)
        return (
          <div key={item.id} className="space-y-1 border-t border-line py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={item.status === 'failed' ? 'destructive' : item.status === 'running' || item.status === 'queued' ? 'info' : 'ghost'}>{t(statusLabels[item.status])}</Badge>
              <span>{t({ ko: '{version}판', en: 'v{version}' }, { version: item.contentVersion })} · {formatDateTime(item.createdAt)}{item.totalTokens !== null ? ` · ${t({ ko: '{tokens} 토큰', en: '{tokens} tokens' }, { tokens: item.totalTokens })}` : ''}</span>
              <span className="flex-1" />
              {item.canCancel ? <Button variant="ghost" size="xs" disabled={cancel.isPending} onClick={() => cancel.mutate(item.id)}>{t({ ko: '취소', en: 'Cancel' })}</Button> : null}
            </div>
            {details.length ? <p className="text-xs text-muted-foreground">{details.join(' · ')}</p> : null}
          </div>
        )
      })}
    </section>
  )
}

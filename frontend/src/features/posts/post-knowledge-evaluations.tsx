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
  pending: { ko: '대기', en: 'Pending' }, succeeded: { ko: '작업 성공', en: 'Operation succeeded' }, failed: { ko: '작업 실패', en: 'Operation failed' }, cancelled: { ko: '취소됨', en: 'Cancelled' }, unknown: { ko: '확인 안 됨', en: 'Unknown' },
}

function EvaluationTaskContext({ context }: { context: PostKnowledgeTaskContext }) {
  const { t, formatDateTime } = useI18n()
  return <div className="space-y-1 text-xs text-muted-foreground">
    {context.purpose ? <p>{t({ ko: '내 요청의 목적: {purpose}', en: 'Purpose of my request: {purpose}' }, { purpose: t(purposeLabels[context.purpose.kind]) })}</p> : null}
    {context.observations.map((observation, index) => <p key={index}>{t({ ko: '확인된 작업: {operation} · {status} · 산출물 {count}개 · {when}', en: 'Observed operation: {operation} · {status} · {count} artifacts · {when}' }, { operation: t(purposeLabels[observation.operation]), status: t(operationStatusLabels[observation.status]), count: observation.artifactCount, when: formatDateTime(observation.observedAt) })}</p>)}
    <p>{t({ ko: '전체 목표 달성 여부는 확인되지 않았어.', en: 'Whether the overall goal was achieved is not verified.' })}</p>
    {!context.evidenceAvailable ? <p>{t({ ko: '작업 결과를 판단할 근거가 부족해.', en: 'There is insufficient evidence to assess the operation outcome.' })}</p> : null}
  </div>
}

export function PostKnowledgeEvaluations({ post }: { post: PostDetail }) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = usePostPermissions()
  const settings = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, staleTime: 60_000 })
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'evaluations', permissions.viewerKey, post.id], queryFn: () => listPostEvaluations(post.id), refetchInterval: (current) => current.state.data?.some((item) => item.status === 'queued' || item.status === 'running') ? 5000 : false })
  const request = useMutation({
    mutationFn: () => requestPostEvaluation(post.id, post.knowledge!.contentVersion, crypto.randomUUID()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 요청하지 못했어.', en: 'Could not request evaluation.' })) }),
  })
  const cancel = useMutation({
    mutationFn: (requestId: string) => cancelPostEvaluation(post.id, requestId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 취소하지 못했어.', en: 'Could not cancel evaluation.' })) }),
  })
  const judgeConfigured = Boolean(settings.data?.knowledge.judgeProvider && settings.data?.knowledge.judgeModel)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3"><h3 className="flex-1 text-sm font-medium">{t({ ko: '판단모델 평가', en: 'Judge evaluations' })}</h3>{post.knowledge?.canReview ? <Button variant="ghost" size="sm" disabled={request.isPending || !judgeConfigured} onClick={() => request.mutate()}>{t({ ko: '현재 판 평가 요청', en: 'Evaluate current version' })}</Button> : null}</div>
      {!judgeConfigured ? <p className="text-xs text-muted-foreground">{t({ ko: '게시판 설정에서 판단모델을 선택하면 평가를 요청할 수 있어.', en: 'Choose a judge in Posts settings to request evaluations.' })}</p> : null}
      {query.isError ? <ErrorState size="compact" error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data?.length ? <div>{query.data.slice(0, 20).map((item) => <div key={item.id} className="space-y-2 border-b border-line py-2 last:border-0">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={item.status === 'failed' ? 'destructive' : item.status === 'running' || item.status === 'queued' ? 'info' : 'ghost'}>{t(statusLabels[item.status])}</Badge><span className="text-xs text-muted-foreground">{t({ ko: '내용 {version}판', en: 'Content version {version}' }, { version: item.contentVersion })} · {formatDateTime(item.createdAt)}{item.totalTokens !== null ? ` · ${t({ ko: '{tokens} 토큰', en: '{tokens} tokens' }, { tokens: item.totalTokens })}` : ''}</span><span className="flex-1" />{item.canCancel ? <Button variant="ghost" size="xs" disabled={cancel.isPending} onClick={() => cancel.mutate(item.id)}>{t({ ko: '취소', en: 'Cancel' })}</Button> : null}</div>
        {item.taskContext ? <EvaluationTaskContext context={item.taskContext} /> : null}
        {item.reasonCode === 'evidence_expired' ? <p className="text-xs text-muted-foreground">{t({ ko: '근거 보관 기간이 끝나 원문을 확인할 수 없어.', en: 'The evidence retention period ended; the original evidence is unavailable.' })}</p> : null}
        {item.failureDiagnostic ? <p className="text-xs text-muted-foreground">{t({ ko: '실패 정보: {type}', en: 'Failure details: {type}' }, { type: item.failureDiagnostic.errorClass })}{item.failureDiagnostic.httpStatus !== null ? ` · HTTP ${item.failureDiagnostic.httpStatus}` : ''}{item.failureDiagnostic.errorCode ? ` · ${item.failureDiagnostic.errorCode}` : ''}</p> : null}
      </div>)}</div> : null}
    </div>
  )
}

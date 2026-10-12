import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostDetail, PostTopicEvaluationView, TopicRelevanceLevel } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Progress } from '@/components/ui/progress'
import { ErrorState } from '@/components/ui/error-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { getErrorMessage } from '@/lib/error-message'
import { POSTS_QUERY_KEY, getPostTopicEvaluation, requestPostTopicEvaluation } from '@/lib/api-posts'
import { usePostPermissions } from './use-post-permissions'

type Translate = ReturnType<typeof useI18n>['t']
const LEVELS: Record<TopicRelevanceLevel, { ko: string; en: string }> = {
  none: { ko: '무관', en: 'Unrelated' }, mention: { ko: '단순 언급', en: 'Mention' },
  partial: { ko: '일부 관련', en: 'Partially related' }, major: { ko: '주요 주제', en: 'Major topic' },
  core: { ko: '핵심 주제', en: 'Core topic' }, unknown: { ko: '판단 불가', en: 'Unknown' },
  mixed: { ko: '등급 혼합', en: 'Mixed levels' },
}
function stateLabel(value: PostTopicEvaluationView, t: Translate) {
  if (value.staleReason && !value.isCurrent) return t(value.staleReason === 'content_changed'
    ? { ko: '이전 내용 기준', en: 'Previous content' }
    : { ko: '기준 변경', en: 'Criteria changed' })
  const labels = {
    unassessed: { ko: '아직 평가하지 않음', en: 'Not evaluated' }, queued: { ko: '평가 대기', en: 'Queued' },
    running: { ko: '평가 중', en: 'Evaluating' }, completed: { ko: '평가 완료', en: 'Evaluated' },
    partial: { ko: '부분 완료', en: 'Partially evaluated' }, skipped: { ko: '평가 보류', en: 'Deferred' },
    failed: { ko: '평가 실패', en: 'Evaluation failed' }, cancelled: { ko: '평가 취소', en: 'Cancelled' },
    superseded: { ko: '다시 평가 필요', en: 'Re-evaluation needed' },
  }
  return t(labels[value.status])
}
function notice(value: PostTopicEvaluationView, t: Translate) {
  if (value.staleReason && !value.isCurrent) return t({ ko: '이전 결과는 참고값이야. 현재 내용과 기준으로 다시 평가하면 갱신돼.', en: 'Previous scores are for reference. Re-evaluate to use the current content and criteria.' })
  const reasons: Record<string, { ko: string; en: string }> = {
    daily_budget: { ko: '오늘 평가 한도에 도달했어. 한도 갱신 후 다시 요청할 수 있어.', en: 'The daily evaluation limit was reached. Request again after it resets.' },
    judge_unavailable: { ko: '판단 모델이 준비되지 않았어. 공통 평가 설정을 확인해.', en: 'The judge is unavailable. Check shared evaluation settings.' },
    topics_empty: { ko: '평가할 주제가 없어.', en: 'No evaluation topics are enabled.' },
    input_budget: { ko: '평가 기준과 본문이 입력 한도를 초과해 평가를 보류했어.', en: 'The evaluation input exceeds the configured limit.' },
    evaluation_disabled: { ko: '자동 평가가 꺼져 있어.', en: 'Automatic evaluations are off.' },
    judge_failed: { ko: '모델 응답을 받지 못했어. 글은 저장되어 있어.', en: 'The model did not return a result. The post is saved.' },
    invalid_response: { ko: '모델이 올바른 관련도 응답을 반환하지 않았어. 모델과 평가 기준을 확인해.', en: 'The model returned no valid topic answers. Check the model and criteria.' },
    access_revoked: { ko: '평가 요청 권한이 변경되어 중단했어.', en: 'Evaluation access changed, so the request was stopped.' },
  }
  if (value.reasonCode && reasons[value.reasonCode]) return t(reasons[value.reasonCode])
  if (value.coverage === 'partial') return t({ ko: '긴 글의 일부 본문을 평가한 참고값이야.', en: 'These estimates use only part of the document.' })
  if (value.status === 'partial') return t({ ko: '일부 주제의 응답이 없어. 응답한 항목만 점수를 표시해.', en: 'Some topics were unanswered. Only valid answers have scores.' })
  return null
}

export function PostTopicSummary({ value }: { value: PostTopicEvaluationView | undefined }) {
  const { t } = useI18n()
  if (!value || !value.requestId && !value.canRequest) return null
  const items = value.isCurrent ? value.items.filter(item => item.score !== null && item.score >= value.minimumScore).sort((a,b) => (b.score ?? 0) - (a.score ?? 0)).slice(0,value.maximumTopics) : []
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs" aria-label={t({ ko: '주제 관련도', en: 'Topic relevance' })}>
      <span className="text-muted-foreground">{t({ ko: '주제 관련도', en: 'Topic relevance' })}</span>
      {items.map(item => <Chip key={item.topicId} tone="muted" size="sm"><span className="truncate">{item.name}</span><span className="shrink-0 tabular-nums">{item.score}%</span></Chip>)}
      {items.length === 0 ? <span className="text-muted-foreground">{value.isCurrent && value.items.some(item => item.score !== null)
        ? t({ ko: '표시 기준에 해당하는 주제 없음', en: 'No topic meets the display threshold' })
        : value.isCurrent && value.items.length > 0 && value.items.every(item => item.answerStatus === 'unknown')
          ? t({ ko: '판단 불가', en: 'Unknown' }) : stateLabel(value,t)}</span> : null}
      {value.coverage === 'partial' && value.isCurrent ? <span className="text-muted-foreground">{t({ ko: '· 일부 본문 기준', en: '· Partial document' })}</span> : null}
      {items.length > 0 && value.status !== 'completed' ? <span className="text-muted-foreground">· {stateLabel(value,t)}</span> : null}
    </span>
  )
}

export function PostTopicRelevance({ post }: { post: PostDetail }) {
  const { t, formatDateTime } = useI18n()
  const { viewerKey } = usePostPermissions()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const command = useRef<{ hash: string; key: string; force: boolean } | null>(null)
  const key = [POSTS_QUERY_KEY,'topic-evaluation',viewerKey,post.id]
  const query = useQuery({
    queryKey: key, queryFn: () => getPostTopicEvaluation(post.id), initialData: post.topicEvaluation,
    enabled: Boolean(post.topicEvaluation?.requestId || post.topicEvaluation?.canRequest),
    refetchInterval: result => ['queued','running'].includes(result.state.data?.status ?? '') ? 5000 : false,
  })
  const value = query.data?.contentHash === post.topicEvaluation?.contentHash ? query.data : post.topicEvaluation
  const request = useMutation({
    mutationFn: () => {
      if (!value) throw new Error(t({ ko: '글을 다시 불러와줘.', en: 'Reload the post.' }))
      const force = Boolean(value.evaluatedAt)
      if (!command.current || command.current.hash !== value.contentHash || command.current.force !== force) command.current = { hash: value.contentHash, force, key: crypto.randomUUID() }
      return requestPostTopicEvaluation(post.id,{ expectedContentHash: value.contentHash, idempotencyKey: command.current.key, force })
    },
    onSuccess: async next => {
      command.current = null
      queryClient.setQueryData(key,next)
      await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
    },
    onError: error => showSnackbar({ tone: 'error', message: getErrorMessage(error,t({ ko: '평가를 요청하지 못했어.', en: 'Could not request an evaluation.' })) }),
  })
  if (!value || !value.requestId && !value.canRequest) return null
  const waiting = ['queued','running'].includes(value.status)
  const message = notice(value,t)
  const items = [...value.items].filter(item => showAll || item.score === null || item.score >= value.minimumScore).sort((a,b) => (b.score ?? -1) - (a.score ?? -1))
  return (
    <section className="border-y border-line py-4" aria-label={t({ ko: '게시물 주제 관련도', en: 'Post topic relevance' })}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{stateLabel(value,t)}</span>
        <Button variant="ghost" size="xs" className="ml-auto" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? { ko: '접기', en: 'Collapse' } : value.staleReason ? { ko: '이전 결과 보기', en: 'Show previous result' } : { ko: '자세히', en: 'Details' })}</Button>
      </div>
      <div className="mt-2" aria-live="polite"><PostTopicSummary value={value} /></div>
      {message ? <p className="mt-3 text-xs text-muted-foreground">{message}</p> : null}
      {expanded ? <div className="mt-3 space-y-4">
        {items.map(item => <div key={item.topicId} className="border-b border-line pb-3 last:border-b-0">
          <div className="mb-2 flex min-w-0 items-center gap-3"><span className="min-w-0 break-words text-sm">{item.name}</span><span className="text-xs text-muted-foreground">{t(item.answerStatus === 'missing' ? { ko: '응답 없음', en: 'No answer' } : LEVELS[item.level])}</span><span className="ml-auto shrink-0 text-sm tabular-nums">{item.score === null ? '—' : item.score + '%'}</span></div>
          {item.score !== null ? <Progress size="sm" value={item.score} indicatorClassName="bg-foreground/60" aria-label={t({ ko: '{name} 관련도', en: '{name} relevance' }, { name: item.name })} /> : null}
          <p className="mt-2 break-words text-xs text-muted-foreground">{item.description}</p>
        </div>)}
        {value.items.length ? <Button variant="ghost" size="xs" onClick={() => setShowAll(!showAll)}>{t(showAll ? { ko: '높은 관련도만 보기', en: 'Show higher scores' } : { ko: '낮은 관련도도 보기', en: 'Show lower scores' })}</Button> : null}
        <div className="text-xs text-muted-foreground">{t({ ko: 'AI 추정치 · 주제별 독립 평가', en: 'AI estimates · independent topic scores' })}{value.modelLabel ? <p className="mt-1">{value.modelLabel}{value.evaluatedAt ? ' · ' + formatDateTime(value.evaluatedAt) : ''}</p> : null}{value.coverage === 'partial' ? <p className="mt-1">{t({ ko: '평가에 사용한 본문 {used}/{total}자', en: 'Document characters evaluated: {used}/{total}' }, { used: value.inputCharacters ?? 0, total: value.totalCharacters ?? 0 })}</p> : null}</div>
        {value.canRequest ? <Button variant="subtle" size="sm" disabled={waiting || request.isPending} onClick={() => request.mutate()}>{t(waiting ? { ko: '평가 진행 중', en: 'Evaluation pending' } : value.evaluatedAt ? { ko: '다시 평가', en: 'Re-evaluate' } : { ko: '평가 요청', en: 'Request evaluation' })}</Button> : null}
        {query.isError ? <ErrorState size="compact" error={query.error} onRetry={() => void query.refetch()} /> : null}
      </div> : null}
    </section>
  )
}

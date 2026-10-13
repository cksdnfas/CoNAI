import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostDetail, PostTopicEvaluationView, TopicRelevanceItem, TopicRelevanceLevel } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Progress } from '@/components/ui/progress'
import { ErrorState } from '@/components/ui/error-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getErrorMessage } from '@/lib/error-message'
import { POSTS_QUERY_KEY, getPostTopicEvaluation, requestPostTopicEvaluation } from '@/lib/api-posts'
import { cn } from '@/lib/utils'
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
/** Why the last run produced no (full) result; one short line, only when it explains a missing score. */
function failureNote(value: PostTopicEvaluationView, t: Translate) {
  const reasons: Record<string, { ko: string; en: string }> = {
    daily_budget: { ko: '오늘 평가 한도 도달', en: 'Daily limit reached' },
    judge_unavailable: { ko: '판단 모델 준비 안 됨', en: 'Judge unavailable' },
    topics_empty: { ko: '평가할 주제 없음', en: 'No topics enabled' },
    input_budget: { ko: '입력 한도 초과', en: 'Input limit exceeded' },
    evaluation_disabled: { ko: '자동 평가 꺼짐', en: 'Automatic evaluation off' },
    judge_failed: { ko: '모델 응답 없음', en: 'No model response' },
    invalid_response: { ko: '모델 응답 형식 오류', en: 'Invalid model response' },
    access_revoked: { ko: '권한 변경으로 중단', en: 'Stopped: access changed' },
  }
  return value.reasonCode && reasons[value.reasonCode] ? t(reasons[value.reasonCode]) : null
}
function topItems(value: PostTopicEvaluationView) {
  return value.items.filter(item => item.score !== null && item.score >= value.minimumScore).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, value.maximumTopics)
}

export function PostTopicSummary({ value }: { value: PostTopicEvaluationView | undefined }) {
  const { t } = useI18n()
  if (!value || !value.requestId && !value.canRequest) return null
  const items = value.isCurrent ? topItems(value) : []
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

/** The open post's topic evaluation, shared by the header chips, the 평가 tab and the ⋯ menu. */
export function usePostTopicEvaluation(post: PostDetail) {
  const { t } = useI18n()
  const { viewerKey } = usePostPermissions()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const command = useRef<{ hash: string; key: string; force: boolean } | null>(null)
  const key = [POSTS_QUERY_KEY, 'topic-evaluation', viewerKey, post.id]
  const query = useQuery({
    queryKey: key, queryFn: () => getPostTopicEvaluation(post.id), initialData: post.topicEvaluation,
    enabled: Boolean(post.topicEvaluation?.requestId || post.topicEvaluation?.canRequest),
    refetchInterval: result => ['queued', 'running'].includes(result.state.data?.status ?? '') ? 5000 : false,
  })
  const fetched = query.data?.contentHash === post.topicEvaluation?.contentHash ? query.data : post.topicEvaluation
  const value = fetched && (fetched.requestId || fetched.canRequest) && !post.knowledge?.deletedAt ? fetched : null
  const request = useMutation({
    mutationFn: () => {
      if (!value) throw new Error(t({ ko: '글을 다시 불러와줘.', en: 'Reload the post.' }))
      const force = Boolean(value.evaluatedAt)
      if (!command.current || command.current.hash !== value.contentHash || command.current.force !== force) command.current = { hash: value.contentHash, force, key: crypto.randomUUID() }
      return requestPostTopicEvaluation(post.id, { expectedContentHash: value.contentHash, idempotencyKey: command.current.key, force })
    },
    onSuccess: async next => {
      command.current = null
      queryClient.setQueryData(key, next)
      await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
    },
    onError: error => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 요청하지 못했어.', en: 'Could not request an evaluation.' })) }),
  })
  const waiting = value !== null && ['queued', 'running'].includes(value.status)
  return {
    value,
    waiting,
    canRequest: Boolean(value?.canRequest) && !waiting && !request.isPending,
    request: () => request.mutate(),
    error: query.isError ? query.error : null,
    retry: () => void query.refetch(),
  }
}
export type PostTopicEvaluationState = ReturnType<typeof usePostTopicEvaluation>

/** Header chips next to the tags: the top topics with a fill bar of their score. */
/** Whether the header shows any topic chip (scores above the display threshold, or an evaluation in progress). */
export function hasPostTopicChips(topic: PostTopicEvaluationState) {
  return Boolean(topic.value && (topic.waiting || topItems(topic.value).length))
}

export function PostTopicChips({ topic, divider = true }: { topic: PostTopicEvaluationState; divider?: boolean }) {
  const { t, formatDateTime } = useI18n()
  const { value, waiting } = topic
  if (!value) return null
  const items = topItems(value)
  if (!items.length && !waiting) return null
  const stale = Boolean(value.staleReason && !value.isCurrent)
  const tip = stale ? stateLabel(value, t)
    : [t({ ko: '주제 관련도', en: 'Topic relevance' }), value.modelLabel, value.evaluatedAt ? formatDateTime(value.evaluatedAt) : null].filter(Boolean).join(' · ')
  return (
    <>
      {divider ? <span aria-hidden className="mx-1 h-3.5 w-px bg-line" /> : null}
      {items.length ? (
        <Tip content={tip}>
          <span className={cn('inline-flex flex-wrap items-center gap-1', stale && 'opacity-50')} aria-label={t({ ko: '주제 관련도', en: 'Topic relevance' })} tabIndex={0}>
            {items.map(item => (
              <Chip key={item.topicId} tone="muted" className="relative gap-1 overflow-hidden pt-0.5 pb-1 text-foreground">
                <span className="truncate">{item.name}</span>
                <span className="tabular-nums text-muted-foreground">{item.score}</span>
                <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-primary/70" style={{ width: `${item.score}%` }} />
              </Chip>
            ))}
          </span>
        </Tip>
      ) : null}
      {waiting ? <Chip tone="muted" className="py-0.5">{t({ ko: '평가 중', en: 'Evaluating' })}</Chip> : null}
    </>
  )
}

function TopicRow({ item }: { item: TopicRelevanceItem }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1.5 border-t border-line py-2.5">
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <Tip content={item.description}><span className="min-w-0 truncate" tabIndex={0}>{item.name}</span></Tip>
        <span className="text-xs text-muted-foreground">{t(item.answerStatus === 'missing' ? { ko: '응답 없음', en: 'No answer' } : LEVELS[item.level])}</span>
        <span className="ml-auto shrink-0 tabular-nums">{item.score === null ? '—' : item.score}</span>
      </div>
      {item.score !== null ? <Progress size="sm" value={item.score} indicatorClassName="bg-primary/70" aria-label={t({ ko: '{name} 관련도', en: '{name} relevance' }, { name: item.name })} /> : null}
    </div>
  )
}

/** Every topic with its level and score; low scores behind a toggle. Lives in the 평가 tab. */
export function PostTopicDetails({ topic }: { topic: PostTopicEvaluationState }) {
  const { t, formatDateTime } = useI18n()
  const [showAll, setShowAll] = useState(false)
  const { value } = topic
  if (!value) return null
  const sorted = [...value.items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const high = sorted.filter(item => item.score === null || item.score >= value.minimumScore)
  const items = showAll ? sorted : high
  const note = failureNote(value, t)
  const meta = [value.status === 'completed' && value.isCurrent ? null : stateLabel(value, t), value.modelLabel, value.evaluatedAt ? formatDateTime(value.evaluatedAt) : null,
    value.coverage === 'partial' ? t({ ko: '본문 {used}/{total}자', en: '{used}/{total} chars' }, { used: value.inputCharacters ?? 0, total: value.totalCharacters ?? 0 }) : null, note].filter(Boolean).join(' · ')
  return (
    <section className="pt-6" aria-label={t({ ko: '주제 관련도', en: 'Topic relevance' })}>
      <div className="flex items-center gap-2 pb-2">
        <h3 className="text-sm font-semibold">{t({ ko: '주제', en: 'Topics' })}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-live="polite">{meta}</span>
      </div>
      <div className={cn(value.staleReason && !value.isCurrent && 'opacity-60')}>{items.map(item => <TopicRow key={item.topicId} item={item} />)}</div>
      {sorted.length > high.length ? <Button variant="ghost" size="xs" className="mt-1" onClick={() => setShowAll(!showAll)}>{t(showAll ? { ko: '높은 관련도만', en: 'Higher scores only' } : { ko: '낮은 관련도 {count}개 더', en: '{count} lower scores' }, { count: sorted.length - high.length })}</Button> : null}
      {topic.error ? <ErrorState size="compact" error={topic.error} onRetry={topic.retry} /> : null}
    </section>
  )
}

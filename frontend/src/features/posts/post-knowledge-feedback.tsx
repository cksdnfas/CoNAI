import { useState } from 'react'
import type { PostAssessmentAuditEntry, PostAssessmentEvaluator, PostAssessmentQuality, PostDetail, PostQualityGroup, PostQualityStats } from '@conai/shared'
import { Bot, Info, Scale, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useRelativeTime } from './post-author'
import { AssessmentModerationDialog, useAssessmentAudit } from './post-knowledge-assessments'
import { KNOWLEDGE_REASONS, usePostKnowledgeState, usePostQuality } from './post-knowledge-panel'
import { PostKnowledgeTaskFit, type KnowledgeSearchContext } from './post-knowledge-task-fit'
import { PostQuote } from './post-quote'
import { PostTopicDetails, type PostTopicEvaluationState } from './post-topic-relevance'

const EVALUATORS: Record<PostAssessmentEvaluator, { label: { ko: string; en: string }; icon: typeof User }> = {
  human: { label: { ko: '사람', en: 'Person' }, icon: User },
  use_ai: { label: { ko: '사용 AI', en: 'AI user' }, icon: Bot },
  judge: { label: { ko: '판단모델', en: 'Judge' }, icon: Scale },
}
const QUALITY: Record<PostAssessmentQuality, { label: { ko: string; en: string }; className: string }> = {
  up: { label: { ko: '추천', en: 'Up' }, className: 'bg-primary/15 text-primary' },
  down: { label: { ko: '비추천', en: 'Down' }, className: 'bg-info-soft text-info-soft-foreground' },
  abstain: { label: { ko: '기권', en: 'Abstain' }, className: 'bg-surface-high text-muted-foreground' },
}

const short = (value: number) => Number(value.toFixed(1))

function GroupBar({ label, group, scale }: { label: string; group: PostQualityGroup; scale: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-surface-low" aria-hidden>
        <span className="bg-primary" style={{ width: `${(group.up / scale) * 100}%` }} />
        <span className="bg-info" style={{ width: `${(group.down / scale) * 100}%` }} />
      </span>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums" aria-label={`${label} ${short(group.up)} / ${short(group.down)}`}>{short(group.up)} · {short(group.down)}</span>
    </div>
  )
}

function ScoreSummary({ stats }: { stats: PostQualityStats }) {
  const { t } = useI18n()
  const score = short(stats.up - stats.down)
  const groups = [
    { label: t({ ko: '사람', en: 'People' }), group: stats.current.human },
    { label: t({ ko: '사용 AI', en: 'AI users' }), group: stats.current.useAi },
    { label: t({ ko: '판단모델', en: 'Judge' }), group: stats.current.judge },
  ]
  const scale = Math.max(1, ...groups.map(({ group }) => group.up + group.down))
  const details = [
    t({ ko: '이전 판 추천 {up} · 비추천 {down} · 기여 {weight}', en: 'Earlier versions up {up} · down {down} · weight {weight}' }, { up: short(stats.history.up), down: short(stats.history.down), weight: stats.history.effectiveWeight.toFixed(2) }),
    t({ ko: '참조 우선도 배율 {value}', en: 'Reference multiplier {value}' }, { value: stats.qualityMultiplier.toFixed(3) }),
    t({ ko: '자동 평가 기여 {weight}/{cap}', en: 'Automatic weight {weight}/{cap}' }, { weight: stats.aiEffectiveWeight.toFixed(2), cap: stats.aiCap.toFixed(2) }),
    t({ ko: '정책 {policy}', en: 'Policy {policy}' }, { policy: stats.policyVersion }),
  ]
  return (
    <div className="flex items-center gap-8 py-5">
      <div className="flex min-w-20 flex-col gap-1">
        <span className="text-3xl leading-none font-bold tabular-nums">{score > 0 ? `+${score}` : score}</span>
        <Tip content={<span className="flex flex-col gap-0.5">{details.map((line) => <span key={line}>{line}</span>)}</span>}>
          <span className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground" tabIndex={0}>
            {t({ ko: '{version}판', en: 'v{version}' }, { version: stats.contentVersion })}<Info className="size-3" />
          </span>
        </Tip>
      </div>
      <div className="flex flex-1 flex-col gap-2.5">{groups.map((entry) => <GroupBar key={entry.label} {...entry} scale={scale} />)}</div>
    </div>
  )
}

function FeedbackRow({ item, audit, onModerate }: {
  item: PostQualityStats['reasons'][number]
  audit: PostAssessmentAuditEntry | undefined
  onModerate: (entry: PostAssessmentAuditEntry, action: 'invalidate' | 'correct') => void
}) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const evaluator = EVALUATORS[item.evaluator]
  const Icon = evaluator.icon
  const reasonLabel = item.reasonCode ? KNOWLEDGE_REASONS.find((entry) => entry.value === item.reasonCode) : undefined
  return (
    <div className="grid grid-cols-[2rem_1fr] gap-2.5 border-t border-line py-3">
      <span className="flex size-8 items-center justify-center rounded-full bg-surface-low text-muted-foreground"><Icon className="size-4" /></span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="text-sm font-medium text-foreground">{t(evaluator.label)}</span>
          <span className={cn('rounded-sm px-1.5 leading-5', QUALITY[item.quality].className)}>{t(QUALITY[item.quality].label)}{reasonLabel ? ` · ${t(reasonLabel)}` : ''}</span>
          {!item.current ? <span>{t({ ko: '{version}판', en: 'v{version}' }, { version: item.contentVersion })}</span> : null}
          <span>{relative(item.createdAt)}</span>
          {audit?.canModerate && item.evaluator !== 'human' ? (
            <span className="ml-auto flex gap-0.5">
              <Button variant="ghost" size="xs" onClick={() => onModerate(audit, 'correct')}>{t({ ko: '정정', en: 'Correct' })}</Button>
              <Button variant="ghost" size="xs" onClick={() => onModerate(audit, 'invalidate')}>{t({ ko: '무효화', en: 'Invalidate' })}</Button>
            </span>
          ) : null}
        </div>
        {item.reason ? <p className="whitespace-pre-wrap text-sm">{item.reason}</p> : null}
        {item.evidenceQuote ? <PostQuote size="xs">{item.evidenceQuote}</PostQuote> : null}
        {audit?.moderationReason ? <p className="text-xs text-muted-foreground">{t({ ko: '변경 이유: {reason}', en: 'Change reason: {reason}' }, { reason: audit.moderationReason })}</p> : null}
      </div>
    </div>
  )
}

/** The 평가 tab: search fit, the score with its evaluator split, every reason as a comment-like row, then topics. */
export function PostKnowledgeFeedback({ post, topic, searchContext }: { post: PostDetail; topic: PostTopicEvaluationState; searchContext: KnowledgeSearchContext | null }) {
  const { active } = usePostKnowledgeState(post)
  const quality = usePostQuality(post, active)
  const audit = useAssessmentAudit(post, active)
  const [moderating, setModerating] = useState<{ entry: PostAssessmentAuditEntry; action: 'invalidate' | 'correct' } | null>(null)
  const stats = quality.data
  return (
    <div>
      {active ? <PostKnowledgeTaskFit key={searchContext?.receipt.token ?? 'direct'} post={post} context={searchContext} /> : null}
      {active ? quality.isPending ? <LoadingState /> : quality.isError ? <ErrorState size="compact" error={quality.error} onRetry={() => void quality.refetch()} /> : stats ? <>
        <ScoreSummary stats={stats} />
        {stats.reasons.map((item) => <FeedbackRow key={item.eventId} item={item} audit={audit.get(item.eventId)} onModerate={(entry, action) => setModerating({ entry, action })} />)}
      </> : null : null}
      <PostTopicDetails topic={topic} />
      {moderating ? <AssessmentModerationDialog post={post} {...moderating} onClose={() => setModerating(null)} /> : null}
    </div>
  )
}

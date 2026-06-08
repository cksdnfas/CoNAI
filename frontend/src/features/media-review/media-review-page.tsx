import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, CheckCircle2, CircleDot, ClipboardList, Filter, FolderPlus, FolderTree, Loader2, RotateCw, Search, ShieldCheck, Sigma, Star, Tags, Undo2, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { PageHeader } from '@/components/common/page-header'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useAuthPermissionRedirect } from '@/features/auth/use-auth-permission-redirect'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { buildComplexFilterPayload } from '@/features/search/search-utils'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { addImagesToGroup, getGroupsHierarchyAll } from '@/lib/api-groups'
import { batchTagImages, getImages, getSimilarImages, searchImagesComplex } from '@/lib/api-images'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import {
  buildMediaReviewCleanupStagingPlan,
  buildMediaReviewOperationalTrends,
  buildMediaReviewSearchChips,
  buildMediaReviewSimilarityDecisionHistory,
  filterMediaReviewImages,
  getMediaReviewGroupQualityChecks,
  getMediaReviewRecommendedQueues,
  getMediaReviewSignals,
  getMediaReviewSignalSummary,
  getMediaReviewSimilarityDecisionSummary,
  getMediaReviewTagQualitySuggestions,
  type MediaReviewQueueKey,
  type MediaReviewCleanupStageAction,
  type MediaReviewCleanupStageItem,
  type MediaReviewCleanupStagingPlan,
  type MediaReviewGroupQualityCheck,
  type MediaReviewOperationalTrend,
  type MediaReviewRecommendedQueue,
  type MediaReviewSimilarityDecisionHistoryItem,
  type MediaReviewSimilarityDecisionKind,
  type MediaReviewTagQualitySuggestion,
} from './media-review-utils'

type ReviewImagesPageParam = number | {
  cursorDate?: string | null
  cursorHash?: string | null
}

const REVIEW_QUEUE_OPTIONS: Array<{ value: MediaReviewQueueKey; icon: typeof Filter; label: { ko: string; en: string } }> = [
  { value: 'all', icon: Filter, label: { ko: '전체', en: 'All' } },
  { value: 'needs-review', icon: CheckCircle2, label: { ko: '검토 대기', en: 'Needs review' } },
  { value: 'reviewed', icon: CheckCircle2, label: { ko: '검토 완료', en: 'Reviewed' } },
  { value: 'ungrouped', icon: FolderTree, label: { ko: '그룹 없음', en: 'Ungrouped' } },
  { value: 'missing-tags', icon: Tags, label: { ko: '태그 없음', en: 'No tags' } },
  { value: 'sparse-tags', icon: Sigma, label: { ko: '태그 부족', en: 'Sparse tags' } },
  { value: 'unrated', icon: Star, label: { ko: '평가 없음', en: 'Unrated' } },
  { value: 'similar', icon: CircleDot, label: { ko: '유사', en: 'Similar' } },
  { value: 'recoverable', icon: Undo2, label: { ko: '복구 점검', en: 'Recover' } },
]

function getImageListId(image: ImageRecord) {
  return String(image.composite_hash ?? image.id)
}

function getImageCompositeHash(image: ImageRecord | null | undefined) {
  return typeof image?.composite_hash === 'string' && image.composite_hash.length > 0 ? image.composite_hash : null
}

function SignalTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Filter }) {
  return (
    <PageInset className="flex items-center gap-3 px-3 py-2">
      <Icon className="h-4 w-4 text-primary" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold text-foreground">{value}</div>
      </div>
    </PageInset>
  )
}

function getReviewQueueOption(queue: MediaReviewQueueKey) {
  return REVIEW_QUEUE_OPTIONS.find((option) => option.value === queue) ?? REVIEW_QUEUE_OPTIONS[0]
}

function getRecommendationToneClass(priority: 'high' | 'medium' | 'low') {
  if (priority === 'high') {
    return 'border-amber-400/50 bg-amber-500/10 text-amber-100'
  }

  if (priority === 'medium') {
    return 'border-sky-400/40 bg-sky-500/10 text-sky-100'
  }

  return 'border-border bg-surface-lowest text-muted-foreground'
}

function getOperationalTrendToneClass(tone: MediaReviewOperationalTrend['tone']) {
  if (tone === 'attention') {
    return 'border-amber-400/50 bg-amber-500/10'
  }

  if (tone === 'watch') {
    return 'border-sky-400/40 bg-sky-500/10'
  }

  return 'border-emerald-400/35 bg-emerald-500/10'
}

function getQueueRecommendationReason(queue: MediaReviewQueueKey) {
  if (queue === 'recoverable') {
    return { ko: '누락/휴지통 상태를 먼저 확인해.', en: 'Check missing or recycled records first.' }
  }

  if (queue === 'missing-tags') {
    return { ko: '태그가 없는 항목은 검색성과 등급 판단이 약해.', en: 'Items without tags weaken search and rating decisions.' }
  }

  if (queue === 'sparse-tags') {
    return { ko: '태그 수가 낮은 항목은 재점검 후보야.', en: 'Low tag coverage makes these good recheck candidates.' }
  }

  if (queue === 'ungrouped') {
    return { ko: '그룹 없는 항목을 묶으면 라이브러리 탐색성이 올라가.', en: 'Grouping unassigned items improves library navigation.' }
  }

  if (queue === 'unrated') {
    return { ko: '등급 신호가 없어 안전 표시 판단을 보강해야 해.', en: 'Missing rating signals need review for safety display.' }
  }

  if (queue === 'similar') {
    return { ko: '선택 기준과 가까운 결과를 비교해 중복 후보를 판단해.', en: 'Compare items near the selected anchor for duplicate decisions.' }
  }

  return { ko: '아직 세션 검토 완료 표시가 없는 항목이야.', en: 'Items not yet marked reviewed in this session.' }
}

function getMediaReviewOperationalTrendCopy(trend: MediaReviewOperationalTrend) {
  if (trend.key === 'review-queue') {
    return {
      title: { ko: '리뷰 큐 추세', en: 'Review queue trend' },
      body: { ko: '세션 검토 완료와 현재 표시 큐를 비교해 남은 판단량을 보여줘.', en: 'Compares session-reviewed items with the current visible queue backlog.' },
      primary: { ko: '대기 {count}', en: '{count} waiting' },
      secondary: { ko: '표시 {count}', en: '{count} visible' },
    }
  }

  if (trend.key === 'quality-backlog') {
    return {
      title: { ko: '품질 백로그 추세', en: 'Quality backlog trend' },
      body: { ko: '태그, 등급, 그룹 신호가 약한 항목을 추천 큐와 함께 묶어 보여줘.', en: 'Combines weak tag, rating, and group signals with recommended queues.' },
      primary: { ko: '백로그 {count}', en: '{count} backlog' },
      secondary: { ko: '추천 {count}', en: '{count} recommendations' },
    }
  }

  if (trend.key === 'similarity-history') {
    return {
      title: { ko: '유사도 결정 이력', en: 'Similarity decision history' },
      body: { ko: '중복, 별도 보존, 추가 확인 결정을 다음 리뷰 근거로 남겨.', en: 'Keeps duplicate, separate, and needs-review decisions available for the next review.' },
      primary: { ko: '기록 {count}', en: '{count} recorded' },
      secondary: { ko: '확인 {count}', en: '{count} review' },
    }
  }

  return {
    title: { ko: '정리 스테이징 추세', en: 'Cleanup staging trend' },
    body: { ko: '선택 후보와 누적 스테이징을 비교하되 삭제나 보존 정책 변경은 실행하지 않아.', en: 'Compares selected candidates with staged review items without deleting files or changing retention policy.' },
    primary: { ko: '스테이징 {count}', en: '{count} staged' },
    secondary: { ko: '선택 {count}', en: '{count} selected' },
  }
}

function getMediaReviewTrendToneLabel(tone: MediaReviewOperationalTrend['tone']) {
  if (tone === 'attention') {
    return { ko: '주의', en: 'Attention' }
  }

  if (tone === 'watch') {
    return { ko: '관찰', en: 'Watch' }
  }

  return { ko: '안정', en: 'Ready' }
}

function getTagSuggestionCopy(suggestion: MediaReviewTagQualitySuggestion) {
  if (suggestion.key === 'retag-missing') {
    return {
      title: { ko: '태그 없는 항목 재점검', en: 'Recheck untagged items' },
      body: { ko: '선택 후 태그/등급 재점검으로 auto_tags와 rating_score를 채워.', en: 'Select and rerun tag/rating checks to fill auto_tags and rating_score.' },
    }
  }

  if (suggestion.key === 'retag-sparse') {
    return {
      title: { ko: '태그 부족 항목 보강', en: 'Improve sparse tags' },
      body: { ko: '태그 수가 적은 항목을 모아 품질을 다시 확인해.', en: 'Collect low-coverage items and review tag quality again.' },
    }
  }

  if (suggestion.key === 'review-unrated') {
    return {
      title: { ko: '등급 없음 확인', en: 'Review unrated items' },
      body: { ko: 'rating_score나 등급 라벨이 없는 항목은 안전 표시 기준을 다시 확인해.', en: 'Items without rating_score or labels need safety-display review.' },
    }
  }

  return {
    title: { ko: '태그 품질 준비됨', en: 'Tag quality ready' },
    body: { ko: '로드된 항목에는 즉시 조치가 필요한 태그 품질 신호가 없어.', en: 'Loaded items have no immediate tag-quality action signal.' },
  }
}

function getGroupCheckCopy(check: MediaReviewGroupQualityCheck) {
  if (check.key === 'ungrouped-loaded') {
    return {
      title: { ko: '그룹 없는 로드 항목', en: 'Loaded ungrouped items' },
      body: { ko: '현재 로드된 결과에서 사용자 그룹 후보를 먼저 묶어.', en: 'Group candidates from the currently loaded results first.' },
    }
  }

  if (check.key === 'empty-groups') {
    return {
      title: { ko: '빈 그룹 점검', en: 'Empty group check' },
      body: { ko: '이미지 수가 0인 그룹은 보존/정리 판단이 필요해.', en: 'Groups with zero images need keep-or-cleanup review.' },
    }
  }

  if (check.key === 'auto-collect-not-run') {
    return {
      title: { ko: '자동 수집 미실행', en: 'Auto collect not run' },
      body: { ko: '자동 수집이 켜졌지만 실행 기록이 없는 그룹을 확인해.', en: 'Review enabled auto-collect groups without a run record.' },
    }
  }

  if (check.key === 'large-root-groups') {
    return {
      title: { ko: '큰 루트 그룹', en: 'Large root groups' },
      body: { ko: '하위 분류나 품질 분리가 필요한 루트 그룹 후보야.', en: 'Root groups may need sub-classification or quality splits.' },
    }
  }

  return {
    title: { ko: '그룹 품질 준비됨', en: 'Group quality ready' },
    body: { ko: '로드된 결과와 그룹 목록에서 즉시 조치할 품질 신호가 없어.', en: 'Loaded results and groups have no immediate quality action signal.' },
  }
}

function getSimilarityDecisionCopy(decision: MediaReviewSimilarityDecisionKind) {
  if (decision === 'duplicate-candidate') {
    return { ko: '중복 후보', en: 'Duplicate candidate' }
  }

  if (decision === 'keep-separate') {
    return { ko: '별도 보존', en: 'Keep separate' }
  }

  return { ko: '추가 확인', en: 'Needs review' }
}

function getCleanupStageActionCopy(action: MediaReviewCleanupStageAction) {
  if (action === 'review-missing-file') {
    return { ko: '누락 파일 확인', en: 'Check missing file' }
  }

  if (action === 'review-recycled-record') {
    return { ko: '휴지통 기록 확인', en: 'Check recycled record' }
  }

  if (action === 'hold-active-similar') {
    return { ko: '활성 유사 항목 보류', en: 'Hold active similar item' }
  }

  return { ko: '활성 선택 항목 보류', en: 'Hold selected active item' }
}

function MediaReviewOperationalTrendPanel({
  trends,
  onQueueChange,
}: {
  trends: MediaReviewOperationalTrend[]
  onQueueChange: (queue: MediaReviewQueueKey) => void
}) {
  const { t, formatNumber } = useI18n()

  return (
    <PageInset className="space-y-3" data-media-review-operational-trends="true">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <Activity className="h-4 w-4 text-primary" />
        <span>{t({ ko: '운영 추세', en: 'Operational trends' })}</span>
      </div>
      <div className="grid gap-2 lg:grid-cols-4">
        {trends.map((trend) => {
          const copy = getMediaReviewOperationalTrendCopy(trend)
          return (
            <div
              key={trend.key}
              className={`min-h-[8rem] rounded-sm border px-3 py-2 text-xs ${getOperationalTrendToneClass(trend.tone)}`}
              data-media-review-trend={trend.key}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-semibold text-foreground">{t(copy.title)}</div>
                <Badge variant="outline">{t(getMediaReviewTrendToneLabel(trend.tone))}</Badge>
              </div>
              <div className="mt-2 grid gap-1 text-muted-foreground">
                <span>{t(copy.primary, { count: formatNumber(trend.primaryCount) })}</span>
                <span>{t(copy.secondary, { count: formatNumber(trend.secondaryCount) })}</span>
              </div>
              <div className="mt-2 text-muted-foreground">{t(copy.body)}</div>
              {trend.queue ? (
                <Button className="mt-2" size="sm" variant="outline" onClick={() => onQueueChange(trend.queue!)}>
                  {t({ ko: '큐 열기', en: 'Open queue' })}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </PageInset>
  )
}

function MediaReviewIntelligencePanel({
  recommendedQueues,
  tagSuggestions,
  groupChecks,
  activeQueue,
  onQueueChange,
}: {
  recommendedQueues: MediaReviewRecommendedQueue[]
  tagSuggestions: MediaReviewTagQualitySuggestion[]
  groupChecks: MediaReviewGroupQualityCheck[]
  activeQueue: MediaReviewQueueKey
  onQueueChange: (queue: MediaReviewQueueKey) => void
}) {
  const { t, formatNumber } = useI18n()

  return (
    <div className="grid gap-3 xl:grid-cols-3" data-media-review-intelligence-panel="true">
      <PageInset className="space-y-3" data-media-review-recommended-queues="true">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardList className="h-4 w-4 text-primary" />
          <span>{t({ ko: '추천 리뷰 큐', en: 'Recommended queues' })}</span>
        </div>
        {recommendedQueues.length > 0 ? (
          <div className="space-y-2">
            {recommendedQueues.map((recommendation) => {
              const option = getReviewQueueOption(recommendation.queue)
              const Icon = option.icon
              return (
                <button
                  key={recommendation.queue}
                  type="button"
                  className={`flex w-full items-start gap-2 rounded-sm border px-3 py-2 text-left transition hover:bg-surface-high ${getRecommendationToneClass(recommendation.priority)} ${activeQueue === recommendation.queue ? 'ring-1 ring-primary' : ''}`}
                  onClick={() => onQueueChange(recommendation.queue)}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                      <span>{t(option.label)}</span>
                      <Badge variant="outline">{formatNumber(recommendation.count)}</Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{t(getQueueRecommendationReason(recommendation.queue))}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            <span>{t({ ko: '로드된 항목에는 우선 추천 큐가 없어.', en: 'No priority queue is recommended for loaded items.' })}</span>
          </div>
        )}
      </PageInset>

      <PageInset className="space-y-3" data-media-review-tag-quality-suggestions="true">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Tags className="h-4 w-4 text-primary" />
          <span>{t({ ko: '태그 품질 제안', en: 'Tag quality suggestions' })}</span>
        </div>
        <div className="space-y-2">
          {tagSuggestions.map((suggestion) => {
            const copy = getTagSuggestionCopy(suggestion)
            return (
              <div key={suggestion.key} className={`rounded-sm border px-3 py-2 ${getRecommendationToneClass(suggestion.priority)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-foreground">
                  <span>{t(copy.title)}</span>
                  <Badge variant="outline">{formatNumber(suggestion.count)}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{t(copy.body)}</div>
                {suggestion.queue ? (
                  <Button className="mt-2" size="sm" variant="outline" onClick={() => onQueueChange(suggestion.queue!)}>
                    {t({ ko: '큐 열기', en: 'Open queue' })}
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </PageInset>

      <PageInset className="space-y-3" data-media-review-group-quality-checks="true">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FolderTree className="h-4 w-4 text-primary" />
          <span>{t({ ko: '그룹 품질 체크', en: 'Group quality checks' })}</span>
        </div>
        <div className="space-y-2">
          {groupChecks.map((check) => {
            const copy = getGroupCheckCopy(check)
            return (
              <div key={check.key} className={`rounded-sm border px-3 py-2 ${getRecommendationToneClass(check.priority)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-foreground">
                  <span>{t(copy.title)}</span>
                  <Badge variant="outline">{formatNumber(check.count)}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{t(copy.body)}</div>
                {check.queue ? (
                  <Button className="mt-2" size="sm" variant="outline" onClick={() => onQueueChange(check.queue!)}>
                    {t({ ko: '큐 열기', en: 'Open queue' })}
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </PageInset>
    </div>
  )
}

function SimilarityHistoryAndCleanupStagingPanel({
  decisionHistory,
  cleanupStageItems,
  selectedSimilarityTargetCount,
  selectedCleanupStagePlan,
  canRecordSimilarityDecision,
  onRecordSimilarityDecision,
  onStageCleanup,
  onClearDecisionHistory,
  onClearCleanupStage,
}: {
  decisionHistory: MediaReviewSimilarityDecisionHistoryItem[]
  cleanupStageItems: MediaReviewCleanupStageItem[]
  selectedSimilarityTargetCount: number
  selectedCleanupStagePlan: MediaReviewCleanupStagingPlan
  canRecordSimilarityDecision: boolean
  onRecordSimilarityDecision: (decision: MediaReviewSimilarityDecisionKind) => void
  onStageCleanup: () => void
  onClearDecisionHistory: () => void
  onClearCleanupStage: () => void
}) {
  const { t, formatNumber } = useI18n()
  const decisionSummary = getMediaReviewSimilarityDecisionSummary(decisionHistory)
  const stagedActiveCount = cleanupStageItems.filter((item) => item.recoverabilityState === 'active').length
  const stagedRecoverableCount = cleanupStageItems.filter((item) => item.recoverabilityState !== 'active').length
  const stagedDestructiveCount = cleanupStageItems.filter((item) => item.destructiveAction).length

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <PageInset className="space-y-3" data-media-review-similarity-history="true">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleDot className="h-4 w-4 text-primary" />
            <span>{t({ ko: '유사도 결정 기록', en: 'Similarity decision history' })}</span>
          </div>
          <Badge variant="outline">{formatNumber(decisionSummary.totalCount)}</Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Badge variant="secondary">{t({ ko: '중복 {count}', en: '{count} duplicate' }, { count: formatNumber(decisionSummary.duplicateCandidateCount) })}</Badge>
          <Badge variant="secondary">{t({ ko: '별도 {count}', en: '{count} separate' }, { count: formatNumber(decisionSummary.keepSeparateCount) })}</Badge>
          <Badge variant="outline">{t({ ko: '확인 {count}', en: '{count} review' }, { count: formatNumber(decisionSummary.needsHumanReviewCount) })}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onRecordSimilarityDecision('duplicate-candidate')} disabled={!canRecordSimilarityDecision}>
            <CircleDot className="h-4 w-4" />
            {t({ ko: '중복 후보 기록', en: 'Record duplicate' })}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onRecordSimilarityDecision('keep-separate')} disabled={!canRecordSimilarityDecision}>
            <ShieldCheck className="h-4 w-4" />
            {t({ ko: '별도 보존 기록', en: 'Record separate' })}
          </Button>
          <Button size="icon-sm" variant="secondary" onClick={onClearDecisionHistory} disabled={decisionHistory.length === 0} aria-label={t({ ko: '유사도 결정 기록 지우기', en: 'Clear similarity decision history' })} title={t({ ko: '유사도 결정 기록 지우기', en: 'Clear similarity decision history' })}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {t({ ko: '선택 기준과 대상 {count}개', en: '{count} selected targets against the anchor' }, { count: formatNumber(selectedSimilarityTargetCount) })}
        </div>
        {decisionHistory.length > 0 ? (
          <div className="space-y-2">
            {decisionHistory.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-sm border border-border bg-surface-lowest px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-foreground">
                  <Badge variant="outline">{t(getSimilarityDecisionCopy(item.decision))}</Badge>
                  <span className="font-mono">{item.targetHash}</span>
                </div>
                <div className="mt-1 text-muted-foreground">{item.matchState === 'similar-match' ? t({ ko: '유사도 결과 기반', en: 'From similarity result' }) : t({ ko: '수동 선택 기반', en: 'From manual selection' })}</div>
              </div>
            ))}
          </div>
        ) : null}
      </PageInset>

      <PageInset className="space-y-3" data-media-review-cleanup-staging="true">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Undo2 className="h-4 w-4 text-primary" />
            <span>{t({ ko: '정리 스테이징', en: 'Cleanup staging' })}</span>
          </div>
          <Badge variant="outline">{formatNumber(cleanupStageItems.length)}</Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Badge variant="secondary">{t({ ko: '활성 {count}', en: '{count} active' }, { count: formatNumber(stagedActiveCount) })}</Badge>
          <Badge variant="secondary">{t({ ko: '복구 {count}', en: '{count} recoverable' }, { count: formatNumber(stagedRecoverableCount) })}</Badge>
          <Badge variant="outline">{t({ ko: '삭제 {count}', en: '{count} destructive' }, { count: formatNumber(stagedDestructiveCount) })}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onStageCleanup} disabled={selectedCleanupStagePlan.items.length === 0}>
            <ClipboardList className="h-4 w-4" />
            {t({ ko: '선택 항목 스테이징', en: 'Stage selected' })}
          </Button>
          <Button size="icon-sm" variant="secondary" onClick={onClearCleanupStage} disabled={cleanupStageItems.length === 0} aria-label={t({ ko: '정리 스테이징 지우기', en: 'Clear cleanup staging' })} title={t({ ko: '정리 스테이징 지우기', en: 'Clear cleanup staging' })}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {t({ ko: '선택 후보 {count}개. 스테이징은 검토 목록만 만들고 파일 삭제, 휴지통 비우기, 영구 정리를 실행하지 않아.', en: '{count} selected candidates. Staging only builds a review list; it does not delete files, empty the recycle bin, or run permanent cleanup.' }, { count: formatNumber(selectedCleanupStagePlan.items.length) })}
        </div>
        {cleanupStageItems.length > 0 ? (
          <div className="space-y-2">
            {cleanupStageItems.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-sm border border-border bg-surface-lowest px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-foreground">
                  <Badge variant="outline">{t(getCleanupStageActionCopy(item.action))}</Badge>
                  <span className="font-mono">{item.compositeHash ?? item.id}</span>
                </div>
                <div className="mt-1 text-muted-foreground">{t({ ko: '파괴적 작업 없음', en: 'No destructive action' })}</div>
              </div>
            ))}
          </div>
        ) : null}
      </PageInset>
    </div>
  )
}

function BatchReviewPreview({
  selectedCount,
  selectedCompositeCount,
  reviewedCount,
  recoverableCount,
}: {
  selectedCount: number
  selectedCompositeCount: number
  reviewedCount: number
  recoverableCount: number
}) {
  const { t, formatNumber } = useI18n()

  return (
    <PageInset className="space-y-2 text-xs text-muted-foreground" data-media-review-batch-preview="true">
      <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        <Badge>{t({ ko: '{count}개 선택', en: '{count} selected' }, { count: formatNumber(selectedCount) })}</Badge>
        <Badge variant="outline">{t({ ko: '활성 적용 가능 {count}', en: '{count} active actionable' }, { count: formatNumber(selectedCompositeCount) })}</Badge>
        {reviewedCount > 0 ? <Badge variant="outline">{t({ ko: '검토 완료 {count}', en: '{count} reviewed' }, { count: formatNumber(reviewedCount) })}</Badge> : null}
        {recoverableCount > 0 ? <Badge variant="outline">{t({ ko: '복구 점검 {count}', en: '{count} recovery checks' }, { count: formatNumber(recoverableCount) })}</Badge> : null}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <div>{t({ ko: '그룹: 선택 항목을 기존 사용자 그룹에 추가해. 삭제나 이동은 하지 않아.', en: 'Group: add selected items to an existing custom group without deleting or moving files.' })}</div>
        <div>{t({ ko: '태그/등급: 기존 태거 경로로 auto_tags와 rating_score를 다시 계산해.', en: 'Tags/rating: rerun the existing tagger path to refresh auto_tags and rating_score.' })}</div>
        <div>{t({ ko: '복구: 누락/삭제 상태는 정리하지 않고 검토 신호로만 남겨.', en: 'Recovery: missing/deleted states stay as review signals; this does not clean them up.' })}</div>
      </div>
    </PageInset>
  )
}

function ReviewSignalOverlay({ image, similarHashSet, reviewedIdSet }: { image: ImageRecord; similarHashSet: ReadonlySet<string>; reviewedIdSet: ReadonlySet<string> }) {
  const { t, formatNumber } = useI18n()
  const signals = getMediaReviewSignals(image, similarHashSet)
  const imageId = getImageListId(image)
  const tagLabel = signals.tagQuality === 'missing'
    ? t({ ko: '태그 없음', en: 'no tags' })
    : signals.tagQuality === 'sparse'
      ? t({ ko: '태그 {count}', en: '{count} tags' }, { count: formatNumber(signals.tagCount) })
      : t({ ko: '태그 {count}', en: '{count} tags' }, { count: formatNumber(signals.tagCount) })
  const ratingLabel = signals.ratingLabel ?? (signals.ratingScore === null ? t({ ko: '평가 없음', en: 'unrated' }) : formatNumber(signals.ratingScore))
  const recoveryLabel = signals.recoverabilityState === 'deleted'
    ? t({ ko: '휴지통 기록', en: 'recycled' })
    : signals.recoverabilityState === 'missing'
      ? t({ ko: '파일 누락', en: 'missing file' })
      : null

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap gap-1">
      <Badge variant={signals.groupCount > 0 ? 'secondary' : 'outline'}>{t({ ko: '그룹 {count}', en: 'group {count}' }, { count: formatNumber(signals.groupCount) })}</Badge>
      <Badge variant={signals.tagQuality === 'ready' ? 'secondary' : 'outline'}>{tagLabel}</Badge>
      <Badge variant={signals.ratingScore === null && signals.ratingLabel === null ? 'outline' : 'secondary'}>{ratingLabel}</Badge>
      {signals.isSimilarMatch ? <Badge>{t({ ko: '유사', en: 'similar' })}</Badge> : null}
      {recoveryLabel ? <Badge variant="outline">{recoveryLabel}</Badge> : null}
      {reviewedIdSet.has(imageId) ? <Badge>{t({ ko: '검토 완료', en: 'reviewed' })}</Badge> : null}
    </div>
  )
}

/** Render a non-destructive media review workspace that combines existing search, group, tag, rating, and similarity signals. */
export function MediaReviewPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const canViewReview = hasAuthPermission(authStatusQuery.data?.permissionKeys, 'page.home.view')
  const [searchText, setSearchText] = useState('')
  const [appliedSearchText, setAppliedSearchText] = useState('')
  const [activeQueue, setActiveQueue] = useState<MediaReviewQueueKey>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [reviewedIds, setReviewedIds] = useState<string[]>([])
  const [similarityDecisionHistory, setSimilarityDecisionHistory] = useState<MediaReviewSimilarityDecisionHistoryItem[]>([])
  const [cleanupStageItems, setCleanupStageItems] = useState<MediaReviewCleanupStageItem[]>([])
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)

  useAuthPermissionRedirect({
    enabled: !authStatusQuery.isLoading && !canViewReview,
    permissionKey: 'page.home.view',
  })

  const searchChips = useMemo(() => buildMediaReviewSearchChips(appliedSearchText), [appliedSearchText])
  const isSearchMode = searchChips.length > 0

  const imagesQuery = useInfiniteQuery({
    queryKey: ['media-review-images', searchChips],
    initialPageParam: (isSearchMode ? 1 : {}) as ReviewImagesPageParam,
    queryFn: ({ pageParam }) => {
      const typedPageParam = pageParam as ReviewImagesPageParam

      if (isSearchMode) {
        return searchImagesComplex({
          complex_filter: buildComplexFilterPayload(searchChips),
          page: typeof typedPageParam === 'number' ? typedPageParam : 1,
          limit: 48,
          sortBy: 'upload_date',
          sortOrder: 'DESC',
        })
      }

      const cursor = typeof typedPageParam === 'number' ? {} : typedPageParam
      return getImages({
        pagination: 'cursor',
        limit: 48,
        cursorDate: cursor.cursorDate,
        cursorHash: cursor.cursorHash,
      })
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) {
        return undefined
      }

      if (isSearchMode) {
        return lastPage.page + 1
      }

      if (!lastPage.nextCursorDate || !lastPage.nextCursorHash) {
        return undefined
      }

      return {
        cursorDate: lastPage.nextCursorDate,
        cursorHash: lastPage.nextCursorHash,
      }
    },
    enabled: canViewReview,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'media-review'],
    queryFn: getGroupsHierarchyAll,
    enabled: canViewReview,
  })

  const loadedImages = useMemo(
    () => (imagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [imagesQuery.data?.pages],
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const reviewedIdSet = useMemo(() => new Set(reviewedIds), [reviewedIds])
  const selectedAnchorImage = useMemo(
    () => loadedImages.find((image) => selectedIdSet.has(getImageListId(image))) ?? null,
    [loadedImages, selectedIdSet],
  )
  const selectedAnchorHash = getImageCompositeHash(selectedAnchorImage)

  const similarImagesQuery = useQuery({
    queryKey: ['media-review-similar-images', selectedAnchorHash],
    queryFn: ({ signal }) => getSimilarImages(selectedAnchorHash!, { threshold: 18, limit: 48, includeColorSimilarity: true }, { signal }),
    enabled: canViewReview && Boolean(selectedAnchorHash),
  })
  const similarHashSet = useMemo(
    () => new Set((similarImagesQuery.data?.similar ?? []).map((item) => item.image.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0)),
    [similarImagesQuery.data?.similar],
  )
  const sourceSummary = useMemo(() => getMediaReviewSignalSummary(loadedImages, similarHashSet), [loadedImages, similarHashSet])
  const recommendedQueues = useMemo(
    () => getMediaReviewRecommendedQueues(sourceSummary, { reviewedCount: reviewedIdSet.size }),
    [reviewedIdSet.size, sourceSummary],
  )
  const tagQualitySuggestions = useMemo(
    () => getMediaReviewTagQualitySuggestions(sourceSummary),
    [sourceSummary],
  )
  const groupQualityChecks = useMemo(
    () => getMediaReviewGroupQualityChecks(loadedImages, groupsQuery.data ?? []),
    [groupsQuery.data, loadedImages],
  )
  const filteredImages = useMemo(
    () => filterMediaReviewImages(loadedImages, activeQueue, similarHashSet, reviewedIdSet),
    [activeQueue, loadedImages, reviewedIdSet, similarHashSet],
  )
  const {
    visibleItems,
    hasOnlyHiddenItems,
    renderItemPersistentOverlay: renderSafetyOverlay,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: filteredImages,
    enabled: canViewReview,
    hasMore: Boolean(imagesQuery.hasNextPage),
    isLoading: imagesQuery.isPending,
    isError: imagesQuery.isError,
    isLoadingMore: imagesQuery.isFetchingNextPage,
    onLoadMore: imagesQuery.fetchNextPage,
  })
  const visibleSummary = useMemo(() => getMediaReviewSignalSummary(visibleItems, similarHashSet), [similarHashSet, visibleItems])
  const selectedImages = useMemo(
    () => visibleItems.filter((image) => selectedIdSet.has(getImageListId(image))),
    [selectedIdSet, visibleItems],
  )
  const selectedActionableImages = useMemo(
    () => selectedImages.filter((image) => image.file_status !== 'missing' && image.file_status !== 'deleted'),
    [selectedImages],
  )
  const selectedCompositeHashes = useMemo(
    () => selectedActionableImages
      .map((image) => image.composite_hash)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [selectedActionableImages],
  )
  const selectedReviewedCount = useMemo(
    () => selectedImages.filter((image) => reviewedIdSet.has(getImageListId(image))).length,
    [reviewedIdSet, selectedImages],
  )
  const selectedRecoverableCount = selectedImages.length - selectedActionableImages.length
  const selectedSimilarityTargetCount = useMemo(
    () => selectedImages.filter((image) => {
      const compositeHash = getImageCompositeHash(image)
      return compositeHash !== null && compositeHash !== selectedAnchorHash
    }).length,
    [selectedAnchorHash, selectedImages],
  )
  const selectedCleanupStagePlan = useMemo(
    () => buildMediaReviewCleanupStagingPlan(selectedImages, similarHashSet),
    [selectedImages, similarHashSet],
  )
  const similarityDecisionSummary = useMemo(
    () => getMediaReviewSimilarityDecisionSummary(similarityDecisionHistory),
    [similarityDecisionHistory],
  )
  const operationalTrends = useMemo(
    () => buildMediaReviewOperationalTrends({
      sourceSummary,
      visibleSummary,
      reviewedCount: reviewedIdSet.size,
      recommendedQueues,
      decisionSummary: similarityDecisionSummary,
      cleanupStagingPlan: selectedCleanupStagePlan,
      stagedCleanupItems: cleanupStageItems,
    }),
    [cleanupStageItems, recommendedQueues, reviewedIdSet.size, selectedCleanupStagePlan, similarityDecisionSummary, sourceSummary, visibleSummary],
  )

  const assignToGroupMutation = useMutation({
    mutationFn: ({ groupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => addImagesToGroup(groupId, compositeHashes),
    onSuccess: async (result) => {
      setIsAssignModalOpen(false)
      setSelectedIds([])
      showSnackbar({ message: result.message, tone: 'info' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all'] }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['media-review-images'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '선택 항목을 그룹에 추가하지 못했어.', en: 'Failed to add selected items to the group.' }), tone: 'error' })
    },
  })

  const batchTagMutation = useMutation({
    mutationFn: (compositeHashes: string[]) => batchTagImages(compositeHashes),
    onSuccess: async (result) => {
      setSelectedIds([])
      showSnackbar({
        message: result.fail_count > 0
          ? t({ ko: '태그/등급 재점검: 성공 {success}개, 실패 {failed}개', en: 'Tag/rating recheck: {success} succeeded, {failed} failed' }, { success: formatNumber(result.success_count), failed: formatNumber(result.fail_count) })
          : t({ ko: '태그/등급 {count}개 재점검 완료', en: '{count} tag/rating checks completed' }, { count: formatNumber(result.success_count) }),
        tone: result.fail_count > 0 ? 'error' : 'info',
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['media-review-images'] }),
        queryClient.invalidateQueries({ queryKey: ['home-images'] }),
        queryClient.invalidateQueries({ queryKey: ['image-detail'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '선택 항목 태그/등급 재점검에 실패했어.', en: 'Failed to recheck selected item tags and ratings.' }), tone: 'error' })
    },
  })

  const handleSubmitSearch = () => {
    setSelectedIds([])
    setAppliedSearchText(searchText.trim())
  }

  const handleClearSearch = () => {
    setSearchText('')
    setAppliedSearchText('')
    setSelectedIds([])
  }

  const handleOpenAssignModal = () => {
    if (selectedCompositeHashes.length === 0) {
      return
    }

    if (groupsQuery.isPending) {
      showSnackbar({ message: t({ ko: '사용자 그룹을 불러오는 중이야.', en: 'Loading custom groups.' }), tone: 'info' })
      return
    }

    if (groupsQuery.isError) {
      showSnackbar({ message: groupsQuery.error instanceof Error ? groupsQuery.error.message : t({ ko: '그룹 목록을 불러오지 못했어.', en: 'Failed to load groups.' }), tone: 'error' })
      return
    }

    if ((groupsQuery.data?.length ?? 0) === 0) {
      showSnackbar({ message: t({ ko: '먼저 사용자 그룹을 만들어야 해.', en: 'Create a custom group first.' }), tone: 'error' })
      return
    }

    setIsAssignModalOpen(true)
  }

  const handleAssignToGroup = async (groupId: number) => {
    await assignToGroupMutation.mutateAsync({
      groupId,
      compositeHashes: selectedCompositeHashes,
    })
  }

  const handleBatchTagSelected = () => {
    if (selectedCompositeHashes.length === 0 || batchTagMutation.isPending) {
      return
    }

    const confirmed = window.confirm(t({ ko: '선택한 {count}개 항목의 태그와 등급을 다시 계산할까?', en: 'Recalculate tags and ratings for {count} selected items?' }, { count: formatNumber(selectedCompositeHashes.length) }))
    if (!confirmed) {
      return
    }

    batchTagMutation.mutate(selectedCompositeHashes)
  }

  const handleMarkReviewed = () => {
    if (selectedIds.length === 0) {
      return
    }

    setReviewedIds((current) => Array.from(new Set([...current, ...selectedIds])))
    setSelectedIds([])
    showSnackbar({ message: t({ ko: '선택 항목을 검토 완료로 표시했어.', en: 'Marked selected items as reviewed.' }), tone: 'info' })
  }

  const handleReopenReview = () => {
    if (selectedIds.length === 0) {
      return
    }

    const selectedIdSnapshot = new Set(selectedIds)
    setReviewedIds((current) => current.filter((imageId) => !selectedIdSnapshot.has(imageId)))
    setSelectedIds([])
    showSnackbar({ message: t({ ko: '선택 항목을 검토 대기로 돌렸어.', en: 'Moved selected items back to needs review.' }), tone: 'info' })
  }

  const handleRecordSimilarityDecision = (decision: MediaReviewSimilarityDecisionKind) => {
    const decisionItems = buildMediaReviewSimilarityDecisionHistory(
      selectedImages,
      selectedAnchorHash,
      decision,
      new Date().toISOString(),
      similarHashSet,
    )

    if (decisionItems.length === 0) {
      showSnackbar({ message: t({ ko: '유사도 기준과 대상 항목을 함께 선택해야 해.', en: 'Select a similarity anchor and target items together.' }), tone: 'error' })
      return
    }

    setSimilarityDecisionHistory((current) => [...decisionItems, ...current].slice(0, 48))
    setSelectedIds([])
    showSnackbar({
      message: t({ ko: '유사도 결정 {count}개를 기록했어.', en: 'Recorded {count} similarity decisions.' }, { count: formatNumber(decisionItems.length) }),
      tone: 'info',
    })
  }

  const handleStageCleanupSelected = () => {
    if (selectedCleanupStagePlan.items.length === 0) {
      return
    }

    const stagedIds = new Set(selectedCleanupStagePlan.items.map((item) => item.id))
    setCleanupStageItems((current) => [
      ...selectedCleanupStagePlan.items,
      ...current.filter((item) => !stagedIds.has(item.id)),
    ].slice(0, 48))
    setSelectedIds([])
    showSnackbar({
      message: t({ ko: '정리 검토 항목 {count}개를 스테이징했어.', en: 'Staged {count} cleanup review items.' }, { count: formatNumber(selectedCleanupStagePlan.items.length) }),
      tone: 'info',
    })
  }

  const renderReviewOverlay = (image: ImageRecord): ReactNode => {
    const safetyOverlay = renderSafetyOverlay(image)

    return (
      <>
        {safetyOverlay}
        <ReviewSignalOverlay image={image} similarHashSet={similarHashSet} reviewedIdSet={reviewedIdSet} />
      </>
    )
  }

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (!canViewReview) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t({ ko: '미디어', en: 'Media' })}
        title={t('pageAccessCatalog.review')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/groups">{t({ ko: '그룹으로 이동', en: 'Open groups' })}</Link>
          </Button>
        }
      />

      <PageSection
        title={t({ ko: '리뷰 큐', en: 'Review queue' })}
        actions={
          <form
            className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmitSearch()
            }}
          >
            <div className="relative min-w-[min(22rem,100%)]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 pr-9"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={t({ ko: '프롬프트, 태그, 모델 검색', en: 'Search prompt, tag, model' })}
              />
              {searchText || appliedSearchText ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-high hover:text-foreground"
                  onClick={handleClearSearch}
                  aria-label={t({ ko: '검색 지우기', en: 'Clear search' })}
                  title={t({ ko: '검색 지우기', en: 'Clear search' })}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <Button type="submit" size="sm">{t({ ko: '검색', en: 'Search' })}</Button>
          </form>
        }
      >
        <SegmentedTabBar
          value={activeQueue}
          items={REVIEW_QUEUE_OPTIONS.map(({ value, icon: Icon, label }) => ({
            value,
            label: t(label),
            icon: Icon,
          }))}
          onChange={(value) => {
            setActiveQueue(value as MediaReviewQueueKey)
            setSelectedIds([])
          }}
          size="sm"
          fullWidth
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SignalTile label={t({ ko: '표시', en: 'Showing' })} value={`${formatNumber(visibleItems.length)} / ${formatNumber(filteredImages.length)}`} icon={Filter} />
          <SignalTile label={t({ ko: '그룹 없음', en: 'Ungrouped' })} value={formatNumber(visibleSummary.ungroupedCount)} icon={FolderTree} />
          <SignalTile label={t({ ko: '태그 점검', en: 'Tag review' })} value={formatNumber(visibleSummary.missingTagCount + visibleSummary.sparseTagCount)} icon={Tags} />
          <SignalTile label={t({ ko: '유사 매칭', en: 'Similar matches' })} value={formatNumber(visibleSummary.similarCount)} icon={CircleDot} />
          <SignalTile label={t({ ko: '복구 점검', en: 'Recovery checks' })} value={formatNumber(visibleSummary.recoverableCount)} icon={Undo2} />
        </div>

        <MediaReviewIntelligencePanel
          recommendedQueues={recommendedQueues}
          tagSuggestions={tagQualitySuggestions}
          groupChecks={groupQualityChecks}
          activeQueue={activeQueue}
          onQueueChange={(queue) => {
            setActiveQueue(queue)
            setSelectedIds([])
          }}
        />

        <MediaReviewOperationalTrendPanel
          trends={operationalTrends}
          onQueueChange={(queue) => {
            setActiveQueue(queue)
            setSelectedIds([])
          }}
        />

        <PageInset className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t({ ko: '로드 {count}', en: '{count} loaded' }, { count: formatNumber(sourceSummary.totalCount) })}</span>
            <span>{t({ ko: '전체 그룹 {count}', en: '{count} groups' }, { count: formatNumber(groupsQuery.data?.length ?? 0) })}</span>
            <span>{t({ ko: '평가 없음 {count}', en: '{count} unrated' }, { count: formatNumber(sourceSummary.unratedCount) })}</span>
            {appliedSearchText ? <Badge variant="outline">{appliedSearchText}</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAnchorHash ? (
              <Badge>{t({ ko: '유사 기준 선택됨', en: 'similarity anchor selected' })}</Badge>
            ) : (
              <Badge variant="outline">{t({ ko: '유사 기준 없음', en: 'no similarity anchor' })}</Badge>
            )}
            {similarImagesQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </div>
        </PageInset>

        <PageInset className="text-xs text-muted-foreground" data-media-review-cleanup-guardrail="true">
          {t({
            ko: '이 화면의 일괄 작업은 그룹 추가, 태그/등급 재점검, 검토 상태 표시까지만 수행해. 파일 삭제, 휴지통 비우기, 영구 정리는 여기서 실행하지 않아.',
            en: 'Batch actions here only add groups, recheck tags/ratings, or mark review state. File deletion, recycle-bin emptying, and permanent cleanup do not run from this workspace.',
          })}
        </PageInset>

        <SimilarityHistoryAndCleanupStagingPanel
          decisionHistory={similarityDecisionHistory}
          cleanupStageItems={cleanupStageItems}
          selectedSimilarityTargetCount={selectedSimilarityTargetCount}
          selectedCleanupStagePlan={selectedCleanupStagePlan}
          canRecordSimilarityDecision={Boolean(selectedAnchorHash) && selectedSimilarityTargetCount > 0}
          onRecordSimilarityDecision={handleRecordSimilarityDecision}
          onStageCleanup={handleStageCleanupSelected}
          onClearDecisionHistory={() => setSimilarityDecisionHistory([])}
          onClearCleanupStage={() => setCleanupStageItems([])}
        />
      </PageSection>

      {imagesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '리뷰 항목을 불러오지 못했어', en: 'Could not load review items' })}</AlertTitle>
          <AlertDescription className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{imagesQuery.error instanceof Error ? imagesQuery.error.message : t({ ko: '알 수 없는 오류가 발생했어.', en: 'An unknown error occurred.' })}</span>
            <Button size="sm" variant="outline" onClick={() => void imagesQuery.refetch()}>
              {t({ ko: '다시 시도', en: 'Retry' })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {imagesQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[260px] rounded-sm" />
          ))}
        </div>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && visibleItems.length === 0 ? (
        <PageInset className="text-sm text-muted-foreground">
          {hasOnlyHiddenItems
            ? t({ ko: '현재 등급 표시 정책 때문에 이 큐에서는 숨겨진 상태야.', en: 'Items are hidden in this queue by the current rating visibility policy.' })
            : activeQueue === 'similar' && !selectedAnchorHash
              ? t({ ko: '유사도 기준으로 삼을 이미지를 먼저 선택해.', en: 'Select an image to use as the similarity anchor.' })
              : t({ ko: '이 큐에 표시할 항목이 없어.', en: 'No items in this queue.' })}
        </PageInset>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && visibleItems.length > 0 ? (
        <>
          {selectedIds.length > 0 ? (
            <BatchReviewPreview
              selectedCount={selectedIds.length}
              selectedCompositeCount={selectedCompositeHashes.length}
              reviewedCount={selectedReviewedCount}
              recoverableCount={selectedRecoverableCount}
            />
          ) : null}

          <ImageList
            items={visibleItems}
            resetKey={`media-review:${activeQueue}:${appliedSearchText}`}
            layout="grid"
            activationMode="modal"
            getItemId={getImageListId}
            getItemHref={(image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined)}
            selectable
            forceSelectionMode
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            hasMore={Boolean(imagesQuery.hasNextPage)}
            isLoadingMore={imagesQuery.isFetchingNextPage}
            onLoadMore={imagesQuery.fetchNextPage}
            minColumnWidth={220}
            columnGap={16}
            rowGap={16}
            gridItemHeight={250}
            renderItemPersistentOverlay={renderReviewOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
          />

          <div className="flex flex-col items-center gap-3 pb-6">
            {imagesQuery.isFetchingNextPage ? (
              <PageInset className="inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('homePage.loadingMoreImages')}</span>
              </PageInset>
            ) : null}

            {Boolean(imagesQuery.hasNextPage) && !imagesQuery.isFetchingNextPage ? (
              <Button size="sm" variant="outline" onClick={() => void imagesQuery.fetchNextPage()}>
                {t({ ko: '더 보기', en: 'Load more' })}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      <ImageSelectionBar
        selectedCount={selectedIds.length}
        downloadableCount={selectedCompositeHashes.length}
        showDownloadAction={false}
        statusText={t({ ko: '활성 항목에만 그룹, 태그/등급, 검토 상태 적용. 정리는 스테이징만 가능', en: 'Apply group, tag/rating, and review state to active items only. Cleanup is staging only.' })}
        extraActions={
          <>
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={handleOpenAssignModal}
              disabled={assignToGroupMutation.isPending || groupsQuery.isPending || selectedCompositeHashes.length === 0}
              title={assignToGroupMutation.isPending ? t({ ko: '그룹 추가 중', en: 'Adding to group' }) : t({ ko: '그룹에 추가', en: 'Add to group' })}
              aria-label={assignToGroupMutation.isPending ? t({ ko: '그룹 추가 중', en: 'Adding to group' }) : t({ ko: '그룹에 추가', en: 'Add to group' })}
              data-no-select-drag="true"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={handleBatchTagSelected}
              disabled={batchTagMutation.isPending || selectedCompositeHashes.length === 0}
              title={batchTagMutation.isPending ? t({ ko: '재점검 중', en: 'Rechecking' }) : t({ ko: '태그/등급 재점검', en: 'Recheck tags and ratings' })}
              aria-label={batchTagMutation.isPending ? t({ ko: '재점검 중', en: 'Rechecking' }) : t({ ko: '태그/등급 재점검', en: 'Recheck tags and ratings' })}
              data-no-select-drag="true"
            >
              {batchTagMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={handleMarkReviewed}
              disabled={selectedIds.length === 0}
              title={t({ ko: '검토 완료 표시', en: 'Mark reviewed' })}
              aria-label={t({ ko: '검토 완료 표시', en: 'Mark reviewed' })}
              data-no-select-drag="true"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          </>
        }
        trailingActions={selectedReviewedCount > 0 ? (
          <Button
            size="icon-sm"
            variant="outline"
            onClick={handleReopenReview}
            title={t({ ko: '검토 대기로 되돌리기', en: 'Move back to needs review' })}
            aria-label={t({ ko: '검토 대기로 되돌리기', en: 'Move back to needs review' })}
            data-no-select-drag="true"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        ) : undefined}
        onClear={() => setSelectedIds([])}
      />

      <GroupAssignModal
        open={isAssignModalOpen}
        groups={groupsQuery.data ?? []}
        selectedCount={selectedCompositeHashes.length}
        isSubmitting={assignToGroupMutation.isPending}
        onClose={() => setIsAssignModalOpen(false)}
        onSubmit={handleAssignToGroup}
      />
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'
import { getRuntimeGenerationHistorySettings } from '@/lib/api-settings'
import { cn } from '@/lib/utils'
import { mapHistoryRecordToImageRecord } from './generation-history-panel-helpers'
import { GenerationHistoryPanelView } from './generation-history-panel'
import { GenerationResultStage } from './generation-result-stage'
import type { GenerationHistoryFeed } from './use-generation-history-feed'
import { useGenerationStageQueue } from './use-generation-stage-queue'

export type GenerationResultView = 'stage' | 'history'

type GenerationResultAreaProps = {
  feed: GenerationHistoryFeed
  serviceType: GenerationServiceType
  workflowId?: number | null
  splitPaneScroll?: boolean
  /** Narrow layout: shorter stage, actions under the image. */
  compact?: boolean
  view: GenerationResultView
  onViewChange: (view: GenerationResultView) => void
  onBack?: () => void
}

/** Result column of the generation page: a large result stage (default) or the full history list over one shared feed. */
export function GenerationResultArea({
  feed,
  serviceType,
  workflowId,
  splitPaneScroll = false,
  compact = false,
  view,
  onViewChange,
  onBack,
}: GenerationResultAreaProps) {
  const { t } = useI18n()
  const { activeJob, activeJobCount, nowMs } = useGenerationStageQueue({ serviceType, workflowId })
  const historySafetySettingsQuery = useQuery({
    queryKey: ['runtime-generation-history-settings'],
    queryFn: getRuntimeGenerationHistorySettings,
    enabled: !feed.authStatusQuery.isPending,
    staleTime: 60_000,
  })
  const applyRatingSafety = historySafetySettingsQuery.data?.applyRatingSafetyToGenerationHistory === true
  const resultImages = useMemo(
    () => feed.historyRecords.map(mapHistoryRecordToImageRecord).filter((image) => Boolean(image.thumbnail_url)),
    [feed.historyRecords],
  )
  const { visibleItems, shouldBlurItemPreview } = useImageFeedSafety({
    items: resultImages,
    enabled: applyRatingSafety && resultImages.length > 0,
    isLoading: feed.isHistoryLoading,
    isError: feed.historyQuery.isError,
    visibilityMode: applyRatingSafety ? 'feed' : 'badge-only',
  })

  // 사용자가 필름스트립에서 고른 결과는 더 새로운 결과가 완료될 때까지만 유지한다.
  // 새 결과가 맨 앞에 들어오면 선택이 풀리고 무대는 다시 최신 결과를 따라간다.
  const latestId = visibleItems[0] ? String(visibleItems[0].id) : null
  const [pick, setPick] = useState<{ id: string; latestId: string | null } | null>(null)
  const pickedItem = pick && pick.latestId === latestId
    ? visibleItems.find((item) => String(item.id) === pick.id) ?? null
    : null
  const selected = pickedItem ?? visibleItems[0] ?? null

  const viewItems = [
    { value: 'stage', label: t({ ko: '결과', en: 'Result' }) },
    { value: 'history', label: t({ ko: '기록', en: 'History' }) },
  ]
  const toggle = (
    <SegmentedControl
      value={view}
      items={viewItems}
      onChange={(next) => onViewChange(next as GenerationResultView)}
      size="xs"
      semantics="tabs"
      ariaLabel={t({ ko: '결과 보기', en: 'Result view' })}
    />
  )
  const backButton = onBack ? (
    <IconButton size="icon-sm" variant="ghost" onClick={onBack} label={t('image-generation.components.generation.history.panel.back.to.workflow.list')}>
      <ArrowLeft />
    </IconButton>
  ) : null

  if (view === 'history') {
    return (
      <GenerationHistoryPanelView
        feed={feed}
        serviceType={serviceType}
        workflowId={workflowId}
        splitPaneScroll={splitPaneScroll}
        onBack={onBack}
        headerLeading={compact ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => onViewChange('stage')} label={t({ ko: '결과', en: 'Result' })}>
            <ArrowLeft />
          </IconButton>
        ) : toggle}
      />
    )
  }

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden' : 'space-y-3')}>
      {compact && !backButton ? null : (
        <div className="flex shrink-0 items-center gap-2">
          {backButton}
          {compact ? null : toggle}
        </div>
      )}
      <GenerationResultStage
        items={visibleItems}
        selected={selected}
        onSelect={(id) => setPick({ id, latestId })}
        isLoading={feed.isHistoryLoading}
        activeJob={activeJob}
        activeJobCount={activeJobCount}
        nowMs={nowMs}
        compact={compact}
        shouldBlur={shouldBlurItemPreview}
        onDeleted={() => void feed.refreshHistory()}
        onShowHistory={() => onViewChange('history')}
      />
    </section>
  )
}

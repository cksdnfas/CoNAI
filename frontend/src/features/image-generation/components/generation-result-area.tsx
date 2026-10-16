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
  /** Public workflow page: history actions use the public routes. */
  publicWorkflowSlug?: string | null
  splitPaneScroll?: boolean
  /** Narrow layout: shorter stage, actions under the image. */
  compact?: boolean
  /** Bumped on each generate click; a filmstrip pick made before it is released so the stage follows the new result. */
  followLatestNonce?: number
  view: GenerationResultView
  onViewChange: (view: GenerationResultView) => void
  onBack?: () => void
  /** Recent-results filmstrip placement from the layout preset. */
  recentStrip?: 'top' | 'bottom' | 'hidden'
}

/** Result column of the generation page: a large result stage (default) or the full history list over one shared feed. */
export function GenerationResultArea({
  feed,
  serviceType,
  workflowId,
  publicWorkflowSlug,
  splitPaneScroll = false,
  compact = false,
  followLatestNonce = 0,
  view,
  onViewChange,
  onBack,
  recentStrip = 'bottom',
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
    () => feed.historyRecords.map(mapHistoryRecordToImageRecord).filter((image) => Boolean(image.thumbnail_url || image.audio?.length)),
    [feed.historyRecords],
  )
  const { visibleItems, shouldBlurItemPreview } = useImageFeedSafety({
    items: resultImages,
    enabled: applyRatingSafety && resultImages.length > 0,
    isLoading: feed.isHistoryLoading,
    isError: feed.historyQuery.isError,
    visibilityMode: applyRatingSafety ? 'feed' : 'badge-only',
  })

  // 생성을 누른 뒤 아무것도 안 고르면 무대는 최신 결과를 따라간다.
  // 그 뒤 필름스트립에서 고른 결과는 새 결과가 완료돼도 유지하고, 다음 생성 클릭 때만 풀린다.
  const [pick, setPick] = useState<{ id: string; nonce: number } | null>(null)
  const pickedItem = pick && pick.nonce === followLatestNonce
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
        publicWorkflowSlug={publicWorkflowSlug}
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
        onSelect={(id) => setPick({ id, nonce: followLatestNonce })}
        isLoading={feed.isHistoryLoading}
        activeJob={activeJob}
        activeJobCount={activeJobCount}
        nowMs={nowMs}
        compact={compact}
        shouldBlur={shouldBlurItemPreview}
        onDeleted={() => void feed.refreshHistory()}
        onShowHistory={() => onViewChange('history')}
        stripPlacement={recentStrip}
      />
    </section>
  )
}

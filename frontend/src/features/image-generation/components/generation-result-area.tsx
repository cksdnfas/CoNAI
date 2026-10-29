import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
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
  /** Narrow layout: shorter stage. */
  compact?: boolean
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
  view,
  onViewChange,
  onBack,
  recentStrip = 'bottom',
}: GenerationResultAreaProps) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { activeJob, activeJobCount } = useGenerationStageQueue({ serviceType, workflowId })
  const historySafetySettingsQuery = useQuery({
    queryKey: ['runtime-generation-history-settings'],
    queryFn: getRuntimeGenerationHistorySettings,
    enabled: canViewImages && !feed.authStatusQuery.isPending,
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

  // 직접 고른 결과는 생성 요청이나 완료로 바뀌지 않는다.
  const [pick, setPick] = useState<string | null>(null)
  const pickedItem = pick !== null
    ? visibleItems.find((item) => String(item.id) === pick) ?? null
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
      <div className="flex shrink-0 items-center gap-2">
        {backButton}
        {toggle}
      </div>
      {!canViewImages ? <ImagePermissionNotice /> : (
        <GenerationResultStage
          items={visibleItems}
          selected={selected}
          onSelect={setPick}
          isLoading={feed.isHistoryLoading}
          activeJob={activeJob}
          activeJobCount={activeJobCount}
          compact={compact}
          shouldBlur={shouldBlurItemPreview}
          onDeleted={() => void feed.refreshHistory()}
          onShowHistory={compact ? undefined : () => onViewChange('history')}
          stripPlacement={recentStrip}
        />
      )}
    </section>
  )
}

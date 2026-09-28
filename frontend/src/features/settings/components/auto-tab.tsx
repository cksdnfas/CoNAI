import { Loader2, Plus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { SectionDirtyBadge } from './settings-section-status'
import { AutoOverviewCard } from './auto-overview-card'
import { KaloscopeSettingsCard } from './kaloscope-settings-card'
import { TaggerSettingsCard } from './tagger-settings-card'
import { RatingWeightSettingsCard } from './rating-weight-settings-card'
import { RatingTierSettingsCard } from './rating-tier-settings-card'
import type { AutoTabProps } from './auto-tab-types'
import { useI18n } from '@/i18n'

export function AutoTab({
  taggerDraft,
  kaloscopeDraft,
  taggerModels,
  taggerStatus,
  kaloscopeStatus,
  taggerDependencyResult,
  onPatchTagger,
  onPatchKaloscope,
  ratingWeightsDraft,
  ratingWeightValidationMessages,
  onPatchRatingWeights,
  ratingTiersDraft,
  ratingTierValidationMessages,
  onPatchRatingTier,
  onAddRatingTier,
  onDeleteRatingTier,
  onMoveRatingTierUp,
  onMoveRatingTierDown,
  onReorderRatingTier,
  hasTaggerChanges,
  hasKaloscopeChanges,
  hasRatingWeightsChanges,
  hasRatingTiersChanges,
  isCheckingTaggerDependencies,
}: AutoTabProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <section>
        <AutoOverviewCard
          heading={t({ ko: '개요', en: 'Overview' })}
          taggerStatus={taggerStatus}
          taggerDependencyResult={taggerDependencyResult}
          kaloscopeStatus={kaloscopeStatus}
          isCheckingTaggerDependencies={isCheckingTaggerDependencies}
        />
      </section>

      <section>
        <KaloscopeSettingsCard
          heading="Kaloscope"
          actions={<SectionDirtyBadge dirty={hasKaloscopeChanges} />}
          kaloscopeDraft={kaloscopeDraft}
          kaloscopeStatus={kaloscopeStatus}
          onPatchKaloscope={onPatchKaloscope}
        />
      </section>

      <section>
        <TaggerSettingsCard
          heading="WD Tagger"
          actions={(
            <>
              {isCheckingTaggerDependencies ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t({ ko: 'WD Tagger 의존성 확인 중', en: 'Checking WD Tagger dependencies' })} /> : null}
              <SectionDirtyBadge dirty={hasTaggerChanges} />
            </>
          )}
          taggerDraft={taggerDraft}
          taggerModels={taggerModels}
          onPatchTagger={onPatchTagger}
        />
      </section>

      <section>
        <RatingWeightSettingsCard
          heading={t({ ko: '평가 가중치', en: 'Rating weights' })}
          actions={<SectionDirtyBadge dirty={hasRatingWeightsChanges} />}
          ratingWeightsDraft={ratingWeightsDraft}
          ratingTiersDraft={ratingTiersDraft}
          validationMessages={ratingWeightValidationMessages}
          onPatchRatingWeights={onPatchRatingWeights}
        />
      </section>

      <section>
        <RatingTierSettingsCard
          heading={t({ ko: '평가 등급', en: 'Rating tiers' })}
          actions={(
            <>
              <SectionDirtyBadge dirty={hasRatingTiersChanges} />
              <IconButton size="icon-sm" variant="outline" onClick={onAddRatingTier} label={t({ ko: '등급 추가', en: 'Add tier' })}>
                <Plus className="h-4 w-4" />
              </IconButton>
            </>
          )}
          ratingTiersDraft={ratingTiersDraft}
          validationMessages={ratingTierValidationMessages}
          onPatchRatingTier={onPatchRatingTier}
          onDeleteRatingTier={onDeleteRatingTier}
          onMoveRatingTierUp={onMoveRatingTierUp}
          onMoveRatingTierDown={onMoveRatingTierDown}
          onReorderRatingTier={onReorderRatingTier}
        />
      </section>
    </div>
  )
}

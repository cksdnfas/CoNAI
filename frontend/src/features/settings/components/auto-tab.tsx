import { Loader2, Plus, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AutoOverviewCard } from './auto-overview-card'
import { AutoTestCard } from './auto-test-card'
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
  onSaveTagger,
  onSaveKaloscope,
  onSaveRatingWeights,
  onSaveRatingTiers,
  isSavingTagger,
  isSavingKaloscope,
  isSavingRatingWeights,
  isSavingRatingTiers,
  isCheckingTaggerDependencies,
  autoTestHashInput,
  onAutoTestHashInputChange,
  autoTestMedia,
  autoTestImage,
  isLoadingAutoTestImage,
  taggerTestResult,
  kaloscopeTestResult,
  onResolveAutoTestMedia,
  onRandomAutoTestMedia,
  onRunTaggerAutoTest,
  onRunKaloscopeAutoTest,
  isResolvingAutoTestMedia,
  isPickingRandomAutoTestMedia,
  isRunningTaggerAutoTest,
  isRunningKaloscopeAutoTest,
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
          actions={
            <Button
              size="icon-sm"
              onClick={onSaveKaloscope}
              disabled={!kaloscopeDraft || isSavingKaloscope}
              aria-label={t({ ko: 'Kaloscope 저장', en: 'Save Kaloscope' })}
              title={t({ ko: 'Kaloscope 저장', en: 'Save Kaloscope' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
          kaloscopeDraft={kaloscopeDraft}
          kaloscopeStatus={kaloscopeStatus}
          onPatchKaloscope={onPatchKaloscope}
        />
      </section>

      <section>
        <TaggerSettingsCard
          heading="WD Tagger"
          actions={
            <Button
              size="icon-sm"
              onClick={onSaveTagger}
              disabled={!taggerDraft || isSavingTagger || isCheckingTaggerDependencies}
              aria-label={isCheckingTaggerDependencies ? t({ ko: 'WD Tagger 의존성 확인 중', en: 'Checking WD Tagger dependencies' }) : t({ ko: 'WD Tagger 저장', en: 'Save WD Tagger' })}
              title={isCheckingTaggerDependencies ? t({ ko: 'WD Tagger 의존성 확인 중', en: 'Checking WD Tagger dependencies' }) : t({ ko: 'WD Tagger 저장', en: 'Save WD Tagger' })}
            >
              {isCheckingTaggerDependencies ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </Button>
          }
          taggerDraft={taggerDraft}
          taggerModels={taggerModels}
          onPatchTagger={onPatchTagger}
        />
      </section>

      <section>
        <RatingWeightSettingsCard
          heading={t({ ko: '평가 가중치', en: 'Rating weights' })}
          actions={
            <Button
              size="icon-sm"
              onClick={onSaveRatingWeights}
              disabled={!ratingWeightsDraft || isSavingRatingWeights || ratingWeightValidationMessages.length > 0}
              aria-label={t({ ko: '평가 가중치 저장', en: 'Save rating weights' })}
              title={t({ ko: '평가 가중치 저장', en: 'Save rating weights' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
          ratingWeightsDraft={ratingWeightsDraft}
          ratingTiersDraft={ratingTiersDraft}
          validationMessages={ratingWeightValidationMessages}
          onPatchRatingWeights={onPatchRatingWeights}
        />
      </section>

      <section>
        <RatingTierSettingsCard
          heading={t({ ko: '평가 등급', en: 'Rating tiers' })}
          actions={
            <>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                onClick={onAddRatingTier}
                aria-label={t({ ko: '등급 추가', en: 'Add tier' })}
                title={t({ ko: '등급 추가', en: 'Add tier' })}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                onClick={onSaveRatingTiers}
                disabled={!ratingTiersDraft || isSavingRatingTiers || ratingTierValidationMessages.length > 0}
                aria-label={t({ ko: '평가 등급 저장', en: 'Save rating tiers' })}
                title={t({ ko: '평가 등급 저장', en: 'Save rating tiers' })}
              >
                <Save className="h-4 w-4" />
              </Button>
            </>
          }
          ratingTiersDraft={ratingTiersDraft}
          validationMessages={ratingTierValidationMessages}
          onPatchRatingTier={onPatchRatingTier}
          onDeleteRatingTier={onDeleteRatingTier}
          onMoveRatingTierUp={onMoveRatingTierUp}
          onMoveRatingTierDown={onMoveRatingTierDown}
          onReorderRatingTier={onReorderRatingTier}
        />
      </section>

      <section>
        <AutoTestCard
          heading={t({ ko: '테스트', en: 'Test' })}
          actions={
            <>
              <Button size="sm" variant="outline" onClick={onResolveAutoTestMedia} disabled={!autoTestHashInput.trim() || isResolvingAutoTestMedia}>
                {t({ ko: '해시 확인', en: 'Check hash' })}
              </Button>
              <Button size="sm" variant="outline" onClick={onRandomAutoTestMedia} disabled={isPickingRandomAutoTestMedia}>
                {t({ ko: '랜덤 선택', en: 'Random pick' })}
              </Button>
            </>
          }
          autoTestHashInput={autoTestHashInput}
          autoTestMedia={autoTestMedia}
          autoTestImage={autoTestImage}
          isLoadingAutoTestImage={isLoadingAutoTestImage}
          taggerTestResult={taggerTestResult}
          kaloscopeTestResult={kaloscopeTestResult}
          onAutoTestHashInputChange={onAutoTestHashInputChange}
          onResolveAutoTestMedia={onResolveAutoTestMedia}
          onRunTaggerAutoTest={onRunTaggerAutoTest}
          onRunKaloscopeAutoTest={onRunKaloscopeAutoTest}
          isRunningTaggerAutoTest={isRunningTaggerAutoTest}
          isRunningKaloscopeAutoTest={isRunningKaloscopeAutoTest}
        />
      </section>
    </div>
  )
}

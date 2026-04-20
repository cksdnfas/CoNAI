import { Loader2, Plus, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AutoOverviewCard } from './auto-overview-card'
import { AutoTestCard } from './auto-test-card'
import { KaloscopeSettingsCard } from './kaloscope-settings-card'
import { TaggerSettingsCard } from './tagger-settings-card'
import { RatingWeightSettingsCard } from './rating-weight-settings-card'
import { RatingTierSettingsCard } from './rating-tier-settings-card'
import type { AutoTabProps } from './auto-tab-types'

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
  return (
    <div className="space-y-6">
      <section>
        <AutoOverviewCard
          heading="개요"
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
              aria-label="Kaloscope 저장"
              title="Kaloscope 저장"
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
              aria-label={isCheckingTaggerDependencies ? 'WD Tagger 의존성 확인 중' : 'WD Tagger 저장'}
              title={isCheckingTaggerDependencies ? 'WD Tagger 의존성 확인 중' : 'WD Tagger 저장'}
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
          heading="평가 가중치"
          actions={
            <Button
              size="icon-sm"
              onClick={onSaveRatingWeights}
              disabled={!ratingWeightsDraft || isSavingRatingWeights || ratingWeightValidationMessages.length > 0}
              aria-label="평가 가중치 저장"
              title="평가 가중치 저장"
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
          heading="평가 등급"
          actions={
            <>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                onClick={onAddRatingTier}
                aria-label="등급 추가"
                title="등급 추가"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                onClick={onSaveRatingTiers}
                disabled={!ratingTiersDraft || isSavingRatingTiers || ratingTierValidationMessages.length > 0}
                aria-label="평가 등급 저장"
                title="평가 등급 저장"
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
          heading="테스트"
          actions={
            <>
              <Button size="sm" variant="outline" onClick={onResolveAutoTestMedia} disabled={!autoTestHashInput.trim() || isResolvingAutoTestMedia}>
                해시 확인
              </Button>
              <Button size="sm" variant="outline" onClick={onRandomAutoTestMedia} disabled={isPickingRandomAutoTestMedia}>
                랜덤 선택
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

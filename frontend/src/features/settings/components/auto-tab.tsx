import { AutoOverviewCard } from './auto-overview-card'
import { AutoTestCard } from './auto-test-card'
import { KaloscopeSettingsCard } from './kaloscope-settings-card'
import { TaggerSettingsCard } from './tagger-settings-card'
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
  onSaveTagger,
  onSaveKaloscope,
  isSavingTagger,
  isSavingKaloscope,
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
    <div className="space-y-8">
      <AutoOverviewCard
        taggerStatus={taggerStatus}
        taggerDependencyResult={taggerDependencyResult}
        kaloscopeStatus={kaloscopeStatus}
        isCheckingTaggerDependencies={isCheckingTaggerDependencies}
      />

      <KaloscopeSettingsCard
        kaloscopeDraft={kaloscopeDraft}
        kaloscopeStatus={kaloscopeStatus}
        onPatchKaloscope={onPatchKaloscope}
        onSaveKaloscope={onSaveKaloscope}
        isSavingKaloscope={isSavingKaloscope}
      />

      <TaggerSettingsCard
        taggerDraft={taggerDraft}
        taggerModels={taggerModels}
        onPatchTagger={onPatchTagger}
        onSaveTagger={onSaveTagger}
        isSavingTagger={isSavingTagger}
        isCheckingTaggerDependencies={isCheckingTaggerDependencies}
      />

      <AutoTestCard
        autoTestHashInput={autoTestHashInput}
        autoTestMedia={autoTestMedia}
        autoTestImage={autoTestImage}
        isLoadingAutoTestImage={isLoadingAutoTestImage}
        taggerTestResult={taggerTestResult}
        kaloscopeTestResult={kaloscopeTestResult}
        onAutoTestHashInputChange={onAutoTestHashInputChange}
        onResolveAutoTestMedia={onResolveAutoTestMedia}
        onRandomAutoTestMedia={onRandomAutoTestMedia}
        onRunTaggerAutoTest={onRunTaggerAutoTest}
        onRunKaloscopeAutoTest={onRunKaloscopeAutoTest}
        isResolvingAutoTestMedia={isResolvingAutoTestMedia}
        isPickingRandomAutoTestMedia={isPickingRandomAutoTestMedia}
        isRunningTaggerAutoTest={isRunningTaggerAutoTest}
        isRunningKaloscopeAutoTest={isRunningKaloscopeAutoTest}
      />
    </div>
  )
}

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
  onCheckTaggerDependencies,
  isSavingTagger,
  isSavingKaloscope,
  isCheckingTaggerDependencies,
  autoTestHashInput,
  onAutoTestHashInputChange,
  autoTestMedia,
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
      <AutoOverviewCard taggerStatus={taggerStatus} kaloscopeStatus={kaloscopeStatus} />

      <TaggerSettingsCard
        taggerDraft={taggerDraft}
        taggerModels={taggerModels}
        taggerDependencyResult={taggerDependencyResult}
        onPatchTagger={onPatchTagger}
        onSaveTagger={onSaveTagger}
        onCheckTaggerDependencies={onCheckTaggerDependencies}
        isSavingTagger={isSavingTagger}
        isCheckingTaggerDependencies={isCheckingTaggerDependencies}
      />

      <KaloscopeSettingsCard
        kaloscopeDraft={kaloscopeDraft}
        kaloscopeStatus={kaloscopeStatus}
        onPatchKaloscope={onPatchKaloscope}
        onSaveKaloscope={onSaveKaloscope}
        isSavingKaloscope={isSavingKaloscope}
      />

      <AutoTestCard
        autoTestHashInput={autoTestHashInput}
        autoTestMedia={autoTestMedia}
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

import { Button } from '@/components/ui/button'
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
            <Button size="sm" onClick={onSaveKaloscope} disabled={!kaloscopeDraft || isSavingKaloscope}>
              저장
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
            <Button size="sm" onClick={onSaveTagger} disabled={!taggerDraft || isSavingTagger || isCheckingTaggerDependencies}>
              {isCheckingTaggerDependencies ? '의존성 확인 중…' : '저장'}
            </Button>
          }
          taggerDraft={taggerDraft}
          taggerModels={taggerModels}
          onPatchTagger={onPatchTagger}
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

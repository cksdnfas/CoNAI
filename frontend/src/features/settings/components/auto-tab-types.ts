import type { AutoTestKaloscopeResult, AutoTestMediaRecord, AutoTestTaggerResult } from '@/lib/api'
import type {
  KaloscopeServerStatus,
  KaloscopeSettings,
  TaggerDependencyCheckResult,
  TaggerModelInfo,
  TaggerServerStatus,
  TaggerSettings,
} from '@/types/settings'

export interface AutoTabProps {
  taggerDraft: TaggerSettings | null
  kaloscopeDraft: KaloscopeSettings | null
  taggerModels: TaggerModelInfo[]
  taggerStatus: TaggerServerStatus | undefined
  kaloscopeStatus: KaloscopeServerStatus | undefined
  taggerDependencyResult: TaggerDependencyCheckResult | null
  onPatchTagger: (patch: Partial<TaggerSettings>) => void
  onPatchKaloscope: (patch: Partial<KaloscopeSettings>) => void
  onSaveTagger: () => void
  onSaveKaloscope: () => void
  isSavingTagger: boolean
  isSavingKaloscope: boolean
  isCheckingTaggerDependencies: boolean
  autoTestHashInput: string
  onAutoTestHashInputChange: (value: string) => void
  autoTestMedia: AutoTestMediaRecord | null
  taggerTestResult: AutoTestTaggerResult | null
  kaloscopeTestResult: AutoTestKaloscopeResult | null
  onResolveAutoTestMedia: () => void
  onRandomAutoTestMedia: () => void
  onRunTaggerAutoTest: () => void
  onRunKaloscopeAutoTest: () => void
  isResolvingAutoTestMedia: boolean
  isPickingRandomAutoTestMedia: boolean
  isRunningTaggerAutoTest: boolean
  isRunningKaloscopeAutoTest: boolean
}

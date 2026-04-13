import type { AutoTestKaloscopeResult, AutoTestMediaRecord, AutoTestTaggerResult, RatingWeightsRecord } from '@/lib/api'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { ImageRecord } from '@/types/image'
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
  ratingWeightsDraft: RatingWeightsRecord | null
  ratingWeightValidationMessages: string[]
  onPatchRatingWeights: (patch: Partial<Pick<RatingWeightsRecord, 'general_weight' | 'sensitive_weight' | 'questionable_weight' | 'explicit_weight'>>) => void
  ratingTiersDraft: RatingTierRecord[] | null
  ratingTierValidationMessages: string[]
  onPatchRatingTier: (tierId: number, patch: Partial<Pick<RatingTierRecord, 'tier_name' | 'min_score' | 'max_score' | 'color' | 'feed_visibility'>>) => void
  onAddRatingTier: () => void
  onDeleteRatingTier: (tierId: number) => void
  onMoveRatingTierUp: (tierId: number) => void
  onMoveRatingTierDown: (tierId: number) => void
  onReorderRatingTier: (sourceTierId: number, targetTierId: number) => void
  onSaveTagger: () => void
  onSaveKaloscope: () => void
  onSaveRatingWeights: () => void
  onSaveRatingTiers: () => void
  isSavingTagger: boolean
  isSavingKaloscope: boolean
  isSavingRatingWeights: boolean
  isSavingRatingTiers: boolean
  isCheckingTaggerDependencies: boolean
  autoTestHashInput: string
  onAutoTestHashInputChange: (value: string) => void
  autoTestMedia: AutoTestMediaRecord | null
  autoTestImage: ImageRecord | null
  isLoadingAutoTestImage: boolean
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

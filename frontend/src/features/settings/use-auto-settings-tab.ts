import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  checkTaggerDependencies,
  getImage,
  getKaloscopeStatus,
  getRandomAutoTestMedia,
  getRatingTiers,
  getRatingWeights,
  getTaggerModels,
  getTaggerStatus,
  resolveAutoTestMedia,
  runKaloscopeAutoTest,
  runTaggerAutoTest,
  updateKaloscopeSettings,
  updateRatingTiers,
  updateRatingWeights,
  updateTaggerSettings,
} from '@/lib/api'
import type {
  AutoTestKaloscopeResult,
  AutoTestMediaRecord,
  AutoTestTaggerResult,
  RatingWeightsRecord,
} from '@/lib/api'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { ImageRecord } from '@/types/image'
import type {
  KaloscopeSettings,
  TaggerDependencyCheckResult,
  TaggerSettings,
} from '@/types/settings'
import type { AutoTabProps } from './components/auto-tab-types'

interface UseAutoSettingsTabOptions {
  /** Whether the auto tab is currently active. */
  isActive: boolean
  /** Current saved-or-loaded tagger settings. */
  taggerSettings: TaggerSettings | null | undefined
  /** Current saved-or-loaded kaloscope settings. */
  kaloscopeSettings: KaloscopeSettings | null | undefined
  /** Sync the updated app settings into the shared query cache. */
  syncSettingsCache: (nextSettings: Awaited<ReturnType<typeof updateTaggerSettings>>) => void
  /** Refresh cross-cutting auto/settings queries after save. */
  refreshAutoQueries: () => Promise<void>
  /** Show a success/info snackbar for auto-tab actions. */
  notifyInfo: (message: string) => void
  /** Show an error snackbar for auto-tab actions. */
  notifyError: (message: string) => void
}

/** Validate rating-weight inputs before sending them to the backend. */
function validateRatingWeightsDraft(weights: RatingWeightsRecord | null) {
  if (!weights) {
    return [] as string[]
  }

  const messages: string[] = []
  const entries = [
    ['General', weights.general_weight],
    ['Sensitive', weights.sensitive_weight],
    ['Questionable', weights.questionable_weight],
    ['Explicit', weights.explicit_weight],
  ] as const

  for (const [label, value] of entries) {
    if (!Number.isFinite(value)) {
      messages.push(`${label} weight는 숫자여야 해.`)
      continue
    }
    if (value < 0) {
      messages.push(`${label} weight는 0 이상이어야 해.`)
    }
  }

  return messages
}

/** Validate rating tiers while keeping save-time range normalization simple. */
function validateRatingTiersDraft(tiers: RatingTierRecord[] | null) {
  if (!tiers || tiers.length === 0) {
    return ['최소 1개의 평가 등급이 필요해.']
  }

  const messages: string[] = []

  tiers.forEach((tier, index) => {
    const label = tier.tier_name.trim() || `Tier ${index + 1}`

    if (tier.tier_name.trim().length === 0) {
      messages.push(`등급 ${index + 1}의 이름이 비어 있어.`)
    }
    if (!Number.isFinite(tier.min_score) || tier.min_score < 0) {
      messages.push(`${label}의 최소 점수는 0 이상의 숫자여야 해.`)
    }
    if (index < tiers.length - 1) {
      if (tier.max_score === null || !Number.isFinite(tier.max_score)) {
        messages.push(`${label}의 최대 점수를 넣어줘.`)
      } else if (tier.max_score <= tier.min_score) {
        messages.push(`${label}의 최대 점수는 최소 점수보다 커야 해.`)
      }
    }

    const nextTier = tiers[index + 1]
    if (nextTier && tier.min_score >= nextTier.min_score) {
      messages.push(`${label} 다음 등급의 최소 점수는 더 커야 해.`)
    }
  })

  return Array.from(new Set(messages))
}

/** Keep tier ranges continuous while respecting edited boundaries. */
function normalizeRatingTierDrafts(tiers: RatingTierRecord[]) {
  if (tiers.length === 0) {
    return tiers
  }

  const normalized = tiers.map((tier) => ({ ...tier }))
  normalized[0].min_score = Math.max(0, normalized[0].min_score)

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]
    const current = normalized[index]
    const safeMinScore = Number.isFinite(current.min_score) ? current.min_score : previous.min_score + 1
    current.min_score = Math.max(previous.min_score + 1, safeMinScore)
    previous.max_score = current.min_score
  }

  normalized[normalized.length - 1].max_score = null
  return normalized
}

/** Collect auto-tab queries, drafts, validation, and auto-test flows. */
export function useAutoSettingsTab({
  isActive,
  taggerSettings,
  kaloscopeSettings,
  syncSettingsCache,
  refreshAutoQueries,
  notifyInfo,
  notifyError,
}: UseAutoSettingsTabOptions): { tabProps: AutoTabProps } {
  const queryClient = useQueryClient()
  const [taggerDraft, setTaggerDraft] = useState<TaggerSettings | null>(null)
  const [kaloscopeDraft, setKaloscopeDraft] = useState<KaloscopeSettings | null>(null)
  const [ratingWeightsDraft, setRatingWeightsDraft] = useState<RatingWeightsRecord | null>(null)
  const [ratingTiersDraft, setRatingTiersDraft] = useState<RatingTierRecord[] | null>(null)
  const [taggerDependencyResult, setTaggerDependencyResult] = useState<TaggerDependencyCheckResult | null>(null)
  const hasAutoCheckedTaggerDependenciesRef = useRef(false)
  const [autoTestHashInput, setAutoTestHashInput] = useState('')
  const [autoTestMedia, setAutoTestMedia] = useState<AutoTestMediaRecord | null>(null)
  const [taggerTestResult, setTaggerTestResult] = useState<AutoTestTaggerResult | null>(null)
  const [kaloscopeTestResult, setKaloscopeTestResult] = useState<AutoTestKaloscopeResult | null>(null)

  const taggerModelsQuery = useQuery({
    queryKey: ['tagger-models'],
    queryFn: getTaggerModels,
    enabled: isActive,
  })
  const taggerStatusQuery = useQuery({
    queryKey: ['tagger-status'],
    queryFn: getTaggerStatus,
    enabled: isActive,
  })
  const kaloscopeStatusQuery = useQuery({
    queryKey: ['kaloscope-status'],
    queryFn: getKaloscopeStatus,
    enabled: isActive,
  })
  const ratingWeightsQuery = useQuery({
    queryKey: ['rating-weights'],
    queryFn: getRatingWeights,
    enabled: isActive,
  })
  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
    enabled: isActive,
  })
  const autoTestImageQuery = useQuery({
    queryKey: ['auto-test-image-detail', autoTestMedia?.compositeHash],
    queryFn: () => getImage(autoTestMedia!.compositeHash),
    enabled: Boolean(autoTestMedia?.compositeHash),
  })

  const effectiveTaggerDraft = taggerDraft ?? taggerSettings ?? null
  const effectiveKaloscopeDraft = kaloscopeDraft ?? kaloscopeSettings ?? null
  const effectiveRatingWeightsDraft = ratingWeightsDraft ?? ratingWeightsQuery.data ?? null
  const effectiveRatingTiersDraft = ratingTiersDraft ?? ratingTiersQuery.data ?? null
  const ratingWeightValidationMessages = useMemo(
    () => validateRatingWeightsDraft(effectiveRatingWeightsDraft),
    [effectiveRatingWeightsDraft],
  )
  const ratingTierValidationMessages = useMemo(
    () => validateRatingTiersDraft(effectiveRatingTiersDraft),
    [effectiveRatingTiersDraft],
  )

  const applyAutoTestMedia = (media: AutoTestMediaRecord) => {
    setAutoTestHashInput(media.compositeHash)
    setAutoTestMedia(media)
    setTaggerTestResult(null)
    setKaloscopeTestResult(null)
  }

  const taggerMutation = useMutation({
    mutationFn: updateTaggerSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setTaggerDraft(settings.tagger)
      setTaggerDependencyResult(null)
      hasAutoCheckedTaggerDependenciesRef.current = false
      await queryClient.invalidateQueries({ queryKey: ['tagger-status'] })
      notifyInfo('프롬프트 추출 태거 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '태거 설정 저장에 실패했어.')
    },
  })

  const kaloscopeMutation = useMutation({
    mutationFn: updateKaloscopeSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setKaloscopeDraft(settings.kaloscope)
      await refreshAutoQueries()
      notifyInfo('자동 프롬프트 추출 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : 'Kaloscope 설정 저장에 실패했어.')
    },
  })

  const ratingWeightsMutation = useMutation({
    mutationFn: updateRatingWeights,
    onSuccess: (weights) => {
      queryClient.setQueryData(['rating-weights'], weights)
      setRatingWeightsDraft(weights)
      notifyInfo('평가 가중치를 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '평가 가중치 저장에 실패했어.')
    },
  })

  const ratingTiersMutation = useMutation({
    mutationFn: updateRatingTiers,
    onSuccess: (tiers) => {
      queryClient.setQueryData(['rating-tiers'], tiers)
      setRatingTiersDraft(tiers)
      notifyInfo('평가 등급 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '평가 등급 설정 저장에 실패했어.')
    },
  })

  const taggerDependencyMutation = useMutation({
    mutationFn: checkTaggerDependencies,
    onSuccess: (result) => {
      setTaggerDependencyResult(result)
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '태거 의존성 확인에 실패했어.')
    },
  })

  useEffect(() => {
    if (!isActive) return
    if (hasAutoCheckedTaggerDependenciesRef.current || taggerDependencyMutation.isPending) return

    hasAutoCheckedTaggerDependenciesRef.current = true
    void taggerDependencyMutation.mutateAsync()
  }, [isActive, taggerDependencyMutation])

  const autoTestResolveMutation = useMutation({
    mutationFn: resolveAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      if (media.existsOnDisk) {
        notifyInfo('테스트 대상을 확인했어.')
      } else {
        notifyError('대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
      }
    },
    onError: (error) => {
      setAutoTestMedia(null)
      setTaggerTestResult(null)
      setKaloscopeTestResult(null)
      notifyError(error instanceof Error ? error.message : '테스트 대상을 찾지 못했어.')
    },
  })

  const autoTestRandomMutation = useMutation({
    mutationFn: getRandomAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      if (media.existsOnDisk) {
        notifyInfo('랜덤 테스트 대상을 골랐어.')
      } else {
        notifyError('랜덤 대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
      }
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '랜덤 테스트 대상을 고르지 못했어.')
    },
  })

  const taggerAutoTestMutation = useMutation({
    mutationFn: runTaggerAutoTest,
    onSuccess: (result) => {
      setTaggerTestResult(result)
      notifyInfo('태거 테스트가 끝났어.')
    },
    onError: (error) => {
      setTaggerTestResult(null)
      notifyError(error instanceof Error ? error.message : '태거 테스트에 실패했어.')
    },
  })

  const kaloscopeAutoTestMutation = useMutation({
    mutationFn: runKaloscopeAutoTest,
    onSuccess: (result) => {
      setKaloscopeTestResult(result)
      notifyInfo('Kaloscope 테스트가 끝났어.')
    },
    onError: (error) => {
      setKaloscopeTestResult(null)
      notifyError(error instanceof Error ? error.message : 'Kaloscope 테스트에 실패했어.')
    },
  })

  const patchTaggerDraft = (patch: Partial<TaggerSettings>) => {
    if (!effectiveTaggerDraft) return
    setTaggerDraft({ ...effectiveTaggerDraft, ...patch })
  }

  const patchKaloscopeDraft = (patch: Partial<KaloscopeSettings>) => {
    if (!effectiveKaloscopeDraft) return
    setKaloscopeDraft({ ...effectiveKaloscopeDraft, ...patch })
  }

  const patchRatingWeightsDraft = (
    patch: Partial<Pick<RatingWeightsRecord, 'general_weight' | 'sensitive_weight' | 'questionable_weight' | 'explicit_weight'>>,
  ) => {
    if (!effectiveRatingWeightsDraft) return
    setRatingWeightsDraft({ ...effectiveRatingWeightsDraft, ...patch })
  }

  const patchRatingTierDraft = (
    tierId: number,
    patch: Partial<Pick<RatingTierRecord, 'tier_name' | 'min_score' | 'max_score' | 'color' | 'feed_visibility'>>,
  ) => {
    if (!effectiveRatingTiersDraft) return

    const currentIndex = effectiveRatingTiersDraft.findIndex((tier) => tier.id === tierId)
    const nextDraft = effectiveRatingTiersDraft.map((tier) => (tier.id === tierId ? { ...tier, ...patch } : tier))

    if (currentIndex >= 0 && currentIndex < nextDraft.length - 1 && patch.max_score !== undefined) {
      const nextTier = nextDraft[currentIndex + 1]
      nextTier.min_score = patch.max_score === null ? nextTier.min_score : Math.max(nextDraft[currentIndex].min_score + 1, patch.max_score)
    }

    setRatingTiersDraft(normalizeRatingTierDrafts(nextDraft))
  }

  const addRatingTierDraft = () => {
    const currentTiers = effectiveRatingTiersDraft ?? []
    if (currentTiers.length === 0) {
      setRatingTiersDraft(normalizeRatingTierDrafts([
        {
          id: Date.now(),
          tier_name: 'New Tier',
          min_score: 0,
          max_score: null,
          tier_order: 1,
          color: '#a78bfa',
          feed_visibility: 'show',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]))
      return
    }

    const lastTier = currentTiers[currentTiers.length - 1]
    const nextMinScore = Math.max(lastTier.min_score + 1, lastTier.min_score + 10)
    const now = new Date().toISOString()

    setRatingTiersDraft(normalizeRatingTierDrafts([
      ...currentTiers.slice(0, -1),
      {
        ...lastTier,
        max_score: nextMinScore,
      },
      {
        id: Date.now(),
        tier_name: `Tier ${currentTiers.length + 1}`,
        min_score: nextMinScore,
        max_score: null,
        tier_order: currentTiers.length + 1,
        color: '#f43f5e',
        feed_visibility: 'show',
        created_at: now,
        updated_at: now,
      },
    ]))
  }

  const deleteRatingTierDraft = (tierId: number) => {
    if (!effectiveRatingTiersDraft || effectiveRatingTiersDraft.length <= 1) return

    const remaining = effectiveRatingTiersDraft.filter((tier) => tier.id !== tierId)
    setRatingTiersDraft(normalizeRatingTierDrafts(remaining))
  }

  const reorderRatingTierDraft = (sourceTierId: number, targetTierId: number) => {
    if (!effectiveRatingTiersDraft || sourceTierId === targetTierId) return

    const currentIndex = effectiveRatingTiersDraft.findIndex((tier) => tier.id === sourceTierId)
    const targetIndex = effectiveRatingTiersDraft.findIndex((tier) => tier.id === targetTierId)
    if (currentIndex === -1 || targetIndex === -1) return

    const slots = effectiveRatingTiersDraft.map((tier) => ({
      min_score: tier.min_score,
      max_score: tier.max_score,
    }))
    const reordered = [...effectiveRatingTiersDraft]
    const [movedTier] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, movedTier)

    setRatingTiersDraft(normalizeRatingTierDrafts(reordered.map((tier, index) => ({
      ...tier,
      min_score: slots[index].min_score,
      max_score: slots[index].max_score,
    }))))
  }

  const moveRatingTierDraft = (tierId: number, direction: 'up' | 'down') => {
    if (!effectiveRatingTiersDraft) return

    const currentIndex = effectiveRatingTiersDraft.findIndex((tier) => tier.id === tierId)
    if (currentIndex === -1) return

    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (nextIndex < 0 || nextIndex >= effectiveRatingTiersDraft.length) return

    reorderRatingTierDraft(tierId, effectiveRatingTiersDraft[nextIndex].id)
  }

  const handleSaveRatingWeights = () => {
    if (!effectiveRatingWeightsDraft) return
    if (ratingWeightValidationMessages.length > 0) {
      notifyError(ratingWeightValidationMessages[0])
      return
    }

    void ratingWeightsMutation.mutateAsync({
      general_weight: effectiveRatingWeightsDraft.general_weight,
      sensitive_weight: effectiveRatingWeightsDraft.sensitive_weight,
      questionable_weight: effectiveRatingWeightsDraft.questionable_weight,
      explicit_weight: effectiveRatingWeightsDraft.explicit_weight,
    })
  }

  const handleSaveRatingTiers = () => {
    if (!effectiveRatingTiersDraft) return
    if (ratingTierValidationMessages.length > 0) {
      notifyError(ratingTierValidationMessages[0])
      return
    }

    const normalizedTiers = effectiveRatingTiersDraft.map((tier, index) => ({
      tier_name: tier.tier_name.trim() || `Tier ${index + 1}`,
      min_score: tier.min_score,
      max_score: index === effectiveRatingTiersDraft.length - 1 ? null : effectiveRatingTiersDraft[index + 1].min_score,
      tier_order: index + 1,
      color: tier.color?.trim() || null,
      feed_visibility: tier.feed_visibility ?? 'show',
    }))

    void ratingTiersMutation.mutateAsync(normalizedTiers)
  }

  const handleAutoTestHashInputChange = (value: string) => {
    setAutoTestHashInput(value)
    setAutoTestMedia(null)
    setTaggerTestResult(null)
    setKaloscopeTestResult(null)
  }

  const handleResolveAutoTestMedia = () => {
    const nextHash = autoTestHashInput.trim()
    if (!nextHash) return
    void autoTestResolveMutation.mutateAsync(nextHash)
  }

  const handleRunTaggerAutoTest = () => {
    if (!autoTestMedia?.existsOnDisk) return
    setTaggerTestResult(null)
    void taggerAutoTestMutation.mutateAsync(autoTestMedia.compositeHash)
  }

  const handleRunKaloscopeAutoTest = () => {
    if (!autoTestMedia?.existsOnDisk) return
    setKaloscopeTestResult(null)
    void kaloscopeAutoTestMutation.mutateAsync(autoTestMedia.compositeHash)
  }

  return {
    tabProps: {
      taggerDraft: effectiveTaggerDraft,
      kaloscopeDraft: effectiveKaloscopeDraft,
      taggerModels: taggerModelsQuery.data ?? [],
      taggerStatus: taggerStatusQuery.data,
      kaloscopeStatus: kaloscopeStatusQuery.data,
      taggerDependencyResult,
      onPatchTagger: patchTaggerDraft,
      onPatchKaloscope: patchKaloscopeDraft,
      ratingWeightsDraft: effectiveRatingWeightsDraft,
      ratingWeightValidationMessages,
      onPatchRatingWeights: patchRatingWeightsDraft,
      ratingTiersDraft: effectiveRatingTiersDraft,
      ratingTierValidationMessages,
      onPatchRatingTier: patchRatingTierDraft,
      onAddRatingTier: addRatingTierDraft,
      onDeleteRatingTier: deleteRatingTierDraft,
      onMoveRatingTierUp: (tierId: number) => moveRatingTierDraft(tierId, 'up'),
      onMoveRatingTierDown: (tierId: number) => moveRatingTierDraft(tierId, 'down'),
      onReorderRatingTier: reorderRatingTierDraft,
      onSaveTagger: () => effectiveTaggerDraft && void taggerMutation.mutateAsync(effectiveTaggerDraft),
      onSaveKaloscope: () => effectiveKaloscopeDraft && void kaloscopeMutation.mutateAsync(effectiveKaloscopeDraft),
      onSaveRatingWeights: handleSaveRatingWeights,
      onSaveRatingTiers: handleSaveRatingTiers,
      isSavingTagger: taggerMutation.isPending,
      isSavingKaloscope: kaloscopeMutation.isPending,
      isSavingRatingWeights: ratingWeightsMutation.isPending,
      isSavingRatingTiers: ratingTiersMutation.isPending,
      isCheckingTaggerDependencies: taggerDependencyMutation.isPending,
      autoTestHashInput,
      onAutoTestHashInputChange: handleAutoTestHashInputChange,
      autoTestMedia,
      autoTestImage: (autoTestImageQuery.data as ImageRecord | undefined) ?? null,
      isLoadingAutoTestImage: autoTestImageQuery.isLoading,
      taggerTestResult,
      kaloscopeTestResult,
      onResolveAutoTestMedia: handleResolveAutoTestMedia,
      onRandomAutoTestMedia: () => void autoTestRandomMutation.mutateAsync(),
      onRunTaggerAutoTest: handleRunTaggerAutoTest,
      onRunKaloscopeAutoTest: handleRunKaloscopeAutoTest,
      isResolvingAutoTestMedia: autoTestResolveMutation.isPending,
      isPickingRandomAutoTestMedia: autoTestRandomMutation.isPending,
      isRunningTaggerAutoTest: taggerAutoTestMutation.isPending,
      isRunningKaloscopeAutoTest: kaloscopeAutoTestMutation.isPending,
    },
  }
}

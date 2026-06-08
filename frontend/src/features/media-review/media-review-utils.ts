import { createTextSearchChip } from '@/features/search/search-utils'
import { buildGroupCountMaps, getGroupHierarchyTotalCount } from '@/features/groups/group-count-utils'
import type { SearchChip } from '@/features/search/search-types'
import type { ImageRecord } from '@/types/image'
import type { GroupWithHierarchy } from '@/types/group'

export type MediaReviewQueueKey = 'all' | 'needs-review' | 'reviewed' | 'ungrouped' | 'missing-tags' | 'sparse-tags' | 'unrated' | 'similar' | 'recoverable'
export type MediaReviewTagQuality = 'missing' | 'sparse' | 'ready'
export type MediaReviewRecoverabilityState = 'active' | 'missing' | 'deleted'
export type MediaReviewRecommendationPriority = 'high' | 'medium' | 'low'
export type MediaReviewTagQualitySuggestionKey = 'retag-missing' | 'retag-sparse' | 'review-unrated' | 'tag-quality-ready'
export type MediaReviewGroupQualityCheckKey = 'ungrouped-loaded' | 'empty-groups' | 'auto-collect-not-run' | 'large-root-groups' | 'group-coverage-ready'

export interface MediaReviewSignals {
  compositeHash: string | null
  groupCount: number
  ratingScore: number | null
  ratingLabel: string | null
  tagCount: number
  tagQuality: MediaReviewTagQuality
  isSimilarMatch: boolean
  recoverabilityState: MediaReviewRecoverabilityState
}

export interface MediaReviewSignalSummary {
  totalCount: number
  groupedCount: number
  ungroupedCount: number
  ratedCount: number
  unratedCount: number
  missingTagCount: number
  sparseTagCount: number
  similarCount: number
  recoverableCount: number
}

export interface MediaReviewRecommendedQueue {
  queue: Exclude<MediaReviewQueueKey, 'all' | 'reviewed'>
  count: number
  priority: MediaReviewRecommendationPriority
}

export interface MediaReviewTagQualitySuggestion {
  key: MediaReviewTagQualitySuggestionKey
  count: number
  queue: MediaReviewQueueKey | null
  priority: MediaReviewRecommendationPriority
}

export interface MediaReviewGroupQualityCheck {
  key: MediaReviewGroupQualityCheckKey
  count: number
  queue: MediaReviewQueueKey | null
  priority: MediaReviewRecommendationPriority
  groupIds: number[]
}

function getRecordCount(record: Record<string, unknown> | null | undefined) {
  return record ? Object.keys(record).length : 0
}

function getTopRatingLabel(record: Record<string, number> | null | undefined) {
  if (!record) {
    return null
  }

  const [topRating] = Object.entries(record)
    .filter(([, score]) => Number.isFinite(score))
    .sort((a, b) => b[1] - a[1])

  return topRating?.[0] ?? null
}

export function buildMediaReviewSearchChips(searchText: string): SearchChip[] {
  const trimmedSearchText = searchText.trim()
  if (!trimmedSearchText) {
    return []
  }

  const chips: SearchChip[] = []
  const promptChip = createTextSearchChip('positive', trimmedSearchText, { operator: 'OR' })
  const autoTagChip = createTextSearchChip('auto', trimmedSearchText, { operator: 'OR' })
  const modelChip = createTextSearchChip('model', trimmedSearchText, { operator: 'OR' })

  if (promptChip) chips.push(promptChip)
  if (autoTagChip) chips.push(autoTagChip)
  if (modelChip) chips.push(modelChip)

  return chips
}

export function getMediaReviewSignals(image: ImageRecord, similarHashSet?: ReadonlySet<string>): MediaReviewSignals {
  const tagger = image.auto_tags?.tagger ?? null
  const rating = image.auto_tags?.rating ?? tagger?.rating ?? null
  const generalTagCount = getRecordCount(image.auto_tags?.general ?? tagger?.general)
  const characterTagCount = getRecordCount(image.auto_tags?.character ?? tagger?.character)
  const tagCount = generalTagCount + characterTagCount
  const compositeHash = typeof image.composite_hash === 'string' && image.composite_hash.length > 0 ? image.composite_hash : null
  const tagQuality: MediaReviewTagQuality = tagCount === 0 ? 'missing' : tagCount < 6 ? 'sparse' : 'ready'
  const recoverabilityState: MediaReviewRecoverabilityState = image.file_status === 'deleted'
    ? 'deleted'
    : image.file_status === 'missing'
      ? 'missing'
      : 'active'

  return {
    compositeHash,
    groupCount: image.groups?.length ?? 0,
    ratingScore: typeof image.rating_score === 'number' && Number.isFinite(image.rating_score) ? image.rating_score : null,
    ratingLabel: getTopRatingLabel(rating),
    tagCount,
    tagQuality,
    isSimilarMatch: compositeHash ? similarHashSet?.has(compositeHash) === true : false,
    recoverabilityState,
  }
}

export function getMediaReviewSignalSummary(images: ImageRecord[], similarHashSet?: ReadonlySet<string>): MediaReviewSignalSummary {
  return images.reduce<MediaReviewSignalSummary>((summary, image) => {
    const signals = getMediaReviewSignals(image, similarHashSet)

    summary.totalCount += 1
    if (signals.groupCount > 0) {
      summary.groupedCount += 1
    } else {
      summary.ungroupedCount += 1
    }

    if (signals.ratingScore === null && signals.ratingLabel === null) {
      summary.unratedCount += 1
    } else {
      summary.ratedCount += 1
    }

    if (signals.tagQuality === 'missing') {
      summary.missingTagCount += 1
    }

    if (signals.tagQuality === 'sparse') {
      summary.sparseTagCount += 1
    }

    if (signals.isSimilarMatch) {
      summary.similarCount += 1
    }

    if (signals.recoverabilityState !== 'active') {
      summary.recoverableCount += 1
    }

    return summary
  }, {
    totalCount: 0,
    groupedCount: 0,
    ungroupedCount: 0,
    ratedCount: 0,
    unratedCount: 0,
    missingTagCount: 0,
    sparseTagCount: 0,
    similarCount: 0,
    recoverableCount: 0,
  })
}

function getReviewRecommendationPriority(count: number, highThreshold: number, mediumThreshold = 1): MediaReviewRecommendationPriority {
  if (count >= highThreshold) {
    return 'high'
  }

  if (count >= mediumThreshold) {
    return 'medium'
  }

  return 'low'
}

export function getMediaReviewRecommendedQueues(
  summary: MediaReviewSignalSummary,
  options?: { reviewedCount?: number; maxItems?: number },
): MediaReviewRecommendedQueue[] {
  const needsReviewCount = Math.max(0, summary.totalCount - Math.max(0, Math.trunc(options?.reviewedCount ?? 0)))
  const candidates: MediaReviewRecommendedQueue[] = [
    {
      queue: 'recoverable',
      count: summary.recoverableCount,
      priority: getReviewRecommendationPriority(summary.recoverableCount, 1),
    },
    {
      queue: 'missing-tags',
      count: summary.missingTagCount,
      priority: getReviewRecommendationPriority(summary.missingTagCount, 1),
    },
    {
      queue: 'sparse-tags',
      count: summary.sparseTagCount,
      priority: getReviewRecommendationPriority(summary.sparseTagCount, 12),
    },
    {
      queue: 'ungrouped',
      count: summary.ungroupedCount,
      priority: getReviewRecommendationPriority(summary.ungroupedCount, 12),
    },
    {
      queue: 'unrated',
      count: summary.unratedCount,
      priority: getReviewRecommendationPriority(summary.unratedCount, 12),
    },
    {
      queue: 'similar',
      count: summary.similarCount,
      priority: getReviewRecommendationPriority(summary.similarCount, 6),
    },
    {
      queue: 'needs-review',
      count: needsReviewCount,
      priority: 'low',
    },
  ]

  return candidates
    .filter((candidate) => candidate.count > 0)
    .sort((left, right) => {
      const priorityRank = { high: 0, medium: 1, low: 2 } satisfies Record<MediaReviewRecommendationPriority, number>
      const queueRank = {
        recoverable: 0,
        'missing-tags': 1,
        'sparse-tags': 2,
        ungrouped: 3,
        unrated: 4,
        similar: 5,
        'needs-review': 6,
      } satisfies Record<MediaReviewRecommendedQueue['queue'], number>
      return priorityRank[left.priority] - priorityRank[right.priority]
        || queueRank[left.queue] - queueRank[right.queue]
        || right.count - left.count
    })
    .slice(0, options?.maxItems ?? 4)
}

export function getMediaReviewTagQualitySuggestions(summary: MediaReviewSignalSummary): MediaReviewTagQualitySuggestion[] {
  const suggestions: MediaReviewTagQualitySuggestion[] = []

  if (summary.missingTagCount > 0) {
    suggestions.push({
      key: 'retag-missing',
      count: summary.missingTagCount,
      queue: 'missing-tags',
      priority: getReviewRecommendationPriority(summary.missingTagCount, 8),
    })
  }

  if (summary.sparseTagCount > 0) {
    suggestions.push({
      key: 'retag-sparse',
      count: summary.sparseTagCount,
      queue: 'sparse-tags',
      priority: getReviewRecommendationPriority(summary.sparseTagCount, 12),
    })
  }

  if (summary.unratedCount > 0) {
    suggestions.push({
      key: 'review-unrated',
      count: summary.unratedCount,
      queue: 'unrated',
      priority: getReviewRecommendationPriority(summary.unratedCount, 12),
    })
  }

  if (suggestions.length === 0) {
    suggestions.push({
      key: 'tag-quality-ready',
      count: summary.totalCount,
      queue: null,
      priority: 'low',
    })
  }

  return suggestions
}

export function getMediaReviewGroupQualityChecks(
  images: ImageRecord[],
  groups: GroupWithHierarchy[],
): MediaReviewGroupQualityCheck[] {
  const summary = getMediaReviewSignalSummary(images)
  const countMaps = buildGroupCountMaps(groups)

  const emptyGroups = groups.filter((group) => getGroupHierarchyTotalCount(group, countMaps) === 0)
  const autoCollectNotRunGroups = groups.filter((group) => group.auto_collect_enabled && !group.auto_collect_last_run)
  const largeRootGroups = groups.filter((group) => group.parent_id == null && getGroupHierarchyTotalCount(group, countMaps) >= 500)
  const checks: MediaReviewGroupQualityCheck[] = []

  if (summary.ungroupedCount > 0) {
    checks.push({
      key: 'ungrouped-loaded',
      count: summary.ungroupedCount,
      queue: 'ungrouped',
      priority: getReviewRecommendationPriority(summary.ungroupedCount, 12),
      groupIds: [],
    })
  }

  if (emptyGroups.length > 0) {
    checks.push({
      key: 'empty-groups',
      count: emptyGroups.length,
      queue: null,
      priority: getReviewRecommendationPriority(emptyGroups.length, 6),
      groupIds: emptyGroups.map((group) => group.id),
    })
  }

  if (autoCollectNotRunGroups.length > 0) {
    checks.push({
      key: 'auto-collect-not-run',
      count: autoCollectNotRunGroups.length,
      queue: null,
      priority: getReviewRecommendationPriority(autoCollectNotRunGroups.length, 4),
      groupIds: autoCollectNotRunGroups.map((group) => group.id),
    })
  }

  if (largeRootGroups.length > 0) {
    checks.push({
      key: 'large-root-groups',
      count: largeRootGroups.length,
      queue: null,
      priority: 'medium',
      groupIds: largeRootGroups.map((group) => group.id),
    })
  }

  if (checks.length === 0) {
    checks.push({
      key: 'group-coverage-ready',
      count: groups.length,
      queue: null,
      priority: 'low',
      groupIds: groups.map((group) => group.id),
    })
  }

  return checks
}

export function filterMediaReviewImages(images: ImageRecord[], queue: MediaReviewQueueKey, similarHashSet?: ReadonlySet<string>, reviewedIdSet?: ReadonlySet<string>) {
  if (queue === 'all') {
    return images
  }

  return images.filter((image) => {
    const signals = getMediaReviewSignals(image, similarHashSet)
    const imageId = String(image.composite_hash ?? image.id)

    if (queue === 'ungrouped') {
      return signals.groupCount === 0
    }

    if (queue === 'needs-review') {
      return reviewedIdSet?.has(imageId) !== true
    }

    if (queue === 'reviewed') {
      return reviewedIdSet?.has(imageId) === true
    }

    if (queue === 'missing-tags') {
      return signals.tagQuality === 'missing'
    }

    if (queue === 'sparse-tags') {
      return signals.tagQuality === 'sparse'
    }

    if (queue === 'unrated') {
      return signals.ratingScore === null && signals.ratingLabel === null
    }

    if (queue === 'recoverable') {
      return signals.recoverabilityState !== 'active'
    }

    return signals.isSimilarMatch
  })
}

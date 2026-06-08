import { createTextSearchChip } from '@/features/search/search-utils'
import type { SearchChip } from '@/features/search/search-types'
import type { ImageRecord } from '@/types/image'

export type MediaReviewQueueKey = 'all' | 'ungrouped' | 'missing-tags' | 'sparse-tags' | 'unrated' | 'similar'
export type MediaReviewTagQuality = 'missing' | 'sparse' | 'ready'

export interface MediaReviewSignals {
  compositeHash: string | null
  groupCount: number
  ratingScore: number | null
  ratingLabel: string | null
  tagCount: number
  tagQuality: MediaReviewTagQuality
  isSimilarMatch: boolean
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

  return {
    compositeHash,
    groupCount: image.groups?.length ?? 0,
    ratingScore: typeof image.rating_score === 'number' && Number.isFinite(image.rating_score) ? image.rating_score : null,
    ratingLabel: getTopRatingLabel(rating),
    tagCount,
    tagQuality,
    isSimilarMatch: compositeHash ? similarHashSet?.has(compositeHash) === true : false,
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
  })
}

export function filterMediaReviewImages(images: ImageRecord[], queue: MediaReviewQueueKey, similarHashSet?: ReadonlySet<string>) {
  if (queue === 'all') {
    return images
  }

  return images.filter((image) => {
    const signals = getMediaReviewSignals(image, similarHashSet)

    if (queue === 'ungrouped') {
      return signals.groupCount === 0
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

    return signals.isSimilarMatch
  })
}

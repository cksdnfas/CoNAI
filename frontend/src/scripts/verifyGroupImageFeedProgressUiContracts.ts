import { getGroupImageFeedProgressSummary } from '../features/groups/group-image-feed-progress'
import {
  buildMediaReviewSearchChips,
  filterMediaReviewImages,
  getMediaReviewSignals,
  getMediaReviewSignalSummary,
} from '../features/media-review/media-review-utils'
import type { ImageRecord } from '../types/image'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertEmptySummary() {
  const summary = getGroupImageFeedProgressSummary({ loadedCount: 0, visibleCount: 0 })

  assertEqual(summary.loadedCount, 0, 'empty group feed should report zero loaded')
  assertEqual(summary.visibleCount, 0, 'empty group feed should report zero visible')
  assertEqual(summary.totalCount, 0, 'empty group feed should report zero total')
  assertEqual(summary.hiddenCount, 0, 'empty group feed should report zero hidden')
}

function assertPagedSummary() {
  const summary = getGroupImageFeedProgressSummary({ loadedCount: 40, visibleCount: 36, totalCount: 95 })

  assertEqual(summary.loadedCount, 40, 'loaded count should reflect fetched group images')
  assertEqual(summary.visibleCount, 36, 'visible count should reflect rating-filtered group images')
  assertEqual(summary.totalCount, 95, 'total count should use group image pagination total')
  assertEqual(summary.hiddenCount, 4, 'hidden count should show safety-filtered loaded items')
}

function assertTotalNeverFallsBelowLoaded() {
  const summary = getGroupImageFeedProgressSummary({ loadedCount: 12, visibleCount: 15, totalCount: 4 })

  assertEqual(summary.loadedCount, 12, 'loaded count should preserve returned rows')
  assertEqual(summary.visibleCount, 15, 'visible count should preserve caller-visible rows for diagnostics')
  assertEqual(summary.totalCount, 12, 'total count should not render below loaded rows')
  assertEqual(summary.hiddenCount, 0, 'visible rows above loaded should not create negative hidden count')
}

function assertCountNormalization() {
  const summary = getGroupImageFeedProgressSummary({ loadedCount: 4.9, visibleCount: -2.1, totalCount: Number.NaN })

  assertEqual(summary.loadedCount, 4, 'decimal loaded count should be truncated')
  assertEqual(summary.visibleCount, 0, 'negative visible count should clamp to zero')
  assertEqual(summary.totalCount, 4, 'non-finite total count should fall back no lower than loaded')
  assertEqual(summary.hiddenCount, 4, 'hidden count should use normalized counts')
}

assertEmptySummary()
assertPagedSummary()
assertTotalNeverFallsBelowLoaded()
assertCountNormalization()

const mediaReviewImages: ImageRecord[] = [
  {
    id: 1,
    composite_hash: 'hash-grouped-ready',
    groups: [{ id: 1, name: 'group', collection_type: 'manual' }],
    rating_score: 42,
    auto_tags: {
      general: { sky: 0.9, tree: 0.8, cloud: 0.7, river: 0.6, grass: 0.5, sunlight: 0.4 },
      character: {},
      rating: { general: 0.98 },
    },
  },
  {
    id: 2,
    composite_hash: 'hash-ungrouped-missing',
    groups: [],
    rating_score: null,
    auto_tags: null,
  },
  {
    id: 3,
    composite_hash: 'hash-ungrouped-sparse',
    groups: [],
    rating_score: null,
    auto_tags: {
      general: { face: 0.7, portrait: 0.65 },
      character: {},
      rating: { sensitive: 0.52 },
    },
  },
]

const similarHashSet = new Set(['hash-ungrouped-sparse'])
const summary = getMediaReviewSignalSummary(mediaReviewImages, similarHashSet)

assertEqual(summary.totalCount, 3, 'media review summary should count loaded review rows')
assertEqual(summary.groupedCount, 1, 'media review should surface grouped rows')
assertEqual(summary.ungroupedCount, 2, 'media review should surface ungrouped rows')
assertEqual(summary.ratedCount, 2, 'media review should treat rating label or score as rated')
assertEqual(summary.unratedCount, 1, 'media review should surface missing rating rows')
assertEqual(summary.missingTagCount, 1, 'media review should surface missing auto-tag rows')
assertEqual(summary.sparseTagCount, 1, 'media review should surface sparse tag-quality rows')
assertEqual(summary.similarCount, 1, 'media review should surface selected-anchor similarity matches')

assertEqual(getMediaReviewSignals(mediaReviewImages[0]).tagQuality, 'ready', 'six or more prompt tags should be review-ready')
assertEqual(filterMediaReviewImages(mediaReviewImages, 'ungrouped').length, 2, 'ungrouped queue should not move or delete media')
assertEqual(filterMediaReviewImages(mediaReviewImages, 'missing-tags').length, 1, 'missing-tags queue should isolate items without auto tags')
assertEqual(filterMediaReviewImages(mediaReviewImages, 'sparse-tags').length, 1, 'sparse-tags queue should isolate weak tag coverage')
assertEqual(filterMediaReviewImages(mediaReviewImages, 'unrated').length, 1, 'unrated queue should isolate items with no rating signal')
assertEqual(filterMediaReviewImages(mediaReviewImages, 'similar', similarHashSet).length, 1, 'similar queue should use the selected-anchor hash set')
assertEqual(filterMediaReviewImages(mediaReviewImages, 'needs-review', similarHashSet, new Set(['hash-grouped-ready'])).length, 2, 'needs-review queue should hide session-reviewed items without moving media')
assertEqual(filterMediaReviewImages(mediaReviewImages, 'reviewed', similarHashSet, new Set(['hash-grouped-ready'])).length, 1, 'reviewed queue should isolate session-reviewed items without schema changes')

const reviewSearchChips = buildMediaReviewSearchChips('comfy forest')
assertEqual(reviewSearchChips.length, 3, 'media review search should combine prompt, auto-tag, and model search chips')
assertEqual(reviewSearchChips.every((chip) => chip.operator === 'OR'), true, 'media review search chips should share OR semantics for one text query')

console.log('Group image feed progress UI contracts verified.')

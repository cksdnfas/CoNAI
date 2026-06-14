import { getGroupImageFeedProgressSummary } from '../features/groups/group-image-feed-progress'

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

console.log('Group image feed progress UI contracts verified.')

import { getGenerationHistoryFeedProgressSummary } from '../features/image-generation/generation-history-feed-progress'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertEmptySummary() {
  const summary = getGenerationHistoryFeedProgressSummary({ loadedCount: 0, visibleCount: 0 })

  assertEqual(summary.loadedCount, 0, 'empty history feed should report zero loaded')
  assertEqual(summary.visibleCount, 0, 'empty history feed should report zero visible')
  assertEqual(summary.totalCount, 0, 'empty history feed should report zero total')
  assertEqual(summary.hiddenCount, 0, 'empty history feed should report zero hidden')
}

function assertPagedSummary() {
  const summary = getGenerationHistoryFeedProgressSummary({ loadedCount: 40, visibleCount: 40, totalCount: 125 })

  assertEqual(summary.loadedCount, 40, 'loaded count should reflect fetched history rows')
  assertEqual(summary.visibleCount, 40, 'visible count should reflect rendered history cards')
  assertEqual(summary.totalCount, 125, 'total count should use history pagination total')
  assertEqual(summary.hiddenCount, 0, 'history feed should not report hidden rows when all loaded rows render')
}

function assertFilteredSummary() {
  const summary = getGenerationHistoryFeedProgressSummary({ loadedCount: 40, visibleCount: 36, totalCount: 125 })

  assertEqual(summary.hiddenCount, 4, 'hidden count should reflect loaded rows not visible in the card list')
}

function assertTotalNeverFallsBelowLoaded() {
  const summary = getGenerationHistoryFeedProgressSummary({ loadedCount: 12, visibleCount: 15, totalCount: 4 })

  assertEqual(summary.loadedCount, 12, 'loaded count should preserve returned history rows')
  assertEqual(summary.visibleCount, 15, 'visible count should preserve caller-visible rows for diagnostics')
  assertEqual(summary.totalCount, 12, 'total count should not render below loaded rows')
  assertEqual(summary.hiddenCount, 0, 'visible rows above loaded should not create negative hidden count')
}

function assertCountNormalization() {
  const summary = getGenerationHistoryFeedProgressSummary({ loadedCount: 4.9, visibleCount: -2.1, totalCount: Number.NaN })

  assertEqual(summary.loadedCount, 4, 'decimal loaded count should be truncated')
  assertEqual(summary.visibleCount, 0, 'negative visible count should clamp to zero')
  assertEqual(summary.totalCount, 4, 'non-finite total count should fall back no lower than loaded')
  assertEqual(summary.hiddenCount, 4, 'hidden count should use normalized counts')
}

assertEmptySummary()
assertPagedSummary()
assertFilteredSummary()
assertTotalNeverFallsBelowLoaded()
assertCountNormalization()

console.log('Generation history feed progress UI contracts verified.')

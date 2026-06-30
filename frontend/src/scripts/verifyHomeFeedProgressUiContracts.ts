import { getHomeFeedProgressSummary } from '../features/home/home-feed-progress'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertEmptyFeedSummary() {
  const summary = getHomeFeedProgressSummary(undefined, 0)

  assertEqual(summary.loadedCount, 0, 'empty feed should report zero loaded')
  assertEqual(summary.visibleCount, 0, 'empty feed should report zero visible')
  assertEqual(summary.totalCount, 0, 'empty feed should report zero total')
  assertEqual(summary.hiddenCount, 0, 'empty feed should report zero hidden')
}

function assertPagedFeedSummary() {
  const summary = getHomeFeedProgressSummary([
    { total: 95, images: [{ id: 1 }, { id: 2 }] as never[] },
    { total: 95, images: [{ id: 3 }] as never[] },
  ], 2)

  assertEqual(summary.loadedCount, 3, 'loaded count should sum image records across pages')
  assertEqual(summary.visibleCount, 2, 'visible count should use filtered visible items')
  assertEqual(summary.totalCount, 95, 'total count should use first page API total')
  assertEqual(summary.hiddenCount, 1, 'hidden count should show safety-filtered loaded items')
}

function assertTotalNeverFallsBelowLoaded() {
  const summary = getHomeFeedProgressSummary([{ total: 1, images: [{ id: 1 }, { id: 2 }] as never[] }], 4)

  assertEqual(summary.loadedCount, 2, 'loaded count should still reflect returned rows')
  assertEqual(summary.visibleCount, 4, 'visible count should preserve caller-visible rows for diagnostics')
  assertEqual(summary.totalCount, 2, 'total count should not render below loaded rows')
  assertEqual(summary.hiddenCount, 0, 'visible rows above loaded should not create negative hidden count')
}

function assertCursorFeedUsesLoadedCountWhenTotalUnknown() {
  const summary = getHomeFeedProgressSummary([
    { total: 41, totalKnown: false, images: [{ id: 1 }, { id: 2 }] as never[] },
    { total: 41, totalKnown: false, images: [{ id: 3 }, { id: 4 }] as never[] },
  ], 4)

  assertEqual(summary.loadedCount, 4, 'cursor feed should still count loaded rows')
  assertEqual(summary.totalCount, 4, 'cursor feed should not render approximate API total as exact total')
}

function assertVisibleCountNormalization() {
  const negativeSummary = getHomeFeedProgressSummary([{ total: 3, images: [{ id: 1 }] as never[] }], -2.9)
  const nanSummary = getHomeFeedProgressSummary([{ total: 3, images: [{ id: 1 }] as never[] }], Number.NaN)

  assertEqual(negativeSummary.visibleCount, 0, 'negative visible count should clamp to zero')
  assertEqual(nanSummary.visibleCount, 0, 'non-finite visible count should clamp to zero')
}

assertEmptyFeedSummary()
assertPagedFeedSummary()
assertTotalNeverFallsBelowLoaded()
assertCursorFeedUsesLoadedCountWhenTotalUnknown()
assertVisibleCountNormalization()

console.log('Home feed progress UI contracts verified.')

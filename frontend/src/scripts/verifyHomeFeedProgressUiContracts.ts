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
  assertEqual(summary.isTotalKnown, false, 'empty feed should not claim an exact total')
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
  assertEqual(summary.isTotalKnown, false, 'cursor feed without a deferred total should report it as unknown')
}

/**
 * The first page is now requested with includeTotal=false, so the exact total
 * arrives from a separate later request. The summary must stay renderable before
 * it lands and must switch to the exact value once it does.
 */
function assertDeferredTotalArrival() {
  const pages = [
    { total: 2, totalKnown: false, images: [{ id: 1 }, { id: 2 }] as never[] },
    { total: 2, totalKnown: false, images: [{ id: 3 }, { id: 4 }] as never[] },
  ]

  const beforeTotal = getHomeFeedProgressSummary(pages, 4, { deferredTotal: null })
  assertEqual(beforeTotal.totalCount, 4, 'feed should fall back to loaded rows before the deferred total arrives')
  assertEqual(beforeTotal.isTotalKnown, false, 'feed should mark the total unknown before it arrives')

  const afterTotal = getHomeFeedProgressSummary(pages, 4, { deferredTotal: 1234 })
  assertEqual(afterTotal.totalCount, 1234, 'deferred total should replace the loaded-row fallback')
  assertEqual(afterTotal.isTotalKnown, true, 'deferred total should mark the total known')
  assertEqual(afterTotal.loadedCount, 4, 'deferred total must not change loaded rows')
  assertEqual(afterTotal.hiddenCount, 0, 'deferred total must not change hidden rows')

  const undercountedTotal = getHomeFeedProgressSummary(pages, 4, { deferredTotal: 1 })
  assertEqual(undercountedTotal.totalCount, 4, 'a stale deferred total must never render below loaded rows')
}

/** Callers that still pass an exact per-page total keep their existing behavior. */
function assertExactPageTotalWinsOverDeferred() {
  const summary = getHomeFeedProgressSummary([{ total: 95, images: [{ id: 1 }] as never[] }], 1, { deferredTotal: 7 })

  assertEqual(summary.totalCount, 95, 'an exact page total should not be overridden by a deferred total')
  assertEqual(summary.isTotalKnown, true, 'an exact page total should report as known')
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
assertDeferredTotalArrival()
assertExactPageTotalWinsOverDeferred()
assertVisibleCountNormalization()

console.log('Home feed progress UI contracts verified.')

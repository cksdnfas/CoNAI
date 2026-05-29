import { doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGenerationHistoryFeedProgressSummary } from '../features/image-generation/generation-history-feed-progress'

const generationHistoryPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/generation-history-panel.tsx'),
  'utf8',
)

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

function assertStatusSummarySourcePolicy() {
  match(
    generationHistoryPanelSource,
    /function getHistoryRecordStatusSummary\(records: GenerationHistoryResponse\['records'\]\): HistoryRecordStatusSummary \{[\s\S]*?for \(const record of records\)[\s\S]*?summary\.inFlight \+= 1[\s\S]*?summary\.completed \+= 1[\s\S]*?summary\.failed \+= 1[\s\S]*?summary\.cancellation \+= 1/,
    'generation history panel should aggregate status badge counts in one pass',
  )
  match(
    generationHistoryPanelSource,
    /inFlight: inFlightHistoryCount,[\s\S]*?completed: completedHistoryCount,[\s\S]*?failed: failedHistoryCount,[\s\S]*?cancellation: cancellationHistoryCount,[\s\S]*?\} = useMemo\(\(\) => getHistoryRecordStatusSummary\(historyRecords\), \[historyRecords\]\)/,
    'generation history panel should memoize one status summary for badge counts',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /historyRecords\.filter\(/,
    'generation history badge counts must not rescan the visible history list once per status',
  )
}

function assertRefreshPolicySource() {
  match(
    generationHistoryPanelSource,
    /const GENERATION_HISTORY_ACTIVE_REFRESH_MS = 1_500[\s\S]*?const GENERATION_HISTORY_POSTPROCESS_REFRESH_MS = 5_000/,
    'generation history should use separate refresh cadences for active generation and postprocess-only waits',
  )
  match(
    generationHistoryPanelSource,
    /function hasActiveGenerationHistory\(records: GenerationHistoryResponse\['records'\]\) \{[\s\S]*?record\.generation_status === 'pending'[\s\S]*?record\.generation_status === 'processing'[\s\S]*?record\.queue_status === 'running'/,
    'generation history fast polling should be driven by actual active generation or queue status',
  )
  match(
    generationHistoryPanelSource,
    /function hasPostprocessPendingHistory\(records: GenerationHistoryResponse\['records'\]\) \{[\s\S]*?record\.generation_status === 'completed'[\s\S]*?Boolean\(record\.composite_hash\)[\s\S]*?!record\.actual_composite_hash/,
    'completed rows waiting only on postprocess visibility should use the slower refresh path',
  )
  match(
    generationHistoryPanelSource,
    /if \(hasActiveGenerationHistory\(records\)\) \{[\s\S]*?return GENERATION_HISTORY_ACTIVE_REFRESH_MS[\s\S]*?historyRefreshWatchUntil > Date\.now\(\)[\s\S]*?return GENERATION_HISTORY_ACTIVE_REFRESH_MS[\s\S]*?hasPostprocessPendingHistory\(records\) \? GENERATION_HISTORY_POSTPROCESS_REFRESH_MS : false/,
    'generation history refresh interval should keep submit-watch fast but slow down completed postprocess waits',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /hasInFlightHistory/,
    'generation history should not fast-poll forever from display-only processing status',
  )
}

function assertImageListCallbackSourcePolicy() {
  match(
    generationHistoryPanelSource,
    /const getHistoryImageHref = useCallback\(\(image: ImageRecord\) => \{[\s\S]*?return `\/images\/\$\{image\.composite_hash\}`[\s\S]*?\}, \[historyRecordMap\]\)/,
    'generation history image links should use a stable callback for the virtualized image list',
  )
  match(
    generationHistoryPanelSource,
    /const renderHistoryItemOverlay = useCallback\(\(image: ImageRecord\) => \{[\s\S]*?const cancellationLabel = getHistoryCancellationBadgeLabel\(record\)[\s\S]*?\}, \[historyRecordMap\]\)/,
    'generation history item overlay should use a stable callback and cache cancellation labels per render',
  )
  match(
    generationHistoryPanelSource,
    /const renderHistoryPersistentOverlay = useCallback\(\(image: ImageRecord\) => \{[\s\S]*?renderSafetyPersistentOverlay\(image\)[\s\S]*?\}, \[historyRecordMap, renderSafetyPersistentOverlay\]\)/,
    'generation history persistent overlay should keep a stable callback when history records are unchanged',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /renderItemOverlay=\{\(image\) =>/,
    'generation history image list should not recreate the item overlay callback inline',
  )
}

assertEmptySummary()
assertPagedSummary()
assertFilteredSummary()
assertTotalNeverFallsBelowLoaded()
assertCountNormalization()
assertStatusSummarySourcePolicy()
assertRefreshPolicySource()
assertImageListCallbackSourcePolicy()

console.log('Generation history feed progress UI contracts verified.')

import { doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGenerationHistoryFeedProgressSummary } from '../features/image-generation/generation-history-feed-progress'

const generationHistoryPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/generation-history-panel.tsx'),
  'utf8',
)
const generationHistoryPanelHelpersSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/generation-history-panel-helpers.ts'),
  'utf8',
)
const generationHistoryStatusSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/generation-history-status.ts'),
  'utf8',
)
const generationHistoryRouteHelpersSource = readFileSync(
  resolve(process.cwd(), '../backend/src/routes/generation-history/historyRouteHelpers.ts'),
  'utf8',
)
const generationHistoryModelSource = readFileSync(
  resolve(process.cwd(), '../backend/src/models/GenerationHistory.ts'),
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
    generationHistoryPanelHelpersSource,
    /function getHistoryRecordStatusSummary\(records: GenerationHistoryResponse\['records'\]\): HistoryRecordStatusSummary \{[\s\S]*?for \(const record of records\)[\s\S]*?summary\.inFlight \+= 1[\s\S]*?summary\.completed \+= 1[\s\S]*?summary\.failed \+= 1[\s\S]*?summary\.cancellation \+= 1/,
    'generation history panel should aggregate status badge counts in one pass',
  )
  match(
    generationHistoryPanelSource,
    /inFlight: inFlightHistoryCount,[\s\S]*?completed: completedHistoryCount,[\s\S]*?cleanupFailed: cleanupFailedHistoryCount,[\s\S]*?cancellation: cancellationHistoryCount,[\s\S]*?\} = useMemo\(\(\) => getHistoryRecordStatusSummary\(historyRecords\), \[historyRecords\]\)/,
    'generation history panel should memoize one status summary for badge counts',
  )
  match(
    generationHistoryPanelHelpersSource,
    /if \(record\.generation_status === 'failed'\) \{[\s\S]*?summary\.cleanupFailed \+= 1/,
    'generation history cleanup should only enable from raw failed history rows that the cleanup endpoint removes',
  )
  match(
    generationHistoryPanelSource,
    /disabled=\{isCleaningFailed \|\| cleanupFailedHistoryCount === 0\}/,
    'clean failed action should not enable from display-only missing/postprocess result states',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /historyRecords\.filter\(/,
    'generation history badge counts must not rescan the visible history list once per status',
  )
}

function assertRefreshPolicySource() {
  match(
    generationHistoryPanelHelpersSource,
    /const GENERATION_HISTORY_ACTIVE_REFRESH_MS = 1_500[\s\S]*?const GENERATION_HISTORY_POSTPROCESS_REFRESH_MS = 5_000/,
    'generation history should use separate refresh cadences for active generation and postprocess-only waits',
  )
  match(
    generationHistoryPanelHelpersSource,
    /function hasActiveGenerationHistory\(records: GenerationHistoryResponse\['records'\]\) \{[\s\S]*?const displayStatus = resolveHistoryDisplayStatus\(record\)[\s\S]*?displayStatus === 'failed' \|\| isHistoryPostprocessPending\(record\)[\s\S]*?return displayStatus === 'pending' \|\| displayStatus === 'processing'/,
    'generation history fast polling should be driven by effective active display status and skip terminal/postprocess rows',
  )
  match(
    generationHistoryPanelHelpersSource,
    /function hasPostprocessPendingHistory\(records: GenerationHistoryResponse\['records'\]\) \{[\s\S]*?return records\.some\(isHistoryPostprocessPending\)/,
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

function assertDownloadReadinessSourcePolicy() {
  match(
    generationHistoryPanelHelpersSource,
    /function isHistoryRecordDownloadReady\(record: GenerationHistoryResponse\['records'\]\[number\]\) \{[\s\S]*?resolveHistoryDisplayStatus\(record\) === 'completed'[\s\S]*?Boolean\(record\.actual_composite_hash\)/,
    'generation history downloads should require a completed display status and resolved main-image metadata',
  )
  match(
    generationHistoryPanelSource,
    /const downloadableHistoryIds = useMemo\([\s\S]*?\.filter\(isHistoryRecordDownloadReady\)[\s\S]*?\[selectedHistoryRecords\]/,
    'downloadable history ids should use the shared readiness guard',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /Boolean\(record\.actual_composite_hash \|\| record\.composite_hash\)/,
    'postprocess-pending history rows must not be counted as downloadable from legacy composite_hash alone',
  )
  match(
    generationHistoryStatusSource,
    /function resolveHistoryImageSource\(record: GenerationHistoryRecord\) \{[\s\S]*?const compositeHash = record\.actual_composite_hash \|\| null/,
    'history image source URLs should require resolved main-image metadata',
  )
  match(
    generationHistoryStatusSource,
    /function isHistoryPostprocessPending\(record: GenerationHistoryRecord\) \{[\s\S]*?record\.generation_status === 'completed'[\s\S]*?Boolean\(record\.composite_hash\)[\s\S]*?record\.result_file_status === 'active'[\s\S]*?!record\.actual_composite_hash/,
    'history postprocess waits should require a completed row with an active result file and no ready main-image metadata',
  )
  match(
    generationHistoryStatusSource,
    /function isHistoryMissingLinkedResult\(record: GenerationHistoryRecord\) \{[\s\S]*?record\.generation_status === 'completed'[\s\S]*?!record\.actual_composite_hash[\s\S]*?!record\.composite_hash \|\| record\.result_file_status !== 'active'/,
    'completed history rows without any active ready result file should be classified as missing linked results',
  )
  match(
    generationHistoryModelSource,
    /CASE WHEN matched_file\.file_status = 'active' THEN im\.composite_hash ELSE NULL END as actual_composite_hash/,
    'generation history should expose ready media hashes only for active backing files',
  )
  match(
    generationHistoryModelSource,
    /matched_file\.file_status as result_file_status/,
    'generation history should return backing file state for display classification',
  )
  match(
    generationHistoryStatusSource,
    /if \(isHistoryMissingLinkedResult\(record\)\) \{[\s\S]*?return 'failed'[\s\S]*?\}[\s\S]*?return isHistoryPostprocessPending\(record\) \? 'processing' : 'completed'/,
    'completed history rows without a result hash must not stay stuck as display-only processing',
  )
  match(
    generationHistoryStatusSource,
    /if \(record && isHistoryMissingLinkedResult\(record\)\) return '결과 없음'[\s\S]*?if \(record && isHistoryPostprocessPending\(record\)\) return '후처리 중'/,
    'history status labels should distinguish missing results from postprocess waits',
  )
  match(
    generationHistoryRouteHelpersSource,
    /function getHistoryCompositeHash\(record: \{ actual_composite_hash\?: string \| null \}\) \{[\s\S]*?return record\.actual_composite_hash \|\| null;/,
    'direct generation-history media routes should require resolved main-image metadata',
  )
  doesNotMatch(
    generationHistoryStatusSource,
    /record\.actual_composite_hash \|\| record\.composite_hash/,
    'history image sources must not fall back to legacy hashes before postprocess visibility is ready',
  )
}

function assertSelectionRecoverySourcePolicy() {
  match(
    generationHistoryPanelHelpersSource,
    /function collectRetryableHistoryRecords\(records: readonly GenerationHistoryRecord\[\]\) \{[\s\S]*?return records\.filter\(canRetryHistoryQueueJob\)/,
    'generation history should share retryable record collection between recovery panel and selected actions',
  )
  match(
    generationHistoryPanelHelpersSource,
    /function getRetryableHistoryQueueJobIds\(records: readonly GenerationHistoryRecord\[\]\) \{[\s\S]*?\.map\(getRetryableHistoryQueueJobId\)[\s\S]*?queueJobId is number/,
    'generation history should share queue job id extraction for one-off and bulk retry actions',
  )
  match(
    generationHistoryPanelSource,
    /const selectedRetryableHistoryRecords = useMemo\([\s\S]*?collectRetryableHistoryRecords\(selectedHistoryRecords\)[\s\S]*?\[selectedHistoryRecords\]/,
    'selected generation history rows should expose retryable records without duplicating retry detection',
  )
  match(
    generationHistoryPanelSource,
    /const handleRetryHistoryRecords = useCallback\(async \([\s\S]*?runGenerationQueueMutation\([\s\S]*?acknowledgeRecoveryRecords\(retryableRecords\)[\s\S]*?\}, \[acknowledgeRecoveryRecords, isRetryingRunRecovery, queryClient, refreshHistory, showSnackbar\]\)/,
    'single, visible-bulk, and selected-bulk retry flows should share one queue mutation path',
  )
  match(
    generationHistoryPanelSource,
    /selectedRetryableHistoryRecords\.length > 0[\s\S]*?handleRetrySelectedHistoryRecords\(\)[\s\S]*?선택 재실행/,
    'selection action bar should offer a rerun action when selected history rows are retryable',
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
assertDownloadReadinessSourcePolicy()
assertSelectionRecoverySourcePolicy()

console.log('Generation history feed progress UI contracts verified.')

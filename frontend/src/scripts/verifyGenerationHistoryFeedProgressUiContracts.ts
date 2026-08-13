import { doesNotMatch, match } from 'node:assert/strict'
import { resolve } from 'node:path'
import verifyHelpers from '../../../scripts/verify-helpers'
import { getGenerationHistoryFeedProgressSummary } from '../features/image-generation/generation-history-feed-progress'
import { getImageListPreviewUrl } from '../features/images/components/image-list/image-list-utils'
import { getImageDetailQueryKey, getImageDetailRequestUrl } from '../lib/api-images'

const { createSourceReader, reportVerificationSuccess } = verifyHelpers
const source = createSourceReader(resolve(process.cwd(), '..'))
const generationHistoryPanelSource = source('frontend/src/features/image-generation/components/generation-history-panel.tsx')
const lazyRoutesSource = source('frontend/src/app/lazy-routes.tsx')
const generationHistoryPanelHelpersSource = source('frontend/src/features/image-generation/components/generation-history-panel-helpers.ts')
const generationHistoryRetryActionsSource = source('frontend/src/features/image-generation/components/generation-history-retry-actions.ts')
const generationHistoryStatusSource = source('frontend/src/features/image-generation/generation-history-status.ts')
const generationHistoryRouteHelpersSource = source('backend/src/routes/generation-history/historyRouteHelpers.ts')
const generationHistoryQueryRepositorySource = source('backend/src/repositories/history/HistoryQueryRepository.ts')
const sharedSettingsTypesSource = source('shared/src/types/settings.ts')
const backendSettingsDefaultsSource = source('backend/src/services/settingsServiceStorage.ts')
const backendSettingsRoutesSource = source('backend/src/routes/settings/general-settings.routes.ts')
const runtimeMediaSettingsRoutesSource = source('backend/src/routes/runtime-media-settings.routes.ts')
const registerAppRoutesSource = source('backend/src/startup/registerAppRoutes.ts')
const publicWorkflowRoutesSource = source('backend/src/routes/public-workflows.routes.ts')
const apiSettingsSource = source('frontend/src/lib/api-settings.ts')
const generalPreferencesSource = source('frontend/src/features/settings/components/general-preferences-sections.tsx')
const generationHistoryRoutesSource = source('backend/src/routes/generation-history.routes.ts')
const generationHistoryMediaHandlersSource = source('backend/src/routes/generation-history/mediaRouteHandlers.ts')
const mediaMetadataFileQueriesSource = source('backend/src/models/Image/MediaMetadataFileQueries.ts')
const imageListSource = source('frontend/src/features/images/components/image-list/image-list.tsx')
const imageModalProviderSource = source('frontend/src/features/images/components/detail/image-view-modal-provider.tsx')
const imageDetailViewSource = source('frontend/src/features/images/image-detail-view.tsx')
const imageDetailUtilsSource = source('frontend/src/features/images/components/detail/image-detail-utils.ts')
const imageDownloadTriggerSource = source('frontend/src/features/images/components/image-download-trigger-button.tsx')

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

function readRefreshConstantMs(constantName: string) {
  const declaration = new RegExp(`const ${constantName} = ([0-9_]+)\\b`).exec(generationHistoryPanelHelpersSource)

  if (!declaration) {
    throw new Error(`generation history should declare ${constantName} as a numeric refresh cadence`)
  }

  const parsed = Number(declaration[1].replace(/_/g, ''))

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${constantName} should be a positive refresh interval, got ${declaration[1]}`)
  }

  return parsed
}

function assertActiveRefreshStaysBelowPostprocessRefresh() {
  const activeRefreshMs = readRefreshConstantMs('GENERATION_HISTORY_ACTIVE_REFRESH_MS')
  const postprocessRefreshMs = readRefreshConstantMs('GENERATION_HISTORY_POSTPROCESS_REFRESH_MS')

  if (activeRefreshMs >= postprocessRefreshMs) {
    throw new Error(
      `active generation refresh (${activeRefreshMs}ms) should stay faster than the postprocess-only wait refresh (${postprocessRefreshMs}ms)`,
    )
  }
}

function assertRefreshPolicySource() {
  match(
    generationHistoryPanelHelpersSource,
    /const GENERATION_HISTORY_ACTIVE_REFRESH_MS = 3_000[\s\S]*?const GENERATION_HISTORY_POSTPROCESS_REFRESH_MS = 5_000/,
    'generation history should use separate refresh cadences for active generation and postprocess-only waits',
  )
  assertActiveRefreshStaysBelowPostprocessRefresh()
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
  match(
    generationHistoryPanelSource,
    /const legacyInterval = resolveLegacyHistoryInterval\(\)[\s\S]*?const streamInterval = resolveStreamFallbackInterval\(runtimeStreamStatus, legacyInterval\)/,
    'history polling should be wrapped by the runtime stream fallback so the legacy cadence returns when SSE dies',
  )
  // 완료/ready 이벤트 유실 시 live 상태에는 다른 복구 경로가 없다: 대기 행이 남아 있는 동안만
  // 느린 워치독 폴링을 유지하고, 유휴 목록은 종전대로 폴링 0 을 지킨다.
  match(
    generationHistoryPanelSource,
    /if \(streamInterval === false && legacyInterval !== false\) \{[\s\S]*?return GENERATION_HISTORY_STREAM_WATCHDOG_REFRESH_MS/,
    'a live stream must keep a slow watchdog poll while rows still wait on generation or postprocess visibility',
  )
  const watchdogRefreshMs = readRefreshConstantMs('GENERATION_HISTORY_STREAM_WATCHDOG_REFRESH_MS')
  const postprocessRefreshFloorMs = readRefreshConstantMs('GENERATION_HISTORY_POSTPROCESS_REFRESH_MS')
  if (watchdogRefreshMs <= postprocessRefreshFloorMs) {
    throw new Error(
      `the live-stream watchdog (${watchdogRefreshMs}ms) must stay slower than the degraded-mode postprocess cadence (${postprocessRefreshFloorMs}ms), or SSE stops saving requests`,
    )
  }
  match(
    generationHistoryPanelSource,
    /const \{ status: runtimeStreamStatus \} = useRuntimeEventStream\(\)/,
    'generation history should read the shared runtime stream status instead of opening its own connection',
  )
}

/**
 * QLIST-2: 히스토리 목록의 결과 미디어 해석이 행별 상관 서브쿼리를 쓰지 않아야 한다.
 * 20만행 `image_files` 를 히스토리 행마다 다시 탐색하면 페이지 요청 1회가 목록 크기에 비례한다.
 */
function assertHistoryListLookupCostPolicy() {
  const listQuery = /static findAllWithMetadata\([\s\S]*?\n {2}\}/.exec(generationHistoryQueryRepositorySource)?.[0] ?? ''
  if (listQuery.length === 0) {
    throw new Error('generation history model must keep a findAllWithMetadata list surface')
  }

  doesNotMatch(
    listQuery,
    /SELECT if2\.id/,
    'history list rows must not resolve their backing file through a per-row correlated subquery',
  )
  doesNotMatch(
    listQuery,
    /LEFT JOIN main_db\./,
    'history list pagination must not carry cross-database joins that run before LIMIT is applied',
  )
  match(
    listQuery,
    /return this\.attachResultMediaViews\(rows\)/,
    'history list rows should resolve display media through one precomputed lookup',
  )
  match(
    generationHistoryQueryRepositorySource,
    /private static readResultMediaViews\(compositeHashes: string\[\]\)[\s\S]*?FROM main_db\.image_files matched_file[\s\S]*?WHERE matched_file\.composite_hash IN \(/,
    'history result media should be read with one indexed IN lookup per page',
  )
  match(
    generationHistoryQueryRepositorySource,
    /function isPreferredHistoryResultFile\([\s\S]*?candidate\.file_status === 'active' \? 0 : 1[\s\S]*?candidate\.file_id > current\.file_id/,
    'the in-memory file preference must reproduce the previous "active first, newest id" SQL ordering',
  )
  match(
    generationHistoryQueryRepositorySource,
    /static countListRecords\([\s\S]*?historyListCountCache\.get\(cacheKey\)[\s\S]*?HISTORY_LIST_COUNT_CACHE_TTL_MS/,
    'history list counts should be memoized for a few seconds instead of rerunning per page request',
  )
  match(
    generationHistoryQueryRepositorySource,
    /static invalidateListCountCache\(\): void/,
    'history writes must be able to invalidate the cached list count immediately',
  )
}

/**
 * QLIST-4: 활성 리프레시는 첫 페이지만 서버에서 다시 읽는다.
 * 종전에는 로드된 전 페이지를 매 리프레시마다 리페치해 서버 부하가 스크롤 깊이에 비례했다.
 */
function assertHistoryFirstPageRefreshPolicy() {
  match(
    generationHistoryPanelHelpersSource,
    /function readCachedHistoryPage\([\s\S]*?cached\.pageParams\.findIndex\(\(param\) => param === pageParam\)[\s\S]*?cached\.pages\[pageIndex\]/,
    'the history panel must be able to reuse an already-cached page instead of refetching it',
  )
  match(
    generationHistoryPanelHelpersSource,
    /function hasStableHistoryPageBoundary\([\s\S]*?previousFirstPage\.records\.length !== nextFirstPage\.records\.length[\s\S]*?previousLastId === nextLastId/,
    'cached later pages may only be reused while the first page boundary is unchanged',
  )
  match(
    generationHistoryPanelSource,
    /if \(pageParam > 0 && !isFullHistoryRefreshRef\.current && !hasHistoryPageBoundaryShiftRef\.current\) \{[\s\S]*?readCachedHistoryPage\(queryClient, historyQueryKey, pageParam\)[\s\S]*?return cachedPage/,
    'automatic history refreshes must only refetch the first page',
  )
  match(
    generationHistoryPanelSource,
    /hasHistoryPageBoundaryShiftRef\.current = !hasStableHistoryPageBoundary\(previousFirstPage, page\)/,
    'a shifted first page must fall back to a full refetch so rows cannot silently disappear',
  )
  match(
    generationHistoryPanelSource,
    /isFullHistoryRefreshRef\.current = true[\s\S]*?await refetchHistory\(\)[\s\S]*?isFullHistoryRefreshRef\.current = false/,
    'explicit refreshes (button, delete, rerun, parent nonce) must still reload every loaded page',
  )
}

function assertImageListCallbackSourcePolicy() {
  match(
    generationHistoryPanelSource,
    /const getHistoryImageHref = useCallback\(\(image: ImageRecord\) => \{[\s\S]*?return `\/images\/\$\{image\.composite_hash\}`[\s\S]*?\}, \[historyRecordMap\]\)/,
    'generation history image links should use a stable callback for the virtualized image list',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /renderHistoryItemOverlay|renderHistoryPersistentOverlay/,
    'generation history cards should not attach status or metadata badge overlays to images',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /renderItem(?:Persistent)?Overlay=\{/,
    'generation history image list should leave image surfaces free of badge overlays',
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
    generationHistoryQueryRepositorySource,
    /CASE WHEN matched_file\.file_status = 'active' THEN im\.composite_hash ELSE NULL END as actual_composite_hash/,
    'generation history should expose ready media hashes only for active backing files',
  )
  match(
    generationHistoryQueryRepositorySource,
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
    /const handleRetryHistoryRecords = useCallback\(async \([\s\S]*?retryGenerationHistoryRecords\(\{[\s\S]*?records: retryableRecords,[\s\S]*?queryClient,[\s\S]*?refreshHistory,[\s\S]*?succeededQueueJobIds[\s\S]*?acknowledgeRecoveryRecords\(retryableRecords\.filter/,
    'single, visible-bulk, and selected-bulk retry flows should share one queue mutation path',
  )
  match(
    generationHistoryRetryActionsSource,
    /function getUniqueRetryableHistoryQueueJobIds\(records: readonly GenerationHistoryRecord\[\]\) \{[\s\S]*?new Set\(getRetryableHistoryQueueJobIds\(records\)\)/,
    'history retry boundary should dedupe queue job ids before calling the queue retry API',
  )
  match(
    generationHistoryRetryActionsSource,
    /GENERATION_HISTORY_MUTATION_CONCURRENCY = 4[\s\S]*?workerCount[\s\S]*?Promise\.all\(Array\.from\(\{ length: workerCount \}/,
    'generation history mutations must use a bounded worker pool',
  )
  doesNotMatch(
    generationHistoryRetryActionsSource,
    /Promise\.all\(queueJobIds\.map/,
    'bulk retry must not fan every selected queue job out at once',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /Promise\.all\(selectedHistoryRecords\.map/,
    'bulk deletion must not fan every selected history record out at once',
  )
  match(
    generationHistoryPanelSource,
    /runGenerationHistoryMutationBatch\([\s\S]*?failedSelectionIds[\s\S]*?await refreshHistory\(\)[\s\S]*?result\.failedItems\.length/,
    'bulk deletion must refresh after settled partial results and retain failed selections',
  )
  match(
    generationHistoryRetryActionsSource,
    /runGenerationHistoryMutationBatch\(queueJobIds[\s\S]*?refreshHistory\(\{ watchForNewRows: true \}\)[\s\S]*?partialFailureMessage/,
    'bulk retry must refresh after settled partial results and report a partial failure',
  )
  match(
    generationHistoryPanelSource,
    /selectedRetryableHistoryRecords\.length > 0[\s\S]*?handleRetrySelectedHistoryRecords\(\)[\s\S]*?선택 재실행/,
    'selection action bar should offer a rerun action when selected history rows are retryable',
  )
}

function assertNoImageBadgeOverlaySourcePolicy() {
  doesNotMatch(
    generationHistoryPanelHelpersSource,
    /getHistoryMediaReviewBadges|HistoryMediaReviewBadge|formatHistoryMimeLabel/,
    'generation history should not keep media review badge helpers after removing image overlays',
  )
  doesNotMatch(
    generationHistoryPanelSource,
    /getHistoryCancellationBadgeLabel|getHistoryStatusLabel|resolveHistoryDisplayStatus/,
    'generation history panel should not import badge-only image overlay status helpers',
  )
}

function assertHistoryRatingSafetySettingSourcePolicy() {
  match(
    sharedSettingsTypesSource,
    /applyRatingSafetyToGenerationHistory: boolean/,
    'shared general settings should type the generation history rating-safety option',
  )
  match(
    sharedSettingsTypesSource,
    /generationHistoryMaxItems: number/,
    'shared general settings should type the generation history row limit',
  )
  match(
    backendSettingsDefaultsSource,
    /generationHistoryMaxItems: normalizeGenerationHistoryMaxItems\([\s\S]*?CONAI_GENERATION_RESULT_RETENTION_LIMIT/,
    'generation history retention should default from the normalized 10,000-item setting',
  )
  match(
    backendSettingsRoutesSource,
    /validateIntegerInRangeIfDefined\([\s\S]*?generalSettings\.generationHistoryMaxItems[\s\S]*?MIN_GENERATION_HISTORY_MAX_ITEMS[\s\S]*?MAX_GENERATION_HISTORY_MAX_ITEMS/,
    'general settings updates should validate the generation history row limit',
  )
  match(
    generalPreferencesSource,
    /생성 히스토리 최대 항목 수[\s\S]*?value=\{generalDraft\.generationHistoryMaxItems \?\? 10_000\}[\s\S]*?onPatchGeneral\(\{ generationHistoryMaxItems: parsedValue \}\)/,
    'safety and cleanup settings should expose the configurable generation history row limit',
  )
  match(
    backendSettingsDefaultsSource,
    /applyRatingSafetyToGenerationHistory: false/,
    'generation history rating safety should default off to preserve private-history behavior',
  )
  match(
    backendSettingsRoutesSource,
    /validateBooleanIfDefined\(res, generalSettings\.applyRatingSafetyToGenerationHistory, 'applyRatingSafetyToGenerationHistory must be a boolean'\)/,
    'general settings updates should reject non-boolean history rating-safety values',
  )
  match(
    runtimeMediaSettingsRoutesSource,
    /'\/generation-history'[\s\S]*?data: \{ applyRatingSafetyToGenerationHistory \}/,
    'runtime media settings should expose only the generation history rating-safety option',
  )
  match(
    registerAppRoutesSource,
    /RUNTIME_MEDIA_SETTINGS_READ_PERMISSION_KEYS\s*=\s*\[[\s\S]*?\.\.\.HOME_IMAGE_READ_PERMISSION_KEYS,[\s\S]*?'page\.generation\.view'/,
    'generation page readers should be allowed to load runtime media settings',
  )
  match(
    registerAppRoutesSource,
    /const allowRuntimeMediaSettingsRead: RequestHandler = \(req, res, next\) => \{[\s\S]*?req\.session\?\.authenticated === true[\s\S]*?allowReadAccess\(RUNTIME_MEDIA_SETTINGS_READ_PERMISSION_KEYS\)/,
    'authenticated public-workflow users should load the same runtime history and rating policy without a page permission dependency',
  )
  match(
    generalPreferencesSource,
    /checked=\{generalDraft\.applyRatingSafetyToGenerationHistory \?\? false\}[\s\S]*?onPatchGeneral\(\{ applyRatingSafetyToGenerationHistory: event\.target\.checked \}\)/,
    'safety settings should provide a default-off generation history toggle',
  )
  match(
    apiSettingsSource,
    /function getRuntimeGenerationHistorySettings\(\)[\s\S]*?'\/api\/runtime-media-settings\/generation-history'/,
    'frontend runtime settings should load the generation history safety option without settings-page access',
  )
  match(
    generationHistoryPanelSource,
    /enabled: !authStatusQuery\.isPending,[\s\S]*?const applyHistoryRatingSafety = historySafetySettingsQuery\.data\?\.applyRatingSafetyToGenerationHistory === true/,
    'private and public-workflow history should follow the same generation-history rating-safety option',
  )
  match(
    generationHistoryPanelSource,
    /isPublicView[\s\S]*?isAdmin \? 'public-workflow-all-users' : 'public-workflow-mine-only'/,
    'public workflow history cache scope should distinguish admin all-user history from account-owned history',
  )
  match(
    publicWorkflowRoutesSource,
    /router\.get\('\/:slug\/history'[\s\S]*?applyHistoryAccessScope\(req, historyFilters, false\)[\s\S]*?getHistoryByWorkflow\(workflow\.id, \{[\s\S]*?\.\.\.historyFilters/,
    'public workflow history should reuse the standard admin-all and non-admin-owned account scope',
  )
  match(
    publicWorkflowRoutesSource,
    /router\.post\('\/:slug\/cleanup-failed'[\s\S]*?applyHistoryAccessScope\(req, historyFilters, false\)[\s\S]*?HistoryQueryRepository\.findAll\(\{[\s\S]*?\.\.\.historyFilters/,
    'public workflow failed-history cleanup should match the same account scope as its list',
  )
  match(
    generationHistoryPanelSource,
    /visibleItems: visibleHistoryImages,[\s\S]*?hasMore: Boolean\(historyQuery\.hasNextPage\)[\s\S]*?onLoadMore: applyHistoryRatingSafety \? handleLoadMoreHistory : undefined[\s\S]*?visibilityMode: applyHistoryRatingSafety \? 'feed' : 'badge-only'/,
    'generation history safety should filter, blur, and continue paging through fully hidden batches',
  )
  match(
    generationHistoryPanelSource,
    /visibleCount: visibleHistoryImages\.length[\s\S]*?items=\{visibleHistoryImages\}/,
    'generation history progress and image rendering should use the safety-filtered items',
  )
  match(
    generationHistoryPanelSource,
    /hasOnlyHiddenItems && !historyQuery\.hasNextPage && !historyQuery\.isFetchingNextPage[\s\S]*?현재 등급 표시 설정으로 모든 생성 기록이 숨겨졌어/,
    'generation history should explain when every loaded page is hidden by rating safety',
  )
}

function assertHistoryVideoSourcePolicy() {
  const historyVideoUrl = '/api/generation-history/7/file?v=history-version'
  const historyPreviewUrl = getImageListPreviewUrl({
    id: 'generation-history-7',
    composite_hash: 'history-video-hash',
    image_url: historyVideoUrl,
    mime_type: 'video/mp4',
  })
  const galleryPreviewUrl = getImageListPreviewUrl({
    id: 8,
    composite_hash: 'gallery-video-hash',
    image_url: '/custom/video-source',
    mime_type: 'video/mp4',
  })

  assertEqual(
    historyPreviewUrl,
    historyVideoUrl,
    'generation history videos should keep the authorized history media route instead of switching to gallery safety',
  )
  assertEqual(
    galleryPreviewUrl,
    '/api/images/gallery-video-hash/file',
    'ordinary gallery videos should keep using the canonical hash streaming route',
  )

  const historyDetailSource = {
    detail_url: '/api/generation-history/7/image',
    detail_scope_key: 'generation-history:7',
  }
  assertEqual(
    getImageDetailRequestUrl('history-video-hash', historyDetailSource),
    historyDetailSource.detail_url,
    'history modal detail should use its authorized history endpoint',
  )
  assertEqual(
    getImageDetailQueryKey('history-video-hash', historyDetailSource).join('|'),
    'image-detail|history-video-hash|generation-history:7',
    'history and gallery detail caches should not share a query key',
  )
  assertEqual(
    getImageDetailQueryKey('history-video-hash').join('|'),
    'image-detail|history-video-hash|gallery',
    'ordinary gallery detail should retain its own cache scope',
  )
}

function assertHistoryScopedDetailSourcePolicy() {
  match(
    generationHistoryPanelHelpersSource,
    /detail_url: hasLinkedImage \? `\$\{historyMediaBaseUrl\}\/image` : null[\s\S]*?detail_scope_key: `generation-history:\$\{record\.id\}`[\s\S]*?generation_history_id: record\.id/,
    'history cards should carry their scoped detail and download identity',
  )
  match(
    generationHistoryRoutesSource,
    /'\/:id\/image'[\s\S]*?handleHistoryImageDetail/,
    'generation history should expose a scoped image-detail endpoint before the compatibility id route',
  )
  match(
    generationHistoryMediaHandlersSource,
    /findByHashWithFile\(media\.compositeHash, \{ includeHidden: true \}\)[\s\S]*?detail_scope_key:[\s\S]*?thumbnail_url:[\s\S]*?image_url:/,
    'authorized history detail should include hidden media while returning only history-scoped URLs',
  )
  match(
    mediaMetadataFileQueriesSource,
    /findByHashWithFile\(compositeHash: string, options: \{ includeHidden\?: boolean \} = \{\}\)[\s\S]*?options\.includeHidden \? '1=1' : getVisibleMediaMetadataCondition\(\)/,
    'single-image metadata lookup should bypass rating visibility only when an authorized caller opts in',
  )
  match(
    imageListSource,
    /getImageDetailQueryKey\(compositeHash, image\)[\s\S]*?getImage\(compositeHash, \{ signal \}, image\)/,
    'history hover prefetch should retain the item detail scope',
  )
  match(
    imageModalProviderSource,
    /getImageDetailQueryKey\(neighborHash, neighborImage\)[\s\S]*?getImage\(neighborHash, undefined, neighborImage\)[\s\S]*?getImageDetailQueryKey\(input\.compositeHash, activeInputImage\)/,
    'modal active and neighbor prefetches should retain each source item scope',
  )
  match(
    imageDetailViewSource,
    /const imageDetailSource = useMemo\([\s\S]*?detail_url: detailUrl, detail_scope_key: detailScopeKey[\s\S]*?getImageDetailQueryKey\(compositeHash, imageDetailSource\)[\s\S]*?queryKey: imageDetailQueryKey[\s\S]*?getImage\(compositeHash, \{ signal \}, imageDetailSource\)/,
    'the visible modal detail query should stay in the same authorized scope as its initial history item',
  )
  match(
    imageDetailUtilsSource,
    /if \(image\.generation_history_id\) \{[\s\S]*?return image\.image_url \|\| image\.thumbnail_url \|\| null[\s\S]*?buildImageDownloadUrl/,
    'history detail controls should not construct a gallery-only download URL',
  )
  match(
    generationHistoryPanelSource,
    /modalAccessOptions=\{\{[\s\S]*?allowDetailNavigation: false[\s\S]*?allowEditAction: !isPublicView/,
    'history modals should not navigate hidden results into the gallery-only detail route',
  )
  match(
    imageDownloadTriggerSource,
    /generation_history_id[\s\S]*?downloadGenerationHistorySelection\(\[generationHistoryId\], type\)[\s\S]*?downloadImageSelection\(\[compositeHash\], type\)/,
    'history modal downloads should keep the authorized history scope while gallery downloads stay unchanged',
  )
}

function assertHistoryTranslationCatalogSourcePolicy() {
  match(
    lazyRoutesSource,
    /'image-generation-page': \(\) => loadRouteModuleWithCatalog\([\s\S]*?imageGenerationCatalog[\s\S]*?moduleGraphCatalog[\s\S]*?imagesCatalog[\s\S]*?\n {2}\),/,
    'private generation history should preload the shared images catalog used by image-list fallback states',
  )
  match(
    lazyRoutesSource,
    /'public-comfy-workflow-page': \(\) => loadRouteModuleWithCatalog\([\s\S]*?imageGenerationCatalog[\s\S]*?imagesCatalog[\s\S]*?\n {2}\),/,
    'public workflow history should preload the shared images catalog used by image-list fallback states',
  )
}

assertEmptySummary()
assertPagedSummary()
assertFilteredSummary()
assertTotalNeverFallsBelowLoaded()
assertCountNormalization()
assertStatusSummarySourcePolicy()
assertRefreshPolicySource()
assertHistoryListLookupCostPolicy()
assertHistoryFirstPageRefreshPolicy()
assertImageListCallbackSourcePolicy()
assertDownloadReadinessSourcePolicy()
assertSelectionRecoverySourcePolicy()
assertNoImageBadgeOverlaySourcePolicy()
assertHistoryRatingSafetySettingSourcePolicy()
assertHistoryVideoSourcePolicy()
assertHistoryScopedDetailSourcePolicy()
assertHistoryTranslationCatalogSourcePolicy()

reportVerificationSuccess('Generation history feed progress UI contracts verified.')

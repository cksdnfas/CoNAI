import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import type { ImageRecord } from '@/types/image'
import { getRuntimeGenerationHistorySettings } from '@/lib/api-settings'
import {
  getGenerationHistory,
  getGenerationWorkflowHistory,
} from '@/lib/api-image-generation-history'
import { getPublicGenerationWorkflowHistory } from '@/lib/api-public-workflows'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'
import { countStateFromQuery, formatCountDisplay } from '@/lib/count-display'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'
import {
  GENERATION_HISTORY_ACTIVE_REFRESH_MS,
  GENERATION_HISTORY_PAGE_SIZE,
  GENERATION_HISTORY_POSTPROCESS_REFRESH_MS,
  GENERATION_HISTORY_RECOVERY_ACK_STORAGE_PREFIX,
  GENERATION_HISTORY_REFRESH_WATCH_MS,
  GENERATION_HISTORY_STREAM_WATCHDOG_REFRESH_MS,
  collectRetryableHistoryRecords,
  dedupeHistoryRecords,
  getGenerationHistorySelectionId,
  getHistoryRecordStatusSummary,
  hasActiveGenerationHistory,
  hasPostprocessPendingHistory,
  hasStableHistoryPageBoundary,
  isHistoryRecordDownloadReady,
  mapHistoryRecordToImageRecord,
  readCachedHistoryPage,
} from './generation-history-panel-helpers'
import { GenerationHistoryHeader } from './generation-history-header'
import { GenerationHistoryRecoveryPanel } from './generation-history-recovery-panel'
import { useGenerationHistoryActions, useHistoryRecoveryAcknowledgement } from './use-generation-history-actions'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'

type GenerationHistoryPanelProps = {
  refreshNonce: number
  serviceType: GenerationServiceType
  workflowId?: number | null
  publicWorkflowSlug?: string | null
  splitPaneScroll?: boolean
  onBack?: () => void
}

/** Render generation history using the shared image-list surface instead of per-record cards. */
export function GenerationHistoryPanel({ refreshNonce, serviceType, workflowId, publicWorkflowSlug, splitPaneScroll = false, onBack }: GenerationHistoryPanelProps) {
  const { t, formatNumber } = useI18n()
  const queryClient = useQueryClient()
  const authStatusQuery = useAuthStatusQuery()
  // SSE 가 살아 있으면 폴링을 끄고, 끊기면 아래 기존 refresh cadence 가 그대로 되살아난다.
  const { status: runtimeStreamStatus } = useRuntimeEventStream()
  const {
    columnCount: historyColumnCount,
    setColumnCount: setHistoryColumnCount,
    resetColumnCount: resetHistoryColumnCount,
    defaultColumnCount: defaultHistoryColumnCount,
    minColumnCount: minHistoryColumnCount,
    maxColumnCount: maxHistoryColumnCount,
  } = useImageListColumnPreference('history')
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([])
  const [historyRefreshWatchUntil, setHistoryRefreshWatchUntil] = useState(0)
  const isAdmin = authStatusQuery.data?.isAdmin === true
  const requesterAccountId = authStatusQuery.data?.accountId ?? null
  const requesterAccountType = authStatusQuery.data?.accountType ?? null
  const isPublicView = Boolean(publicWorkflowSlug)
  const historyScope = isPublicView
    ? (isAdmin ? 'public-workflow-all-users' : 'public-workflow-mine-only')
    : (isAdmin ? 'all-users' : 'mine-only')
  const historyQueryKey = useMemo(() => [
    'image-generation-history',
    serviceType,
    workflowId ?? null,
    publicWorkflowSlug ?? null,
    historyScope,
    requesterAccountId,
    requesterAccountType,
  ] as const, [historyScope, publicWorkflowSlug, requesterAccountId, requesterAccountType, serviceType, workflowId])
  const recoveryAckStorageKey = useMemo(
    () => `${GENERATION_HISTORY_RECOVERY_ACK_STORAGE_PREFIX}${historyQueryKey.join(':')}`,
    [historyQueryKey],
  )
  const { acknowledgedRecoveryIds, acknowledgeRecoveryRecords } = useHistoryRecoveryAcknowledgement(recoveryAckStorageKey)
  // QLIST-4: 사용자가 명시적으로 요청한 새로고침만 로드된 전 페이지를 다시 읽는다.
  const isFullHistoryRefreshRef = useRef(false)
  // 첫 페이지 경계가 밀린 리프레시는(신규 행 유입) 뒤 페이지 캐시를 재사용할 수 없다.
  const hasHistoryPageBoundaryShiftRef = useRef(false)
  const fetchHistoryPage = useCallback((offset: number) => (
    isPublicView && publicWorkflowSlug
      ? getPublicGenerationWorkflowHistory(publicWorkflowSlug, {
          limit: GENERATION_HISTORY_PAGE_SIZE,
          offset,
        })
      : serviceType === 'comfyui' && workflowId
        ? getGenerationWorkflowHistory(workflowId, {
            limit: GENERATION_HISTORY_PAGE_SIZE,
            offset,
            ...(isAdmin ? {} : { mine: true }),
          })
        : getGenerationHistory(serviceType, {
            limit: GENERATION_HISTORY_PAGE_SIZE,
            offset,
            ...(isAdmin ? {} : { mine: true }),
          })
  ), [isAdmin, isPublicView, publicWorkflowSlug, serviceType, workflowId])
  const historyQuery = useInfiniteQuery({
    queryKey: historyQueryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      // 활성 리프레시(폴링/SSE 무효화)는 첫 페이지만 서버에서 다시 읽고, 뒤 페이지는 캐시 사본을 그대로 쓴다.
      // 종전에는 로드된 페이지 수만큼 무거운 히스토리 쿼리가 매 리프레시마다 반복됐다.
      if (pageParam > 0 && !isFullHistoryRefreshRef.current && !hasHistoryPageBoundaryShiftRef.current) {
        const cachedPage = readCachedHistoryPage(queryClient, historyQueryKey, pageParam)
        if (cachedPage) {
          return cachedPage
        }
      }

      const previousFirstPage = pageParam === 0 ? readCachedHistoryPage(queryClient, historyQueryKey, 0) : undefined
      const page = await fetchHistoryPage(pageParam)
      if (pageParam === 0) {
        hasHistoryPageBoundaryShiftRef.current = !hasStableHistoryPageBoundary(previousFirstPage, page)
      }

      return page
    },
    enabled: !authStatusQuery.isPending,
    // Keep every loaded page: the active-generation refetch has to restart at offset 0 so newly
    // completed generations appear, and selection/visible-count state is derived from all pages.
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = lastPageParam + lastPage.records.length
      return nextOffset < lastPage.total ? nextOffset : undefined
    },
    refetchInterval: (query) => {
      const pages = query.state.data?.pages ?? []
      const records = pages.flatMap((page) => page.records)
      // 기존 cadence 로직은 그대로 두고 스트림 상태로만 감싼다(폴백 보존).
      const resolveLegacyHistoryInterval = (): number | false => {
        if (hasActiveGenerationHistory(records)) {
          return GENERATION_HISTORY_ACTIVE_REFRESH_MS
        }

        if (historyRefreshWatchUntil > Date.now()) {
          return GENERATION_HISTORY_ACTIVE_REFRESH_MS
        }

        return hasPostprocessPendingHistory(records) ? GENERATION_HISTORY_POSTPROCESS_REFRESH_MS : false
      }

      const legacyInterval = resolveLegacyHistoryInterval()
      const streamInterval = resolveStreamFallbackInterval(runtimeStreamStatus, legacyInterval)
      // 스트림이 live 라도 진행 중/후처리 대기 행이 남아 있으면 느린 워치독 폴링을 유지한다.
      // 완료/ready 이벤트가 유실되면 live 상태에서는 다른 복구 경로가 없어
      // 행이 '생성 중' 에 영구 고정된다. 유휴 목록(대기 행 없음)은 종전대로 폴링 0 이다.
      if (streamInterval === false && legacyInterval !== false) {
        return GENERATION_HISTORY_STREAM_WATCHDOG_REFRESH_MS
      }

      return streamInterval
    },
  })
  const historySafetySettingsQuery = useQuery({
    queryKey: ['runtime-generation-history-settings'],
    queryFn: getRuntimeGenerationHistorySettings,
    enabled: !authStatusQuery.isPending,
    staleTime: 60_000,
  })
  const refetchHistory = historyQuery.refetch
  const refreshHistory = useCallback(async (options: { watchForNewRows?: boolean } = {}) => {
    if (options.watchForNewRows) {
      setHistoryRefreshWatchUntil(Date.now() + GENERATION_HISTORY_REFRESH_WATCH_MS)
    }

    // 명시적 새로고침(버튼/삭제/재실행/부모 nonce)만 전 페이지를 다시 읽는다.
    isFullHistoryRefreshRef.current = true
    try {
      await refetchHistory()
    } finally {
      isFullHistoryRefreshRef.current = false
    }
  }, [refetchHistory])
  const isFetchingHistory = historyQuery.isFetching
  useEffect(() => {
    if (!isFetchingHistory) {
      // 경계 밀림으로 강제된 전 페이지 재조회가 끝났으면 다음 리프레시는 다시 첫 페이지만 읽는다.
      hasHistoryPageBoundaryShiftRef.current = false
    }
  }, [isFetchingHistory])


  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void refreshHistory({ watchForNewRows: true })
  }, [refreshNonce, refreshHistory])

  const isHistoryLoading = authStatusQuery.isPending || historyQuery.isPending
  const historyRecords = useMemo(
    () => dedupeHistoryRecords((historyQuery.data?.pages ?? []).flatMap((page) => page.records)),
    [historyQuery.data?.pages],
  )
  const {
    inFlight: inFlightHistoryCount,
    cleanupFailed: cleanupFailedHistoryCount,
  } = useMemo(() => getHistoryRecordStatusSummary(historyRecords), [historyRecords])
  const retryableHistoryRecords = useMemo(() => {
    return collectRetryableHistoryRecords(historyRecords)
  }, [historyRecords])
  const visibleRetryableHistoryRecords = useMemo(
    () => retryableHistoryRecords.filter((record) => !acknowledgedRecoveryIds.has(record.id)).slice(0, 4),
    [acknowledgedRecoveryIds, retryableHistoryRecords],
  )
  const historyImages = useMemo(() => historyRecords.map((record) => mapHistoryRecordToImageRecord(record)), [historyRecords])
  const historyTotalCount = historyQuery.data?.pages[0]?.total
  const applyHistoryRatingSafety = historySafetySettingsQuery.data?.applyRatingSafetyToGenerationHistory === true
  const fetchNextHistoryPage = historyQuery.fetchNextPage
  const handleLoadMoreHistory = useCallback(() => {
    return fetchNextHistoryPage()
  }, [fetchNextHistoryPage])
  const {
    visibleItems: visibleHistoryImages,
    hasOnlyHiddenItems,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: historyImages,
    enabled: applyHistoryRatingSafety && historyImages.length > 0,
    hasMore: Boolean(historyQuery.hasNextPage),
    isLoading: isHistoryLoading,
    isError: historyQuery.isError,
    isLoadingMore: historyQuery.isFetchingNextPage,
    onLoadMore: applyHistoryRatingSafety ? handleLoadMoreHistory : undefined,
    visibilityMode: applyHistoryRatingSafety ? 'feed' : 'badge-only',
  })
  // 사용자에게 보이는 숫자는 서버 total 만 쓴다. 로드된 페이지 기준 집계는 합계처럼 보여 주지 않는다.
  const historyTotalLabel = formatCountDisplay(
    countStateFromQuery({ total: historyTotalCount, isError: historyQuery.isError }),
    { t, formatNumber },
  ).text
  const hasHiddenHistoryItems = visibleHistoryImages.length < historyImages.length
  const visibleHistoryRecordIds = useMemo(
    () => new Set(visibleHistoryImages.map((image) => String(image.id))),
    [visibleHistoryImages],
  )
  const historyRecordMap = useMemo(
    () => new Map(historyRecords.map((record) => [getGenerationHistorySelectionId(record), record])),
    [historyRecords],
  )
  const selectedHistoryRecords = useMemo(
    () => selectedHistoryIds.map((id) => historyRecordMap.get(id)).filter((record): record is NonNullable<typeof record> => Boolean(record)),
    [historyRecordMap, selectedHistoryIds],
  )
  const selectedRetryableHistoryRecords = useMemo(
    () => collectRetryableHistoryRecords(selectedHistoryRecords),
    [selectedHistoryRecords],
  )
  const downloadableHistoryRecords = useMemo(
    () => selectedHistoryRecords
      .filter(isHistoryRecordDownloadReady),
    [selectedHistoryRecords],
  )
  const downloadableHistoryIds = useMemo(
    () => downloadableHistoryRecords.map((record) => record.id),
    [downloadableHistoryRecords],
  )
  const selectionStatusText = useMemo(() => {
    if (downloadableHistoryIds.length > 0 && selectedRetryableHistoryRecords.length > 0) {
      return t(
        { ko: '다운로드 {downloadable} · 재실행 {retryable}', en: '{downloadable} downloadable · {retryable} rerunnable' },
        { downloadable: formatNumber(downloadableHistoryIds.length), retryable: formatNumber(selectedRetryableHistoryRecords.length) },
      )
    }

    if (downloadableHistoryIds.length > 0) {
      return t('image-generation.components.generation.history.panel.valuedownloadable', { count: formatNumber(downloadableHistoryIds.length) })
    }

    if (selectedRetryableHistoryRecords.length > 0) {
      return t(
        { ko: '재실행 가능 {count}', en: '{count} rerunnable' },
        { count: formatNumber(selectedRetryableHistoryRecords.length) },
      )
    }

    return t('image-generation.components.generation.history.panel.no.downloadable.results')
  }, [downloadableHistoryIds.length, formatNumber, selectedRetryableHistoryRecords.length, t])
  const historyLabel = isPublicView
    ? 'Public Workflow'
    : serviceType === 'novelai'
      ? 'NAI'
      : serviceType === 'codex'
        ? 'Codex'
        : workflowId
          ? 'ComfyUI Workflow'
          : 'ComfyUI'
  const getHistoryImageHref = useCallback((image: ImageRecord) => {
    const record = historyRecordMap.get(String(image?.id ?? ''))
    if (!record || !isHistoryRecordDownloadReady(record) || !image?.composite_hash) {
      return undefined
    }

    return `/images/${image.composite_hash}`
  }, [historyRecordMap])
  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => historyRecordMap.has(id) && visibleHistoryRecordIds.has(id)))
  }, [historyRecordMap, visibleHistoryRecordIds])

  const getHistoryItemId = useCallback((image: ImageRecord) => String(image.id), [])
  const handleClearSelectedHistory = useCallback(() => {
    setSelectedHistoryIds([])
  }, [])

  const {
    isDeletingSelection,
    isDownloadingSelection,
    isCleaningFailed,
    isClearingHistory,
    retryingQueueJobIds,
    isRetryingRunRecovery,
    handleDeleteSelected,
    handleCleanupFailed,
    handleClearHistory,
    handleAcknowledgeRunRecovery,
    handleRetryHistoryRecord,
    handleRetryVisibleRecoveryRecords,
    handleRetrySelectedHistoryRecords,
    handleDownloadSelected,
  } = useGenerationHistoryActions({
    serviceType,
    workflowId,
    publicWorkflowSlug,
    isAdmin,
    isPublicView,
    refreshHistory,
    setSelectedHistoryIds,
    selectedHistoryRecords,
    selectedRetryableHistoryRecords,
    visibleRetryableHistoryRecords,
    downloadableHistoryRecords,
    downloadableHistoryIds,
    acknowledgeRecoveryRecords,
  })

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-4 overflow-hidden' : 'space-y-4')}>
      <GenerationHistoryHeader
        onBack={onBack}
        historyLabel={historyLabel}
        isPublicView={isPublicView}
        isAdmin={isAdmin}
        historyTotalLabel={historyTotalLabel}
        hasHiddenHistoryItems={hasHiddenHistoryItems}
        isRefreshing={historyQuery.isRefetching && !historyQuery.isFetchingNextPage}
        isFetching={historyQuery.isFetching}
        inFlightHistoryCount={inFlightHistoryCount}
        historyRecordCount={historyRecords.length}
        cleanupFailedHistoryCount={cleanupFailedHistoryCount}
        isClearingHistory={isClearingHistory}
        isCleaningFailed={isCleaningFailed}
        handleClearHistory={handleClearHistory}
        handleCleanupFailed={handleCleanupFailed}
        refreshHistory={refreshHistory}
      />

      {historyQuery.isError ? (
        <ErrorState
          title={t('image-generation.components.generation.history.panel.could.not.load.history')}
          description={getErrorMessage(historyQuery.error, t('image-generation.components.generation.history.panel.failed.to.fetch.generation.history'))}
        />
      ) : null}

      {isHistoryLoading ? <LoadingState variant="inline" label={t('image-generation.components.generation.history.panel.loading.history')} /> : null}

      {!isHistoryLoading && visibleRetryableHistoryRecords.length > 0 ? (
        <GenerationHistoryRecoveryPanel
          visibleRetryableHistoryRecords={visibleRetryableHistoryRecords}
          retryingQueueJobIds={retryingQueueJobIds}
          isRetryingRunRecovery={isRetryingRunRecovery}
          handleRetryVisibleRecoveryRecords={handleRetryVisibleRecoveryRecords}
          handleAcknowledgeRunRecovery={handleAcknowledgeRunRecovery}
          handleRetryHistoryRecord={handleRetryHistoryRecord}
        />
      ) : null}

      <div className={cn(splitPaneScroll && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        {!isHistoryLoading && historyImages.length === 0 ? (
          <EmptyState title={t('image-generation.components.generation.history.panel.no.generation.results.to.display.yet')} />
        ) : null}

        {!isHistoryLoading && historyImages.length > 0 ? (
          <>
            {visibleHistoryImages.length > 0 ? (
              <ImageList
                items={visibleHistoryImages}
                layout="masonry"
                activationMode="modal"
                getItemHref={getHistoryImageHref}
                getItemId={getHistoryItemId}
                selectable
                modalAccessOptions={{
                  allowDetailNavigation: false,
                  allowEditAction: !isPublicView,
                  allowGroupAssignAction: !isPublicView,
                  allowHistoryReuseActions: !isPublicView,
                }}
                selectedIds={selectedHistoryIds}
                onSelectedIdsChange={setSelectedHistoryIds}
                minColumnWidth={220}
                preferredColumnCount={historyColumnCount}
                columnGap={splitPaneScroll ? 12 : 16}
                rowGap={splitPaneScroll ? 12 : 16}
                className={cn(splitPaneScroll && 'min-h-0 flex-1 overflow-hidden pr-3 pb-1')}
                scrollMode={splitPaneScroll ? 'container' : 'window'}
                hasMore={Boolean(historyQuery.hasNextPage)}
                isLoadingMore={historyQuery.isFetchingNextPage}
                onLoadMore={handleLoadMoreHistory}
                shouldBlurItemPreview={shouldBlurItemPreview}
              />
            ) : null}

            {hasOnlyHiddenItems && !historyQuery.hasNextPage && !historyQuery.isFetchingNextPage ? (
              <EmptyState size="compact" title={t({ ko: '현재 등급 표시 설정으로 모든 생성 기록이 숨겨졌어.', en: 'All generation history is hidden by the current rating visibility settings.' })} />
            ) : null}

            <div className="flex shrink-0 flex-col items-center gap-3 pb-2">
              {historyQuery.isFetchingNextPage ? (
                <LoadingState variant="inline" className="text-xs" label={t({ ko: '기록 더 불러오는 중…', en: 'Loading more history…' })} />
              ) : null}

              {Boolean(historyQuery.hasNextPage) && !historyQuery.isFetchingNextPage && !historyQuery.isFetchNextPageError ? (
                <Button size="sm" variant="secondary" onClick={handleLoadMoreHistory}>
                  {t({ ko: '더 보기', en: 'Load more' })}
                </Button>
              ) : null}

              {historyQuery.isFetchNextPageError ? (
                <Button size="sm" variant="secondary" onClick={handleLoadMoreHistory}>
                  {t({ ko: '다음 기록 다시 시도', en: 'Retry next history batch' })}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {visibleHistoryImages.length > 0 ? (
        <ImageListColumnFloatingControl
          value={historyColumnCount}
          defaultValue={defaultHistoryColumnCount}
          min={minHistoryColumnCount}
          max={maxHistoryColumnCount}
          title={t('image-generation.components.generation.history.panel.history.cards.per.row')}
          onChange={setHistoryColumnCount}
          onReset={resetHistoryColumnCount}
        />
      ) : null}

      <ImageSelectionBar
        selectedCount={selectedHistoryRecords.length}
        downloadableCount={downloadableHistoryIds.length}
        isDownloading={isDownloadingSelection}
        statusText={selectionStatusText}
        trailingActions={(
          <>
            {selectedRetryableHistoryRecords.length > 0 ? (
              <IconButton
                size="icon-sm"
                variant="secondary"
                onClick={() => void handleRetrySelectedHistoryRecords()}
                disabled={isRetryingRunRecovery}
                label={isRetryingRunRecovery ? t({ ko: '재실행 등록 중', en: 'Queueing rerun' }) : t({ ko: '선택 재실행', en: 'Rerun selected' })}
                data-no-select-drag="true"
              >
                <RotateCcw className={cn(isRetryingRunRecovery && 'animate-spin')} />
              </IconButton>
            ) : null}

            {!isPublicView && isAdmin ? (
              <IconButton
                size="icon-sm"
                variant="destructive"
                onClick={handleDeleteSelected}
                disabled={selectedHistoryRecords.length === 0 || isDeletingSelection}
                label={isDeletingSelection ? t('image-generation.components.generation.history.panel.deleting') : t('image-generation.components.generation.history.panel.delete.selection')}
                data-no-select-drag="true"
              >
                <Trash2 />
              </IconButton>
            ) : null}
          </>
        )}
        onDownloadSelect={handleDownloadSelected}
        onClear={handleClearSelectedHistory}
      />
    </section>
  )
}
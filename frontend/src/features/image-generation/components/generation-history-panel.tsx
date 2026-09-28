import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import type { ImageRecord } from '@/types/image'
import { getRuntimeGenerationHistorySettings } from '@/lib/api-settings'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'
import { countStateFromQuery, formatCountDisplay } from '@/lib/count-display'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'
import {
  GENERATION_HISTORY_RECOVERY_ACK_STORAGE_PREFIX,
  collectRetryableHistoryRecords,
  getGenerationHistorySelectionId,
  getHistoryRecordStatusSummary,
  isHistoryRecordDownloadReady,
  mapHistoryRecordToImageRecord,
} from './generation-history-panel-helpers'
import { GenerationHistoryHeader } from './generation-history-header'
import { GenerationHistoryRecoveryPanel } from './generation-history-recovery-panel'
import { useGenerationHistoryActions, useHistoryRecoveryAcknowledgement } from './use-generation-history-actions'
import { useGenerationHistoryFeed, type GenerationHistoryFeed } from './use-generation-history-feed'
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
export function GenerationHistoryPanel({ refreshNonce, serviceType, workflowId, publicWorkflowSlug, ...viewProps }: GenerationHistoryPanelProps) {
  const feed = useGenerationHistoryFeed({ refreshNonce, serviceType, workflowId, publicWorkflowSlug })
  return <GenerationHistoryPanelView feed={feed} serviceType={serviceType} workflowId={workflowId} publicWorkflowSlug={publicWorkflowSlug} {...viewProps} />
}

type GenerationHistoryPanelViewProps = Omit<GenerationHistoryPanelProps, 'refreshNonce'> & {
  feed: GenerationHistoryFeed
  /** Replaces the heading and scope line (e.g. the result/history toggle); the scope actions stay. */
  headerLeading?: ReactNode
}

/** History list body for a feed owned by the caller (the result area shares one feed with the stage). */
export function GenerationHistoryPanelView({ feed, serviceType, workflowId, publicWorkflowSlug, splitPaneScroll = false, onBack, headerLeading }: GenerationHistoryPanelViewProps) {
  const { t, formatNumber } = useI18n()
  const {
    columnCount: historyColumnCount,
    setColumnCount: setHistoryColumnCount,
    resetColumnCount: resetHistoryColumnCount,
    defaultColumnCount: defaultHistoryColumnCount,
    minColumnCount: minHistoryColumnCount,
    maxColumnCount: maxHistoryColumnCount,
  } = useImageListColumnPreference('history')
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([])
  const { authStatusQuery, historyQuery, historyQueryKey, historyRecords, refreshHistory, isAdmin, isPublicView, isHistoryLoading } = feed
  const recoveryAckStorageKey = useMemo(
    () => `${GENERATION_HISTORY_RECOVERY_ACK_STORAGE_PREFIX}${historyQueryKey.join(':')}`,
    [historyQueryKey],
  )
  const { acknowledgedRecoveryIds, acknowledgeRecoveryRecords } = useHistoryRecoveryAcknowledgement(recoveryAckStorageKey)
  const historySafetySettingsQuery = useQuery({
    queryKey: ['runtime-generation-history-settings'],
    queryFn: getRuntimeGenerationHistorySettings,
    enabled: !authStatusQuery.isPending,
    staleTime: 60_000,
  })
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
        leading={headerLeading}
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
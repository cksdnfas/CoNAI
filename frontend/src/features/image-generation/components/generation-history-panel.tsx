import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { PageInset } from '@/components/common/page-surface'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import type { ImageRecord } from '@/types/image'
import {
  cleanupFailedGenerationHistory,
  deleteGenerationHistoryRecord,
  downloadGenerationHistorySelection,
  getGenerationHistory,
  getGenerationWorkflowHistory,
} from '@/lib/api-image-generation-history'
import { cleanupPublicGenerationWorkflowFailedHistory, getPublicGenerationWorkflowHistory } from '@/lib/api-public-workflows'
import type { GenerationHistoryResponse } from '@/lib/api-image-generation-history'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import {
  getErrorMessage,
  getHistoryCancellationBadgeLabel,
  getHistoryCancellationDetail,
  getHistoryStatusLabel,
  resolveHistoryDisplayStatus,
  resolveHistoryImageSource,
} from '../image-generation-shared'
import { getGenerationHistoryFeedProgressSummary } from '../generation-history-feed-progress'

type GenerationHistoryPanelProps = {
  refreshNonce: number
  serviceType: GenerationServiceType
  workflowId?: number | null
  publicWorkflowSlug?: string | null
  splitPaneScroll?: boolean
  onBack?: () => void
}

const GENERATION_HISTORY_PAGE_SIZE = 40
const GENERATION_HISTORY_ACTIVE_REFRESH_MS = 1_500
const GENERATION_HISTORY_POSTPROCESS_REFRESH_MS = 5_000
const GENERATION_HISTORY_REFRESH_WATCH_MS = 30_000

function hasActiveGenerationHistory(records: GenerationHistoryResponse['records']) {
  return records.some((record) => {
    return record.generation_status === 'pending'
      || record.generation_status === 'processing'
      || record.queue_status === 'queued'
      || record.queue_status === 'dispatching'
      || record.queue_status === 'running'
  })
}

function hasPostprocessPendingHistory(records: GenerationHistoryResponse['records']) {
  return records.some((record) => (
    record.generation_status === 'completed'
    && Boolean(record.composite_hash)
    && !record.actual_composite_hash
  ))
}

function getGenerationHistorySelectionId(record: GenerationHistoryResponse['records'][number]) {
  return `generation-history-${record.id}`
}

function dedupeHistoryRecords(records: GenerationHistoryResponse['records']) {
  const seenIds = new Set<number>()
  return records.filter((record) => {
    if (seenIds.has(record.id)) {
      return false
    }

    seenIds.add(record.id)
    return true
  })
}

type HistoryRecordStatusSummary = {
  inFlight: number
  completed: number
  failed: number
  cancellation: number
}

function getHistoryRecordStatusSummary(records: GenerationHistoryResponse['records']): HistoryRecordStatusSummary {
  const summary: HistoryRecordStatusSummary = {
    inFlight: 0,
    completed: 0,
    failed: 0,
    cancellation: 0,
  }

  for (const record of records) {
    const displayStatus = resolveHistoryDisplayStatus(record)

    if (displayStatus === 'pending' || displayStatus === 'processing') {
      summary.inFlight += 1
    } else if (displayStatus === 'completed') {
      summary.completed += 1
    } else if (displayStatus === 'failed') {
      summary.failed += 1
    }

    if ((record.queue_cancel_requested ?? 0) > 0) {
      summary.cancellation += 1
    }
  }

  return summary
}

function getHistoryMediaVersion(record: GenerationHistoryResponse['records'][number]) {
  return [
    record.actual_composite_hash ?? record.composite_hash ?? '',
    record.actual_width ?? record.width ?? '',
    record.actual_height ?? record.height ?? '',
    resolveHistoryDisplayStatus(record),
  ].join(':')
}

function mapHistoryRecordToImageRecord(record: GenerationHistoryResponse['records'][number]): ImageRecord {
  const imageSource = resolveHistoryImageSource(record)
  const displayStatus = resolveHistoryDisplayStatus(record)
  const hasLinkedImage = Boolean(record.actual_composite_hash)
  const historyMediaBaseUrl = `/api/generation-history/${record.id}`
  const historyMediaVersion = encodeURIComponent(getHistoryMediaVersion(record))

  return {
    id: `generation-history-${record.id}`,
    composite_hash: hasLinkedImage ? imageSource.compositeHash : null,
    original_file_path: null,
    thumbnail_url: hasLinkedImage ? `${historyMediaBaseUrl}/thumbnail?v=${historyMediaVersion}` : null,
    image_url: hasLinkedImage ? `${historyMediaBaseUrl}/file?v=${historyMediaVersion}` : null,
    mime_type: record.actual_mime_type ?? null,
    width: record.actual_width ?? null,
    height: record.actual_height ?? null,
    rating_score: record.rating_score ?? null,
    is_processing: displayStatus === 'pending' || displayStatus === 'processing',
    preview_status: displayStatus === 'failed'
      ? 'failed'
      : displayStatus === 'pending' || displayStatus === 'processing'
        ? 'processing'
        : undefined,
  }
}

function isHistoryRecordDownloadReady(record: GenerationHistoryResponse['records'][number]) {
  return resolveHistoryDisplayStatus(record) === 'completed' && Boolean(record.actual_composite_hash)
}

/** Render generation history using the shared image-list surface instead of per-record cards. */
export function GenerationHistoryPanel({ refreshNonce, serviceType, workflowId, publicWorkflowSlug, splitPaneScroll = false, onBack }: GenerationHistoryPanelProps) {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const {
    columnCount: historyColumnCount,
    setColumnCount: setHistoryColumnCount,
    resetColumnCount: resetHistoryColumnCount,
    defaultColumnCount: defaultHistoryColumnCount,
    minColumnCount: minHistoryColumnCount,
    maxColumnCount: maxHistoryColumnCount,
  } = useImageListColumnPreference('history')
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([])
  const [isDeletingSelection, setIsDeletingSelection] = useState(false)
  const [isDownloadingSelection, setIsDownloadingSelection] = useState(false)
  const [isCleaningFailed, setIsCleaningFailed] = useState(false)
  const [historyRefreshWatchUntil, setHistoryRefreshWatchUntil] = useState(0)
  const isAdmin = authStatusQuery.data?.isAdmin === true
  const requesterAccountId = authStatusQuery.data?.accountId ?? null
  const requesterAccountType = authStatusQuery.data?.accountType ?? null
  const isPublicView = Boolean(publicWorkflowSlug)
  const historyScope = isPublicView ? 'public-workflow' : (isAdmin ? 'all-users' : 'mine-only')
  const historyQueryKey = useMemo(() => [
    'image-generation-history',
    serviceType,
    workflowId ?? null,
    publicWorkflowSlug ?? null,
    historyScope,
    requesterAccountId,
    requesterAccountType,
  ] as const, [historyScope, publicWorkflowSlug, requesterAccountId, requesterAccountType, serviceType, workflowId])
  const historyQuery = useInfiniteQuery({
    queryKey: historyQueryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => (
      isPublicView && publicWorkflowSlug
        ? getPublicGenerationWorkflowHistory(publicWorkflowSlug, {
            limit: GENERATION_HISTORY_PAGE_SIZE,
            offset: pageParam,
          })
        : serviceType === 'comfyui' && workflowId
          ? getGenerationWorkflowHistory(workflowId, {
              limit: GENERATION_HISTORY_PAGE_SIZE,
              offset: pageParam,
              ...(isAdmin ? {} : { mine: true }),
            })
          : getGenerationHistory(serviceType, {
              limit: GENERATION_HISTORY_PAGE_SIZE,
              offset: pageParam,
              ...(isAdmin ? {} : { mine: true }),
            })
    ),
    enabled: !authStatusQuery.isPending,
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.records.length, 0)
      return loadedCount < lastPage.total ? loadedCount : undefined
    },
    refetchInterval: (query) => {
      const pages = query.state.data?.pages ?? []
      const records = pages.flatMap((page) => page.records)
      if (hasActiveGenerationHistory(records)) {
        return GENERATION_HISTORY_ACTIVE_REFRESH_MS
      }

      if (historyRefreshWatchUntil > Date.now()) {
        return GENERATION_HISTORY_ACTIVE_REFRESH_MS
      }

      return hasPostprocessPendingHistory(records) ? GENERATION_HISTORY_POSTPROCESS_REFRESH_MS : false
    },
  })
  const refetchHistory = historyQuery.refetch
  const refreshHistory = useCallback(async (options: { watchForNewRows?: boolean } = {}) => {
    if (options.watchForNewRows) {
      setHistoryRefreshWatchUntil(Date.now() + GENERATION_HISTORY_REFRESH_WATCH_MS)
    }

    await refetchHistory()
  }, [refetchHistory])

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
    completed: completedHistoryCount,
    failed: failedHistoryCount,
    cancellation: cancellationHistoryCount,
  } = useMemo(() => getHistoryRecordStatusSummary(historyRecords), [historyRecords])
  const historyImages = useMemo(() => historyRecords.map((record) => mapHistoryRecordToImageRecord(record)), [historyRecords])
  const historyTotalCount = historyQuery.data?.pages[0]?.total

  const feedProgress = useMemo(() => getGenerationHistoryFeedProgressSummary({
    loadedCount: historyRecords.length,
    visibleCount: historyImages.length,
    totalCount: historyTotalCount,
  }), [historyImages.length, historyRecords.length, historyTotalCount])
  const historyListLayoutKey = useMemo(
    () => historyRecords
      .map((record) => `${record.id}:${getHistoryMediaVersion(record)}`)
      .join('|'),
    [historyRecords],
  )
  const {
    renderItemPersistentOverlay: renderSafetyPersistentOverlay,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: historyImages,
    enabled: historyImages.length > 0,
    visibilityMode: 'badge-only',
  })
  const historyRecordMap = useMemo(
    () => new Map(historyRecords.map((record) => [getGenerationHistorySelectionId(record), record])),
    [historyRecords],
  )
  const renderHistoryPersistentOverlay = useCallback((image: ImageRecord) => {
    const record = historyRecordMap.get(String(image?.id ?? ''))
    const safetyOverlay = renderSafetyPersistentOverlay(image)
    const cancellationLabel = record ? getHistoryCancellationBadgeLabel(record) : null

    if (!safetyOverlay && !cancellationLabel) {
      return null
    }

    return (
      <div className="flex flex-wrap items-end gap-2">
        {cancellationLabel ? (
          <Badge variant="outline" className="border-amber-500/40 bg-background/85 text-amber-700 dark:text-amber-300" title={record ? (getHistoryCancellationDetail(record) ?? cancellationLabel) : cancellationLabel}>
            {cancellationLabel}
          </Badge>
        ) : null}
        {safetyOverlay}
      </div>
    )
  }, [historyRecordMap, renderSafetyPersistentOverlay])
  const selectedHistoryRecords = useMemo(
    () => selectedHistoryIds.map((id) => historyRecordMap.get(id)).filter((record): record is NonNullable<typeof record> => Boolean(record)),
    [historyRecordMap, selectedHistoryIds],
  )
  const downloadableHistoryIds = useMemo(
    () => selectedHistoryRecords
      .filter(isHistoryRecordDownloadReady)
      .map((record) => record.id)
      .filter((id): id is number => typeof id === 'number'),
    [selectedHistoryRecords],
  )
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
  const renderHistoryItemOverlay = useCallback((image: ImageRecord) => {
    const imageSelectionId = String(image?.id ?? '')
    if (!imageSelectionId) {
      return null
    }

    const record = historyRecordMap.get(imageSelectionId)
    if (!record) {
      return null
    }

    const displayStatus = resolveHistoryDisplayStatus(record)
    if (displayStatus === 'completed') {
      return null
    }

    const cancellationLabel = getHistoryCancellationBadgeLabel(record)

    return (
      <div className="flex flex-col items-end gap-1">
        <Badge variant="outline">
          {getHistoryStatusLabel(displayStatus)}
        </Badge>
        {cancellationLabel ? (
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
            {cancellationLabel}
          </Badge>
        ) : null}
      </div>
    )
  }, [historyRecordMap])

  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => historyRecordMap.has(id)))
  }, [historyRecordMap])

  const fetchNextHistoryPage = historyQuery.fetchNextPage
  const getHistoryItemId = useCallback((image: ImageRecord) => String(image.id), [])
  const handleLoadMoreHistory = useCallback(() => {
    void fetchNextHistoryPage()
  }, [fetchNextHistoryPage])
  const handleClearSelectedHistory = useCallback(() => {
    setSelectedHistoryIds([])
  }, [])

  const handleDeleteSelected = useCallback(async () => {
    if (!isAdmin) {
      showSnackbar({ message: t('image-generation.components.generation.history.panel.only.admin.accounts.can.delete'), tone: 'error' })
      return
    }

    if (selectedHistoryRecords.length === 0 || isDeletingSelection) {
      return
    }

    const selectedCount = selectedHistoryRecords.length
    const confirmed = window.confirm(t('image-generation.components.generation.history.panel.selected.valueresults.to.the.recycle.bin.and', { count: formatNumber(selectedCount) }))
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingSelection(true)
      await Promise.all(selectedHistoryRecords.map((record) => deleteGenerationHistoryRecord(record.id, true)))
      setSelectedHistoryIds([])
      await refreshHistory()
      showSnackbar({ message: t('image-generation.components.generation.history.panel.valueresults.moved.to.recyclebin', { count: formatNumber(selectedCount) }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.delete.history')), tone: 'error' })
    } finally {
      setIsDeletingSelection(false)
    }
  }, [formatNumber, isAdmin, isDeletingSelection, refreshHistory, selectedHistoryRecords, showSnackbar, t])

  const handleCleanupFailed = useCallback(async () => {
    if (isCleaningFailed) {
      return
    }

    try {
      setIsCleaningFailed(true)
      const result = isPublicView && publicWorkflowSlug
        ? await cleanupPublicGenerationWorkflowFailedHistory(publicWorkflowSlug)
        : await cleanupFailedGenerationHistory()
      setSelectedHistoryIds([])
      await refreshHistory()
      showSnackbar({ message: result.message || t('image-generation.components.generation.history.panel.failed.history.cleaned.up'), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.clean.up.failed.history')), tone: 'error' })
    } finally {
      setIsCleaningFailed(false)
    }
  }, [isCleaningFailed, isPublicView, publicWorkflowSlug, refreshHistory, showSnackbar, t])

  const handleDownloadSelected = useCallback(async (type: 'thumbnail' | 'original') => {
    if (downloadableHistoryIds.length === 0 || isDownloadingSelection) {
      return
    }

    try {
      setIsDownloadingSelection(true)
      await downloadGenerationHistorySelection(downloadableHistoryIds, type)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.download.the.selected.images')), tone: 'error' })
    } finally {
      setIsDownloadingSelection(false)
    }
  }, [downloadableHistoryIds, isDownloadingSelection, showSnackbar, t])

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-4 overflow-hidden' : 'space-y-4')}>
      <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {onBack ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={onBack}
                aria-label={t('image-generation.components.generation.history.panel.back.to.workflow.list')}
                title={t('image-generation.components.generation.history.panel.home')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <div className="text-xl font-semibold tracking-tight text-foreground">{t('image-generation.components.generation.history.panel.generation.history')}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{historyLabel}</Badge>
          <Badge variant="outline">{t('image-generation.components.generation.history.panel.records.historyrecords.length', { historyRecords: formatNumber(historyRecords.length) })}</Badge>
          {!isPublicView ? <Badge variant="outline">{isAdmin ? t('image-generation.components.generation.history.panel.all.users') : t('image-generation.components.generation.history.panel.my.records')}</Badge> : null}
          {completedHistoryCount > 0 ? <Badge variant="outline">{t('image-generation.components.generation.history.panel.completed.value', { completedHistoryCount: formatNumber(completedHistoryCount) })}</Badge> : null}
          {inFlightHistoryCount > 0 ? <Badge variant="secondary">{t('image-generation.components.generation.history.panel.processing.value', { inFlightHistoryCount: formatNumber(inFlightHistoryCount) })}</Badge> : null}
          {cancellationHistoryCount > 0 ? <Badge variant="outline">{t('image-generation.components.generation.history.panel.cancellation.related.value', { cancellationHistoryCount: formatNumber(cancellationHistoryCount) })}</Badge> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCleanupFailed}
            disabled={isCleaningFailed || failedHistoryCount === 0}
          >
            <Trash2 className="h-4 w-4" />
            {isCleaningFailed ? t('image-generation.components.generation.history.panel.cleaning.failed.items') : t('image-generation.components.generation.history.panel.clean.failed.items')}
          </Button>
          <Button type="button" size="icon-sm" variant="outline" onClick={() => void refreshHistory({ watchForNewRows: true })} title={t('image-generation.components.generation.history.panel.refresh.history')} aria-label={t('image-generation.components.generation.history.panel.refresh.history')}>
            <RefreshCw className={cn('h-4 w-4', historyQuery.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {historyQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('image-generation.components.generation.history.panel.could.not.load.history')}</AlertTitle>
          <AlertDescription>{getErrorMessage(historyQuery.error, t('image-generation.components.generation.history.panel.failed.to.fetch.generation.history'))}</AlertDescription>
        </Alert>
      ) : null}

      {isHistoryLoading ? <div className="text-sm text-muted-foreground">{t('image-generation.components.generation.history.panel.loading.history')}</div> : null}

      <div className={cn(splitPaneScroll && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        {!isHistoryLoading && historyImages.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">{t('image-generation.components.generation.history.panel.no.generation.results.to.display.yet')}</div>
        ) : null}

        {!isHistoryLoading && historyImages.length > 0 ? (
          <>
            <PageInset className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {t(
                    { ko: '표시 {visible} / 로드 {loaded}', en: 'Showing {visible} / loaded {loaded}' },
                    { visible: formatNumber(feedProgress.visibleCount), loaded: formatNumber(feedProgress.loadedCount) },
                  )}
                </span>
                <span>
                  {t(
                    { ko: '전체 {total}', en: '{total} total' },
                    { total: formatNumber(feedProgress.totalCount) },
                  )}
                </span>
                {feedProgress.hiddenCount > 0 ? (
                  <span>
                    {t(
                      { ko: '숨김 {count}', en: '{count} hidden' },
                      { count: formatNumber(feedProgress.hiddenCount) },
                    )}
                  </span>
                ) : null}
              </div>
              {historyQuery.isRefetching && !historyQuery.isFetchingNextPage ? (
                <span>{t({ ko: '새로고침 중…', en: 'Refreshing…' })}</span>
              ) : null}
            </PageInset>

            <ImageList
              key={historyListLayoutKey}
              items={historyImages}
              layout="masonry"
              activationMode="modal"
              getItemHref={getHistoryImageHref}
              getItemId={getHistoryItemId}
              selectable
              modalAccessOptions={isPublicView ? {
                allowDetailNavigation: false,
                allowEditAction: false,
                allowGroupAssignAction: false,
              } : undefined}
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
              renderItemOverlay={renderHistoryItemOverlay}
              renderItemPersistentOverlay={renderHistoryPersistentOverlay}
              shouldBlurItemPreview={shouldBlurItemPreview}
            />

            <div className="flex shrink-0 flex-col items-center gap-3 pb-2">
              {historyQuery.isFetchingNextPage ? (
                <PageInset className="inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t({ ko: '기록 더 불러오는 중…', en: 'Loading more history…' })}</span>
                </PageInset>
              ) : null}

              {Boolean(historyQuery.hasNextPage) && !historyQuery.isFetchingNextPage && !historyQuery.isFetchNextPageError ? (
                <Button size="sm" variant="outline" onClick={handleLoadMoreHistory}>
                  {t({ ko: '더 보기', en: 'Load more' })}
                </Button>
              ) : null}

              {historyQuery.isFetchNextPageError ? (
                <Button size="sm" variant="outline" onClick={handleLoadMoreHistory}>
                  {t({ ko: '다음 기록 다시 시도', en: 'Retry next history batch' })}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {historyImages.length > 0 ? (
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
        statusText={downloadableHistoryIds.length > 0
          ? t('image-generation.components.generation.history.panel.valuedownloadable', { count: formatNumber(downloadableHistoryIds.length) })
          : t('image-generation.components.generation.history.panel.no.downloadable.results')}
        trailingActions={!isPublicView && isAdmin ? (
          <Button
            size="icon-sm"
            onClick={handleDeleteSelected}
            disabled={selectedHistoryRecords.length === 0 || isDeletingSelection}
            title={isDeletingSelection ? t('image-generation.components.generation.history.panel.deleting') : t('image-generation.components.generation.history.panel.delete.selection')}
            aria-label={isDeletingSelection ? t('image-generation.components.generation.history.panel.deleting') : t('image-generation.components.generation.history.panel.delete.selection')}
            data-no-select-drag="true"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : undefined}
        onDownloadSelect={handleDownloadSelected}
        onClear={handleClearSelectedHistory}
      />
    </section>
  )
}

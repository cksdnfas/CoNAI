import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, Trash2 } from 'lucide-react'
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
  cleanupPublicGenerationWorkflowFailedHistory,
  deleteGenerationHistoryRecord,
  downloadImageSelection,
  getGenerationHistory,
  getGenerationWorkflowHistory,
  getPublicGenerationWorkflowHistory,
} from '@/lib/api'
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

type GenerationHistoryPanelProps = {
  refreshNonce: number
  serviceType: GenerationServiceType
  workflowId?: number | null
  publicWorkflowSlug?: string | null
  splitPaneScroll?: boolean
  onBack?: () => void
}

const GENERATION_HISTORY_PAGE_SIZE = 40
const GENERATION_HISTORY_REFRESH_WATCH_MS = 30_000

function hasInFlightHistory(records: GenerationHistoryResponse['records']) {
  return records.some((record) => {
    const displayStatus = resolveHistoryDisplayStatus(record)
    return displayStatus === 'pending' || displayStatus === 'processing'
  })
}

function getGenerationHistorySelectionId(record: GenerationHistoryResponse['records'][number]) {
  return `generation-history-${record.id}`
}

function mapHistoryRecordToImageRecord(record: GenerationHistoryResponse['records'][number]): ImageRecord {
  const imageSource = resolveHistoryImageSource(record)
  const displayStatus = resolveHistoryDisplayStatus(record)
  const hasLinkedImage = Boolean(record.actual_composite_hash)

  return {
    id: `generation-history-${record.id}`,
    composite_hash: hasLinkedImage ? imageSource.compositeHash : null,
    original_file_path: null,
    thumbnail_url: hasLinkedImage ? imageSource.thumbnailUrl : null,
    image_url: hasLinkedImage ? imageSource.imageUrl : null,
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
      if (hasInFlightHistory(records)) {
        return 1500
      }

      return historyRefreshWatchUntil > Date.now() ? 1500 : false
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
    () => (historyQuery.data?.pages ?? []).flatMap((page) => page.records),
    [historyQuery.data?.pages],
  )
  const inFlightHistoryCount = useMemo(
    () => historyRecords.filter((record) => {
      const displayStatus = resolveHistoryDisplayStatus(record)
      return displayStatus === 'pending' || displayStatus === 'processing'
    }).length,
    [historyRecords],
  )
  const completedHistoryCount = useMemo(
    () => historyRecords.filter((record) => resolveHistoryDisplayStatus(record) === 'completed').length,
    [historyRecords],
  )
  const failedHistoryCount = useMemo(
    () => historyRecords.filter((record) => resolveHistoryDisplayStatus(record) === 'failed').length,
    [historyRecords],
  )
  const cancellationHistoryCount = useMemo(
    () => historyRecords.filter((record) => (record.queue_cancel_requested ?? 0) > 0).length,
    [historyRecords],
  )
  const historyImages = useMemo(() => historyRecords.map((record) => mapHistoryRecordToImageRecord(record)), [historyRecords])
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
  const renderHistoryPersistentOverlay = (image: ImageRecord) => {
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
  }
  const selectedHistoryRecords = useMemo(
    () => selectedHistoryIds.map((id) => historyRecordMap.get(id)).filter((record): record is NonNullable<typeof record> => Boolean(record)),
    [historyRecordMap, selectedHistoryIds],
  )
  const downloadableCompositeHashes = useMemo(
    () => Array.from(new Set(selectedHistoryRecords.map((record) => record.composite_hash).filter((hash): hash is string => typeof hash === 'string' && hash.length > 0))),
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
  const getHistoryImageHref = (image: ImageRecord) => {
    const record = historyRecordMap.get(String(image?.id ?? ''))
    if (!record || resolveHistoryDisplayStatus(record) !== 'completed' || !image?.composite_hash) {
      return undefined
    }

    return `/images/${image.composite_hash}`
  }

  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => historyRecordMap.has(id)))
  }, [historyRecordMap])

  const handleDeleteSelected = async () => {
    if (!isAdmin) {
      showSnackbar({ message: t('image-generation.components.generation.history.panel.only.admin.accounts.can.delete'), tone: 'error' })
      return
    }

    if (selectedHistoryRecords.length === 0 || isDeletingSelection) {
      return
    }

    const confirmed = window.confirm(t('image-generation.components.generation.history.panel.selected.valueresults.to.the.recycle.bin.and', { count: formatNumber(selectedHistoryRecords.length) }))
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingSelection(true)
      await Promise.all(selectedHistoryRecords.map((record) => deleteGenerationHistoryRecord(record.id, true)))
      setSelectedHistoryIds([])
      await refreshHistory()
      showSnackbar({ message: t('image-generation.components.generation.history.panel.valueresults.moved.to.recyclebin', { count: formatNumber(selectedHistoryRecords.length) }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.delete.history')), tone: 'error' })
    } finally {
      setIsDeletingSelection(false)
    }
  }

  const handleCleanupFailed = async () => {
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
  }

  const handleDownloadSelected = async (type: 'thumbnail' | 'original') => {
    if (downloadableCompositeHashes.length === 0 || isDownloadingSelection) {
      return
    }

    try {
      setIsDownloadingSelection(true)
      await downloadImageSelection(downloadableCompositeHashes, type)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.download.the.selected.images')), tone: 'error' })
    } finally {
      setIsDownloadingSelection(false)
    }
  }

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
            onClick={() => void handleCleanupFailed()}
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
          <ImageList
            items={historyImages}
            layout="masonry"
            activationMode="modal"
            getItemHref={getHistoryImageHref}
            getItemId={(image) => String(image.id)}
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
            onLoadMore={historyQuery.fetchNextPage}
            renderItemOverlay={(image) => {
              const imageSelectionId = String(image?.id ?? '')
              if (!imageSelectionId) {
                return null
              }

              const record = historyRecordMap.get(String(imageSelectionId))
              if (!record) {
                return null
              }

              const displayStatus = resolveHistoryDisplayStatus(record)
              if (displayStatus === 'completed') {
                return null
              }

              return (
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline">
                    {getHistoryStatusLabel(displayStatus)}
                  </Badge>
                  {getHistoryCancellationBadgeLabel(record) ? (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                      {getHistoryCancellationBadgeLabel(record)}
                    </Badge>
                  ) : null}
                </div>
              )
            }}
            renderItemPersistentOverlay={renderHistoryPersistentOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
          />
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
        downloadableCount={downloadableCompositeHashes.length}
        isDownloading={isDownloadingSelection}
        statusText={downloadableCompositeHashes.length > 0
          ? t('image-generation.components.generation.history.panel.valuedownloadable', { count: formatNumber(downloadableCompositeHashes.length) })
          : t('image-generation.components.generation.history.panel.no.downloadable.results')}
        trailingActions={!isPublicView && isAdmin ? (
          <Button
            size="icon-sm"
            onClick={() => void handleDeleteSelected()}
            disabled={selectedHistoryRecords.length === 0 || isDeletingSelection}
            title={isDeletingSelection ? t('image-generation.components.generation.history.panel.deleting') : t('image-generation.components.generation.history.panel.delete.selection')}
            aria-label={isDeletingSelection ? t('image-generation.components.generation.history.panel.deleting') : t('image-generation.components.generation.history.panel.delete.selection')}
            data-no-select-drag="true"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : undefined}
        onDownloadSelect={handleDownloadSelected}
        onClear={() => setSelectedHistoryIds([])}
      />
    </section>
  )
}

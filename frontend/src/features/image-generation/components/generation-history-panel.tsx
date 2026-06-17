import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
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
import type { GenerationHistoryRecord, GenerationServiceType } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import {
  getErrorMessage,
  getHistoryCancellationBadgeLabel,
  getHistoryCancellationDetail,
  getRetryableHistoryQueueJobId,
  getHistoryStatusLabel,
  resolveHistoryDisplayStatus,
} from '../image-generation-shared'
import { getGenerationHistoryFeedProgressSummary } from '../generation-history-feed-progress'
import { getUniqueRetryableHistoryQueueJobIds, retryGenerationHistoryRecords } from './generation-history-retry-actions'
import {
  GENERATION_HISTORY_ACTIVE_REFRESH_MS,
  GENERATION_HISTORY_PAGE_SIZE,
  GENERATION_HISTORY_POSTPROCESS_REFRESH_MS,
  GENERATION_HISTORY_RECOVERY_ACK_STORAGE_PREFIX,
  GENERATION_HISTORY_REFRESH_WATCH_MS,
  collectRetryableHistoryRecords,
  dedupeHistoryRecords,
  getGenerationHistorySelectionId,
  getHistoryMediaVersion,
  getHistoryMediaReviewBadges,
  getHistoryRecordStatusSummary,
  getHistoryRecoveryDetail,
  getHistoryRecoveryLabel,
  hasActiveGenerationHistory,
  hasPostprocessPendingHistory,
  isHistoryRecordDownloadReady,
  mapHistoryRecordToImageRecord,
  readAcknowledgedRecoveryIds,
  writeAcknowledgedRecoveryIds,
} from './generation-history-panel-helpers'

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
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const queryClient = useQueryClient()
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
  const [retryingQueueJobIds, setRetryingQueueJobIds] = useState<Set<number>>(() => new Set())
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
  const recoveryAckStorageKey = useMemo(
    () => `${GENERATION_HISTORY_RECOVERY_ACK_STORAGE_PREFIX}${historyQueryKey.join(':')}`,
    [historyQueryKey],
  )
  const [acknowledgedRecoveryIds, setAcknowledgedRecoveryIds] = useState<Set<number>>(() => readAcknowledgedRecoveryIds(recoveryAckStorageKey))
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
    setAcknowledgedRecoveryIds(readAcknowledgedRecoveryIds(recoveryAckStorageKey))
  }, [recoveryAckStorageKey])

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
    cleanupFailed: cleanupFailedHistoryCount,
    cancellation: cancellationHistoryCount,
  } = useMemo(() => getHistoryRecordStatusSummary(historyRecords), [historyRecords])
  const retryableHistoryRecords = useMemo(() => {
    return collectRetryableHistoryRecords(historyRecords)
  }, [historyRecords])
  const visibleRetryableHistoryRecords = useMemo(
    () => retryableHistoryRecords.filter((record) => !acknowledgedRecoveryIds.has(record.id)).slice(0, 4),
    [acknowledgedRecoveryIds, retryableHistoryRecords],
  )
  const isRetryingRunRecovery = retryingQueueJobIds.size > 0
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
    const mediaReviewBadges = record ? getHistoryMediaReviewBadges(record, formatNumber, t) : []

    if (!safetyOverlay && !cancellationLabel && mediaReviewBadges.length === 0) {
      return null
    }

    return (
      <div className="flex flex-wrap items-end gap-2">
        {mediaReviewBadges.map((badge) => (
          <Badge key={badge.key} variant="outline" className="max-w-[9rem] truncate bg-background/85" title={badge.title}>
            {badge.label}
          </Badge>
        ))}
        {cancellationLabel ? (
          <Badge variant="outline" className="border-amber-500/40 bg-background/85 text-amber-700 dark:text-amber-300" title={record ? (getHistoryCancellationDetail(record) ?? cancellationLabel) : cancellationLabel}>
            {cancellationLabel}
          </Badge>
        ) : null}
        {safetyOverlay}
      </div>
    )
  }, [formatNumber, historyRecordMap, renderSafetyPersistentOverlay, t])
  const selectedHistoryRecords = useMemo(
    () => selectedHistoryIds.map((id) => historyRecordMap.get(id)).filter((record): record is NonNullable<typeof record> => Boolean(record)),
    [historyRecordMap, selectedHistoryIds],
  )
  const selectedRetryableHistoryRecords = useMemo(
    () => collectRetryableHistoryRecords(selectedHistoryRecords),
    [selectedHistoryRecords],
  )
  const downloadableHistoryIds = useMemo(
    () => selectedHistoryRecords
      .filter(isHistoryRecordDownloadReady)
      .map((record) => record.id)
      .filter((id): id is number => typeof id === 'number'),
    [selectedHistoryRecords],
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
          {getHistoryStatusLabel(displayStatus, record)}
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

  const acknowledgeRecoveryRecords = useCallback((records: GenerationHistoryRecord[]) => {
    if (records.length === 0) {
      return
    }

    setAcknowledgedRecoveryIds((current) => {
      const next = new Set(current)
      for (const record of records) {
        next.add(record.id)
      }
      writeAcknowledgedRecoveryIds(recoveryAckStorageKey, next)
      return next
    })
  }, [recoveryAckStorageKey])

  const handleAcknowledgeRunRecovery = useCallback(() => {
    acknowledgeRecoveryRecords(visibleRetryableHistoryRecords)
  }, [acknowledgeRecoveryRecords, visibleRetryableHistoryRecords])

  const handleRetryHistoryRecords = useCallback(async (
    records: readonly GenerationHistoryRecord[],
    options: { successMessage: string; failureMessage: string },
  ) => {
    const retryableRecords = collectRetryableHistoryRecords(records)
    if (retryableRecords.length === 0 || isRetryingRunRecovery) {
      return
    }

    const queueJobIds = getUniqueRetryableHistoryQueueJobIds(retryableRecords)
    if (queueJobIds.length === 0) {
      return
    }

    try {
      setRetryingQueueJobIds(new Set(queueJobIds))
      const retryQueued = await retryGenerationHistoryRecords({
        records: retryableRecords,
        queryClient,
        refreshHistory,
        showSnackbar,
        successMessage: options.successMessage,
        failureMessage: options.failureMessage,
      })
      if (retryQueued) {
        acknowledgeRecoveryRecords(retryableRecords)
      }
    } finally {
      setRetryingQueueJobIds(new Set())
    }
  }, [acknowledgeRecoveryRecords, isRetryingRunRecovery, queryClient, refreshHistory, showSnackbar])

  const handleRetryHistoryRecord = useCallback(async (record: GenerationHistoryRecord) => {
    await handleRetryHistoryRecords([record], {
      successMessage: t({ ko: '큐 재실행 작업을 등록했어.', en: 'Added the retry job to the queue.' }),
      failureMessage: t({ ko: '큐 재실행 등록에 실패했어.', en: 'Failed to add the retry job.' }),
    })
  }, [handleRetryHistoryRecords, t])

  const handleRetryVisibleRecoveryRecords = useCallback(async () => {
    await handleRetryHistoryRecords(visibleRetryableHistoryRecords, {
      successMessage: t(
        { ko: '재실행 작업 {count}개를 큐에 등록했어.', en: 'Added {count} retry jobs to the queue.' },
        { count: formatNumber(visibleRetryableHistoryRecords.length) },
      ),
      failureMessage: t({ ko: '일괄 재실행 등록에 실패했어.', en: 'Failed to add retry jobs.' }),
    })
  }, [formatNumber, handleRetryHistoryRecords, t, visibleRetryableHistoryRecords])

  const handleRetrySelectedHistoryRecords = useCallback(async () => {
    await handleRetryHistoryRecords(selectedRetryableHistoryRecords, {
      successMessage: t(
        { ko: '선택한 재실행 작업 {count}개를 큐에 등록했어.', en: 'Added {count} selected retry jobs to the queue.' },
        { count: formatNumber(selectedRetryableHistoryRecords.length) },
      ),
      failureMessage: t({ ko: '선택 재실행 등록에 실패했어.', en: 'Failed to add selected retry jobs.' }),
    })
  }, [formatNumber, handleRetryHistoryRecords, selectedRetryableHistoryRecords, t])

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
            disabled={isCleaningFailed || cleanupFailedHistoryCount === 0}
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

      {!isHistoryLoading && visibleRetryableHistoryRecords.length > 0 ? (
        <PageInset className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{t({ ko: '실행 복구', en: 'Run recovery' })}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t({ ko: '재실행 가능한 실패/취소 큐 {count}개', en: '{count} failed or canceled queue records are rerun-ready' }, { count: formatNumber(visibleRetryableHistoryRecords.length) })}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="secondary">{t({ ko: '재실행 {count}', en: 'Rerun {count}' }, { count: formatNumber(visibleRetryableHistoryRecords.length) })}</Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleRetryVisibleRecoveryRecords()}
                disabled={isRetryingRunRecovery}
              >
                <RotateCcw className={cn('h-4 w-4', isRetryingRunRecovery && 'animate-spin')} />
                {isRetryingRunRecovery
                  ? t({ ko: '등록 중', en: 'Queueing' })
                  : t({ ko: '모두 재실행', en: 'Rerun all' })}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleAcknowledgeRunRecovery}>
                {t({ ko: '확인', en: 'Dismiss' })}
              </Button>
            </div>
          </div>

          <div className="divide-y divide-border/70">
            {visibleRetryableHistoryRecords.map((record) => {
              const queueJobId = getRetryableHistoryQueueJobId(record)
              const isRetrying = queueJobId !== null && retryingQueueJobIds.has(queueJobId)
              const workflowLabel = record.workflow_name?.trim() || (
                record.service_type === 'comfyui'
                  ? t({ ko: 'ComfyUI 실행 #{id}', en: 'ComfyUI run #{id}' }, { id: record.id })
                  : record.service_type === 'codex'
                    ? t({ ko: 'Codex 실행 #{id}', en: 'Codex run #{id}' }, { id: record.id })
                    : t({ ko: 'NAI 실행 #{id}', en: 'NAI run #{id}' }, { id: record.id })
              )

              return (
                <div key={record.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="outline">{getHistoryRecoveryLabel(record, t)}</Badge>
                      <span className="truncate text-sm font-medium text-foreground" title={workflowLabel}>{workflowLabel}</span>
                      {typeof queueJobId === 'number' ? <span className="text-xs text-muted-foreground">#{queueJobId}</span> : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{getHistoryRecoveryDetail(record, t)}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void handleRetryHistoryRecord(record)}
                    disabled={isRetryingRunRecovery}
                    data-no-select-drag="true"
                  >
                    <RotateCcw className={cn('h-4 w-4', isRetrying && 'animate-spin')} />
                    {isRetrying ? t({ ko: '등록 중', en: 'Queueing' }) : t({ ko: '재실행', en: 'Rerun' })}
                  </Button>
                </div>
              )
            })}
          </div>
        </PageInset>
      ) : null}

      <div className={cn(splitPaneScroll && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        {!isHistoryLoading && historyImages.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">{t('image-generation.components.generation.history.panel.no.generation.results.to.display.yet')}</div>
        ) : null}

        {!isHistoryLoading && historyImages.length > 0 ? (
          <>
            <PageInset className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
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
        statusText={selectionStatusText}
        trailingActions={(
          <>
            {selectedRetryableHistoryRecords.length > 0 ? (
              <Button
                size="icon-sm"
                onClick={() => void handleRetrySelectedHistoryRecords()}
                disabled={isRetryingRunRecovery}
                title={isRetryingRunRecovery ? t({ ko: '재실행 등록 중', en: 'Queueing rerun' }) : t({ ko: '선택 재실행', en: 'Rerun selected' })}
                aria-label={isRetryingRunRecovery ? t({ ko: '재실행 등록 중', en: 'Queueing rerun' }) : t({ ko: '선택 재실행', en: 'Rerun selected' })}
                data-no-select-drag="true"
              >
                <RotateCcw className={cn('h-4 w-4', isRetryingRunRecovery && 'animate-spin')} />
              </Button>
            ) : null}

            {!isPublicView && isAdmin ? (
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
            ) : null}
          </>
        )}
        onDownloadSelect={handleDownloadSelected}
        onClear={handleClearSelectedHistory}
      />
    </section>
  )
}

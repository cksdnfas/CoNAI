import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
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
import { cn } from '@/lib/utils'
import {
  getErrorMessage,
  getHistoryStatusLabel,
  resolveHistoryDisplayStatus,
  resolveHistoryImageSource,
} from '../image-generation-shared'

type GenerationHistoryPanelProps = {
  refreshNonce: number
  serviceType: 'novelai' | 'comfyui'
  workflowId?: number | null
  publicWorkflowSlug?: string | null
  splitPaneScroll?: boolean
  onBack?: () => void
}

const GENERATION_HISTORY_PAGE_SIZE = 40

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
  const isAdmin = authStatusQuery.data?.isAdmin === true
  const requesterAccountId = authStatusQuery.data?.accountId ?? null
  const requesterAccountType = authStatusQuery.data?.accountType ?? null
  const isPublicView = Boolean(publicWorkflowSlug)
  const historyScope = isPublicView ? 'public-workflow' : (isAdmin ? 'all-users' : 'mine-only')
  const historyQueryKey = ['image-generation-history', serviceType, workflowId ?? null, publicWorkflowSlug ?? null, historyScope, requesterAccountId, requesterAccountType] as const
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
      return hasInFlightHistory(records) ? 1500 : false
    },
  })
  const refetchHistory = historyQuery.refetch

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void refetchHistory()
  }, [refreshNonce, refetchHistory])

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
    () => historyRecords.filter((record) => record.generation_status === 'failed').length,
    [historyRecords],
  )
  const historyImages = useMemo(() => historyRecords.map((record) => mapHistoryRecordToImageRecord(record)), [historyRecords])
  const {
    renderItemPersistentOverlay,
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
  const selectedHistoryRecords = useMemo(
    () => selectedHistoryIds.map((id) => historyRecordMap.get(id)).filter((record): record is NonNullable<typeof record> => Boolean(record)),
    [historyRecordMap, selectedHistoryIds],
  )
  const downloadableCompositeHashes = useMemo(
    () => Array.from(new Set(selectedHistoryRecords.map((record) => record.composite_hash).filter((hash): hash is string => typeof hash === 'string' && hash.length > 0))),
    [selectedHistoryRecords],
  )
  const historyLabel = isPublicView ? 'Public Workflow' : serviceType === 'novelai' ? 'NAI' : workflowId ? 'ComfyUI Workflow' : 'ComfyUI'
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
    if (selectedHistoryRecords.length === 0 || isDeletingSelection) {
      return
    }

    try {
      setIsDeletingSelection(true)
      await Promise.all(selectedHistoryRecords.map((record) => deleteGenerationHistoryRecord(record.id)))
      setSelectedHistoryIds([])
      await refetchHistory()
      showSnackbar({ message: `${selectedHistoryRecords.length.toLocaleString('ko-KR')}개 히스토리를 삭제했어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '히스토리 삭제에 실패했어.'), tone: 'error' })
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
      await refetchHistory()
      showSnackbar({ message: result.message || '실패한 히스토리를 정리했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '실패 히스토리 정리에 실패했어.'), tone: 'error' })
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
      showSnackbar({ message: getErrorMessage(error, '선택한 이미지 다운로드에 실패했어.'), tone: 'error' })
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
                aria-label="워크플로우 목록으로 돌아가기"
                title="처음으로"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <div className="text-xl font-semibold tracking-tight text-foreground">생성 히스토리</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{historyLabel}</Badge>
          <Badge variant="outline">기록 {historyRecords.length}</Badge>
          {!isPublicView ? <Badge variant="outline">{isAdmin ? '전체 사용자' : '내 기록'}</Badge> : null}
          {completedHistoryCount > 0 ? <Badge variant="outline">완료 {completedHistoryCount}</Badge> : null}
          {inFlightHistoryCount > 0 ? <Badge variant="secondary">작업 중 {inFlightHistoryCount}</Badge> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleCleanupFailed()}
            disabled={isCleaningFailed || failedHistoryCount === 0}
          >
            <Trash2 className="h-4 w-4" />
            {isCleaningFailed ? '실패 정리 중…' : '실패 항목 정리'}
          </Button>
          <Button type="button" size="icon-sm" variant="outline" onClick={() => void refetchHistory()} title="히스토리 새로고침" aria-label="히스토리 새로고침">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {historyQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>히스토리를 불러오지 못했어</AlertTitle>
          <AlertDescription>{getErrorMessage(historyQuery.error, '생성 히스토리 조회 실패')}</AlertDescription>
        </Alert>
      ) : null}

      {isHistoryLoading ? <div className="text-sm text-muted-foreground">히스토리 불러오는 중…</div> : null}

      <div className={cn(splitPaneScroll && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        {!isHistoryLoading && historyImages.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">아직 표시할 생성 결과가 없어.</div>
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
                <Badge variant="outline">
                  {getHistoryStatusLabel(displayStatus)}
                </Badge>
              )
            }}
            renderItemPersistentOverlay={renderItemPersistentOverlay}
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
          title="히스토리 한 줄 카드 수"
          onChange={setHistoryColumnCount}
          onReset={resetHistoryColumnCount}
        />
      ) : null}

      <ImageSelectionBar
        selectedCount={selectedHistoryRecords.length}
        downloadableCount={downloadableCompositeHashes.length}
        isDownloading={isDownloadingSelection}
        statusText={downloadableCompositeHashes.length > 0
          ? `${downloadableCompositeHashes.length.toLocaleString('ko-KR')}개 다운로드 가능`
          : '다운로드 가능한 결과가 없어'}
        extraActions={!isPublicView ? (
          <Button size="sm" onClick={() => void handleDeleteSelected()} disabled={selectedHistoryRecords.length === 0 || isDeletingSelection} data-no-select-drag="true">
            <Trash2 className="h-4 w-4" />
            {isDeletingSelection ? '삭제 중…' : '선택 삭제'}
          </Button>
        ) : undefined}
        onDownloadSelect={handleDownloadSelected}
        onClear={() => setSelectedHistoryIds([])}
      />
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImageList } from '@/features/images/components/image-list/image-list'
import type { ImageRecord } from '@/types/image'
import { cleanupFailedGenerationHistory, deleteGenerationHistoryRecord, getGenerationHistory, getGenerationWorkflowHistory } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  getErrorMessage,
  getHistoryStatusLabel,
} from '../image-generation-shared'

type GenerationHistoryPanelProps = {
  refreshNonce: number
  serviceType: 'novelai' | 'comfyui'
  workflowId?: number | null
  splitPaneScroll?: boolean
}

function hasInFlightHistory(records: Awaited<ReturnType<typeof getGenerationHistory>>['records']) {
  return records.some((record) => record.generation_status === 'pending' || record.generation_status === 'processing')
}

function getGenerationHistorySelectionId(record: Awaited<ReturnType<typeof getGenerationHistory>>['records'][number]) {
  return `generation-history-${record.id}`
}

function mapHistoryRecordToImageRecord(record: Awaited<ReturnType<typeof getGenerationHistory>>['records'][number]): ImageRecord {
  const compositeHash = record.actual_composite_hash || record.composite_hash || null
  const fallbackPreviewUrl = record.original_path ? `/api/images/by-path/${encodeURIComponent(record.original_path)}` : null

  return {
    id: `generation-history-${record.id}`,
    composite_hash: compositeHash,
    original_file_path: record.original_path,
    thumbnail_url: compositeHash ? `/api/images/${compositeHash}/thumbnail` : fallbackPreviewUrl,
    image_url: compositeHash ? `/api/images/${compositeHash}/file` : fallbackPreviewUrl,
    width: record.actual_width ?? record.width,
    height: record.actual_height ?? record.height,
    is_processing: record.generation_status === 'pending' || record.generation_status === 'processing',
  }
}

/** Render generation history using the shared image-list surface instead of per-record cards. */
export function GenerationHistoryPanel({ refreshNonce, serviceType, workflowId, splitPaneScroll = false }: GenerationHistoryPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([])
  const [isDeletingSelection, setIsDeletingSelection] = useState(false)
  const [isCleaningFailed, setIsCleaningFailed] = useState(false)

  const historyQueryKey = ['image-generation-history', serviceType, workflowId ?? null] as const
  const historyQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: () => (serviceType === 'comfyui' && workflowId ? getGenerationWorkflowHistory(workflowId) : getGenerationHistory(serviceType)),
    refetchInterval: (query) => {
      const records = query.state.data?.records ?? []
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

  const historyRecords = historyQuery.data?.records ?? []
  const historyImages = useMemo(() => historyRecords.map((record) => mapHistoryRecordToImageRecord(record)), [historyRecords])
  const historyRecordMap = useMemo(
    () => new Map(historyRecords.map((record) => [getGenerationHistorySelectionId(record), record])),
    [historyRecords],
  )
  const selectedHistoryRecords = useMemo(
    () => selectedHistoryIds.map((id) => historyRecordMap.get(id)).filter((record): record is NonNullable<typeof record> => Boolean(record)),
    [historyRecordMap, selectedHistoryIds],
  )
  const historyLabel = serviceType === 'novelai' ? 'NAI' : workflowId ? 'ComfyUI Workflow' : 'ComfyUI'
  const getHistoryImageHref = (image: ImageRecord) => (image?.composite_hash ? `/images/${image.composite_hash}` : undefined)

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
      const result = await cleanupFailedGenerationHistory()
      setSelectedHistoryIds([])
      await refetchHistory()
      showSnackbar({ message: result.message || '실패한 히스토리를 정리했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '실패 히스토리 정리에 실패했어.'), tone: 'error' })
    } finally {
      setIsCleaningFailed(false)
    }
  }

  return (
    <section className={cn('space-y-4', splitPaneScroll && 'flex min-h-0 flex-1 flex-col')}>
      <SectionHeading
        className="border-b border-border/70 pb-4"
        heading="생성 히스토리"
        actions={(
          <>
            <Badge variant="outline">{historyLabel}</Badge>
            <Badge variant="outline">{historyRecords.length}</Badge>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleCleanupFailed()} disabled={isCleaningFailed}>
              <Trash2 className="h-4 w-4" />
              {isCleaningFailed ? '실패 정리 중…' : '실패 항목 정리'}
            </Button>
            <Button type="button" size="icon-sm" variant="outline" onClick={() => void refetchHistory()} title="히스토리 새로고침" aria-label="히스토리 새로고침">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </>
        )}
      />

      {historyQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>히스토리를 불러오지 못했어</AlertTitle>
          <AlertDescription>{getErrorMessage(historyQuery.error, '생성 히스토리 조회 실패')}</AlertDescription>
        </Alert>
      ) : null}

      {historyQuery.isPending ? <div className="text-sm text-muted-foreground">히스토리 불러오는 중…</div> : null}

      <div className={cn(splitPaneScroll && 'min-h-0 flex-1')}>
        {!historyQuery.isPending && historyImages.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">아직 생성 이력이 없어.</div>
        ) : null}

        {!historyQuery.isPending && historyImages.length > 0 ? (
          <ImageList
            items={historyImages}
            layout="masonry"
            activationMode="modal"
            getItemHref={getHistoryImageHref}
            getItemId={(image) => String(image.id)}
            selectable
            selectedIds={selectedHistoryIds}
            onSelectedIdsChange={setSelectedHistoryIds}
            minColumnWidth={220}
            columnGap={splitPaneScroll ? 12 : 16}
            rowGap={splitPaneScroll ? 12 : 16}
            className={cn(splitPaneScroll && 'h-full pr-3 pb-1')}
            scrollMode={splitPaneScroll ? 'container' : 'window'}
            viewportHeight={splitPaneScroll ? '100%' : undefined}
            renderItemOverlay={(image) => {
              const imageSelectionId = String(image?.id ?? '')
              if (!imageSelectionId) {
                return null
              }

              const record = historyRecordMap.get(String(imageSelectionId))
              if (!record || record.generation_status === 'completed') {
                return null
              }

              return (
                <Badge variant={record.generation_status === 'failed' ? 'outline' : 'secondary'}>
                  {getHistoryStatusLabel(record.generation_status)}
                </Badge>
              )
            }}
          />
        ) : null}
      </div>

      <SelectionActionBar
        selectedCount={selectedHistoryRecords.length}
        description="드래그로 고른 히스토리를 삭제할 수 있어"
        onClear={() => setSelectedHistoryIds([])}
        actions={(
          <Button size="sm" onClick={() => void handleDeleteSelected()} disabled={selectedHistoryRecords.length === 0 || isDeletingSelection} data-no-select-drag="true">
            <Trash2 className="h-4 w-4" />
            {isDeletingSelection ? '삭제 중…' : '선택 삭제'}
          </Button>
        )}
      />
    </section>
  )
}

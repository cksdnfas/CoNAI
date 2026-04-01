import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ImageList } from '@/features/images/components/image-list/image-list'
import type { ImageRecord } from '@/types/image'
import { getGenerationHistory, getGenerationWorkflowHistory } from '@/lib/api'
import {
  getErrorMessage,
  getHistoryStatusLabel,
} from '../image-generation-shared'

type GenerationHistoryPanelProps = {
  refreshNonce: number
  serviceType: 'novelai' | 'comfyui'
  workflowId?: number | null
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
export function GenerationHistoryPanel({ refreshNonce, serviceType, workflowId }: GenerationHistoryPanelProps) {
  const historyQuery = useQuery({
    queryKey: ['image-generation-history', serviceType, workflowId ?? null],
    queryFn: () => (serviceType === 'comfyui' && workflowId ? getGenerationWorkflowHistory(workflowId) : getGenerationHistory(serviceType)),
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void historyQuery.refetch()
  }, [historyQuery, refreshNonce])

  const historyRecords = historyQuery.data?.records ?? []
  const historyImages = useMemo(() => historyRecords.map((record) => mapHistoryRecordToImageRecord(record)), [historyRecords])
  const historyRecordMap = useMemo(
    () => new Map(historyRecords.map((record) => [String(record.actual_composite_hash || record.composite_hash || `generation-history-${record.id}`), record])),
    [historyRecords],
  )
  const historyLabel = serviceType === 'novelai' ? 'NAI' : workflowId ? 'ComfyUI Workflow' : 'ComfyUI'

  return (
    <section className="space-y-4">
      <SectionHeading
        className="border-b border-border/70 pb-4"
        heading="생성 히스토리"
        actions={(
          <>
            <Badge variant="outline">{historyLabel}</Badge>
            <Badge variant="outline">{historyRecords.length}</Badge>
            <Button type="button" size="icon-sm" variant="outline" onClick={() => void historyQuery.refetch()} title="히스토리 새로고침" aria-label="히스토리 새로고침">
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

      {!historyQuery.isPending && historyImages.length === 0 ? (
        <div className="py-4 text-sm text-muted-foreground">아직 생성 이력이 없어.</div>
      ) : null}

      {!historyQuery.isPending && historyImages.length > 0 ? (
        <ImageList
          items={historyImages}
          layout="masonry"
          activationMode="modal"
          getItemHref={(image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined)}
          minColumnWidth={220}
          columnGap={16}
          rowGap={16}
          renderItemOverlay={(image) => {
            const record = historyRecordMap.get(String(image.composite_hash ?? image.id))
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
    </section>
  )
}

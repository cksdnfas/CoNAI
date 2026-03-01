import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GenerationHistoryRecord, ServiceType } from '@comfyui-image-manager/shared'
import type { ImageRecord } from '@/types/image'
import { generationHistoryApi } from '@/services/generation-history-api'
import { convertHistoriesToImageRecords } from '@/utils/generation-history-adapter'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import ImageList from '@/features/images/components/image-list'
import { createInfiniteImageListAdapter } from '@/features/images/components/image-list-contract'

interface GenerationHistoryListProps {
  serviceType?: ServiceType
  workflowId?: number
  refreshKey?: number
}

const ITEMS_PER_PAGE = 50

export function GenerationHistoryList({ serviceType, workflowId, refreshKey }: GenerationHistoryListProps) {
  const { t } = useTranslation()
  const [records, setRecords] = useState<GenerationHistoryRecord[]>([])
  const [imageRecords, setImageRecords] = useState<ImageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [localRefreshKey, setLocalRefreshKey] = useState(0)

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setLoading(true)
        setPage(1)

        const bustCache = localRefreshKey > 0 || (refreshKey !== undefined && refreshKey > 0)
        const response = workflowId
          ? await generationHistoryApi.getByWorkflow(workflowId, {
              limit: ITEMS_PER_PAGE,
              offset: 0,
              bustCache,
            })
          : await generationHistoryApi.getAll({
              service_type: serviceType,
              limit: ITEMS_PER_PAGE,
              offset: 0,
              bustCache,
            })

        const newRecords = response.records || []
        setHasMore(newRecords.length >= ITEMS_PER_PAGE)
        setRecords([...newRecords])
        setImageRecords([...convertHistoriesToImageRecords(newRecords)])
      } catch (loadError) {
        console.error('Failed to load generation history:', loadError)
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    }

    void loadHistory()
  }, [localRefreshKey, refreshKey, serviceType, workflowId])

  const loadMoreData = useCallback(async () => {
    try {
      const nextPage = page + 1
      const response = workflowId
        ? await generationHistoryApi.getByWorkflow(workflowId, {
            limit: ITEMS_PER_PAGE,
            offset: (nextPage - 1) * ITEMS_PER_PAGE,
          })
        : await generationHistoryApi.getAll({
            service_type: serviceType,
            limit: ITEMS_PER_PAGE,
            offset: (nextPage - 1) * ITEMS_PER_PAGE,
          })

      const newRecords = response.records || []
      setHasMore(newRecords.length >= ITEMS_PER_PAGE)
      setRecords((previous) => [...previous, ...newRecords])
      setImageRecords((previous) => [...previous, ...convertHistoriesToImageRecords(newRecords)])
      setPage(nextPage)
    } catch (loadMoreError) {
      console.error('Failed to load more generation history:', loadMoreError)
      setHasMore(false)
    }
  }, [page, serviceType, workflowId])

  const handleRefresh = () => {
    setSelectedIds([])
    setLocalRefreshKey((previous) => previous + 1)
  }

  const handleCleanupFailed = async () => {
    setCleanupLoading(true)
    try {
      const result = await generationHistoryApi.cleanupFailed(false)
      setCleanupDialogOpen(false)
      handleRefresh()
      if (result.deleted > 0) {
        alert(t('generationHistory:cleanupSuccess', { count: result.deleted }))
      } else {
        alert(t('generationHistory:noFailedRecords'))
      }
    } catch (cleanupError) {
      console.error('Failed to cleanup failed records:', cleanupError)
      alert(t('generationHistory:cleanupFailed'))
    } finally {
      setCleanupLoading(false)
    }
  }

  const failedCount = records.filter((record) => record.generation_status === 'failed').length
  const imageListAdapter = createInfiniteImageListAdapter({
    contextId: 'generation_history',
    infiniteScroll: { hasMore, loadMore: loadMoreData },
    total: imageRecords.length,
  })

  return (
    <div className="flex h-full w-full flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('generationHistory:title')} ({imageRecords.length})</h2>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
            {t('common:refresh')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCleanupDialogOpen(true)}
            disabled={failedCount === 0 || cleanupLoading}
          >
            <Trash2 className="h-4 w-4" />
            {t('generationHistory:cleanupFailedButton')} ({failedCount})
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ImageList
          images={imageRecords}
          loading={loading}
          selectable={true}
          selection={{ selectedIds, onSelectionChange: setSelectedIds }}
          adapter={imageListAdapter}
          onSearchClick={undefined}
        />
      </div>

      <Dialog open={cleanupDialogOpen} onOpenChange={setCleanupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('generationHistory:cleanupConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('generationHistory:cleanupConfirmMessage', { count: failedCount })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCleanupDialogOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button type="button" onClick={handleCleanupFailed} disabled={cleanupLoading}>
              {cleanupLoading ? t('common:loading') : t('generationHistory:cleanupFailedButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

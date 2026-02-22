import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Tooltip, Typography } from '@mui/material'
import { CleaningServices as CleaningServicesIcon, Refresh as RefreshIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { GenerationHistoryRecord, ServiceType } from '@comfyui-image-manager/shared'
import type { ImageRecord } from '@/types/image'
import { generationHistoryApi } from '@/services/generation-history-api'
import { convertHistoriesToImageRecords } from '@/utils/generation-history-adapter'
import ImageList from '../../../../legacy-src/components/ImageList/ImageList'

interface GenerationHistoryListProps {
  serviceType?: ServiceType
  workflowId?: number
  refreshKey?: number
}

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

  const itemsPerPage = 50

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setLoading(true)
        setPage(1)

        const bustCache = localRefreshKey > 0 || (refreshKey !== undefined && refreshKey > 0)
        const response = workflowId
          ? await generationHistoryApi.getByWorkflow(workflowId, {
              limit: itemsPerPage,
              offset: 0,
              bustCache,
            })
          : await generationHistoryApi.getAll({
              service_type: serviceType,
              limit: itemsPerPage,
              offset: 0,
              bustCache,
            })

        const newRecords = response.records || []
        setHasMore(newRecords.length >= itemsPerPage)
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
  }, [itemsPerPage, localRefreshKey, refreshKey, serviceType, workflowId])

  const loadMoreData = useCallback(async () => {
    try {
      const nextPage = page + 1
      const response = workflowId
        ? await generationHistoryApi.getByWorkflow(workflowId, {
            limit: itemsPerPage,
            offset: (nextPage - 1) * itemsPerPage,
          })
        : await generationHistoryApi.getAll({
            service_type: serviceType,
            limit: itemsPerPage,
            offset: (nextPage - 1) * itemsPerPage,
          })

      const newRecords = response.records || []
      setHasMore(newRecords.length >= itemsPerPage)
      setRecords((previous) => [...previous, ...newRecords])
      setImageRecords((previous) => [...previous, ...convertHistoriesToImageRecords(newRecords)])
      setPage(nextPage)
    } catch (loadMoreError) {
      console.error('Failed to load more generation history:', loadMoreError)
      setHasMore(false)
    }
  }, [itemsPerPage, page, serviceType, workflowId])

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

  return (
    <Box sx={{ width: '100%', p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexShrink: 0 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('generationHistory:title')} ({imageRecords.length})
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title={t('common:refresh')}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={handleRefresh}>
              {t('common:refresh')}
            </Button>
          </Tooltip>
          <Tooltip title={t('generationHistory:cleanupFailedTooltip')}>
            <span>
              <Button
                variant="outlined"
                size="small"
                color="warning"
                startIcon={<CleaningServicesIcon />}
                onClick={() => setCleanupDialogOpen(true)}
                disabled={failedCount === 0 || cleanupLoading}
              >
                {t('generationHistory:cleanupFailedButton')} ({failedCount})
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ImageList
          images={imageRecords}
          loading={loading}
          selectable={true}
          selection={{ selectedIds, onSelectionChange: setSelectedIds }}
          contextId="generation_history"
          mode="infinite"
          infiniteScroll={{ hasMore, loadMore: loadMoreData }}
          total={imageRecords.length}
          onSearchClick={undefined}
        />
      </Box>

      <Dialog open={cleanupDialogOpen} onClose={() => setCleanupDialogOpen(false)}>
        <DialogTitle>{t('generationHistory:cleanupConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('generationHistory:cleanupConfirmMessage', { count: failedCount })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCleanupDialogOpen(false)}>{t('common:cancel')}</Button>
          <Button onClick={handleCleanupFailed} color="warning" variant="contained" disabled={cleanupLoading}>
            {cleanupLoading ? t('common:loading') : t('generationHistory:cleanupFailedButton')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

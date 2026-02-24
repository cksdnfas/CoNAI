import { useState } from 'react'
import { Alert, Box, CircularProgress, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import { Download, FolderOpen, Tags, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageRecord } from '@/types/image'
import GroupAssignModal from '@/features/image-groups/components/group-assign-modal'
import { useBulkActions } from '../hooks/use-bulk-actions'

interface BulkActionBarProps {
  selectedCount: number
  selectedIds: number[]
  selectedImages?: ImageRecord[]
  onSelectionClear: () => void
  onActionComplete?: (deletedIds?: string[]) => void
  onModalStateChange?: (isOpen: boolean) => void
}

export default function BulkActionBar({
  selectedCount,
  selectedIds,
  selectedImages = [],
  onSelectionClear,
  onActionComplete,
  onModalStateChange,
}: BulkActionBarProps) {
  const { t } = useTranslation(['common'])
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const { loading, error, deleteImages, downloadImages, assignToGroup, clearError } = useBulkActions()

  const handleSetGroupDialogOpen = (isOpen: boolean) => {
    setGroupDialogOpen(isOpen)
    if (onModalStateChange) {
      onModalStateChange(isOpen)
    }
  }

  const handleDelete = async () => {
    const hasVideo = selectedImages.some((img) => img.mime_type?.startsWith('video/'))
    const hasImage = selectedImages.some((img) => !img.mime_type?.startsWith('video/'))

    let confirmMessage: string
    if (hasVideo && hasImage) {
      confirmMessage = t('common:bulkActions.confirmDelete.mixed', { count: selectedCount })
    } else if (hasVideo) {
      confirmMessage = t('common:bulkActions.confirmDelete.videos', { count: selectedCount })
    } else if (hasImage) {
      confirmMessage = t('common:bulkActions.confirmDelete.images', { count: selectedCount })
    } else {
      confirmMessage = t('common:bulkActions.confirmDelete.files', { count: selectedCount })
    }

    if (!window.confirm(confirmMessage)) return

    const success = await deleteImages(selectedIds)
    if (success) {
      const deletedHashes = selectedImages
        .map((img) => img.composite_hash)
        .filter((hash): hash is string => hash !== null)

      if (onActionComplete) {
        onActionComplete(deletedHashes)
      }
    }
  }

  const handleDownload = async () => {
    const compositeHashes = selectedImages
      .map((img) => img.composite_hash)
      .filter((hash): hash is string => hash !== null)
    await downloadImages(compositeHashes)
  }

  const handleGroupAssign = async (groupId: number) => {
    const compositeHashes = selectedImages
      .map((img) => img.composite_hash)
      .filter((hash): hash is string => hash !== null)
    const success = await assignToGroup(compositeHashes, groupId)

    if (success) {
      handleSetGroupDialogOpen(false)
      onSelectionClear()
    }
  }

  const handleBatchTag = async () => {
    const compositeHashes = selectedImages
      .map((img) => img.composite_hash)
      .filter((hash): hash is string => hash !== null)

    if (compositeHashes.length === 0) return

    const confirmMessage =
      t('common:bulkActions.confirmBatchTag', { count: compositeHashes.length }) ||
      `태그를 생성하시겠습니까? (${compositeHashes.length}개 이미지)`

    if (!window.confirm(confirmMessage)) return

    try {
      const response = await fetch('/api/images/batch-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: compositeHashes }),
      })

      const result = (await response.json()) as { success?: boolean; error?: string; data?: { success_count?: number } }
      if (result.success) {
        alert(
          t('common:bulkActions.batchTagSuccess', { count: result.data?.success_count || 0 }) ||
            `${result.data?.success_count || 0}개 이미지 태그 생성 완료`,
        )
        onSelectionClear()
      } else {
        throw new Error(result.error || 'Batch tag failed')
      }
    } catch (batchError) {
      console.error('Batch tag error:', batchError)
      alert(t('common:bulkActions.batchTagError') || '배치 태그 생성 중 오류가 발생했습니다.')
    }
  }

  if (selectedCount === 0) return null

  return (
    <>
      <Paper
        className="no-drag-select"
        elevation={4}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        sx={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          p: 2,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          minWidth: 400,
        }}
      >
        <Typography variant="body1" sx={{ flexGrow: 1 }}>
          {t('common:bulkActions.selectedCountImages', { count: selectedCount })}
        </Typography>

        {loading ? <CircularProgress size={24} /> : null}

        <Tooltip title={t('common:bulkActions.tooltips.download')}>
          <IconButton onClick={handleDownload} disabled={loading} color="primary">
            <Download className="h-4 w-4" />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common:bulkActions.tooltips.addToGroup')}>
          <IconButton onClick={() => handleSetGroupDialogOpen(true)} disabled={loading} color="primary">
            <FolderOpen className="h-4 w-4" />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common:bulkActions.tooltips.batchTag') || '일괄 태그 생성'}>
          <IconButton onClick={handleBatchTag} disabled={loading} color="primary">
            <Tags className="h-4 w-4" />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common:bulkActions.tooltips.delete')}>
          <IconButton onClick={handleDelete} disabled={loading} color="error">
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common:bulkActions.tooltips.clearSelection')}>
          <IconButton onClick={onSelectionClear} size="small">
            <X className="h-4 w-4" />
          </IconButton>
        </Tooltip>
      </Paper>

      <GroupAssignModal
        open={groupDialogOpen}
        onClose={() => handleSetGroupDialogOpen(false)}
        selectedImageCount={selectedCount}
        onAssign={handleGroupAssign}
      />

      {error ? (
        <Box
          sx={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 1001,
            maxWidth: 400,
          }}
        >
          <Alert
            severity="error"
            onClose={clearError}
            action={
              <IconButton aria-label="close" color="inherit" size="small" onClick={clearError}>
                <X className="h-3.5 w-3.5" />
              </IconButton>
            }
          >
            {error}
          </Alert>
        </Box>
      ) : null}
    </>
  )
}

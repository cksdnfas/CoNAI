import { useState } from 'react'
import { AlertCircle, Download, FolderOpen, Loader2, Tags, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
    onModalStateChange?.(isOpen)
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
      const deletedHashes = selectedImages.map((img) => img.composite_hash).filter((hash): hash is string => hash !== null)
      onActionComplete?.(deletedHashes)
    }
  }

  const handleDownload = async () => {
    const compositeHashes = selectedImages.map((img) => img.composite_hash).filter((hash): hash is string => hash !== null)
    await downloadImages(compositeHashes)
  }

  const handleGroupAssign = async (groupId: number) => {
    const compositeHashes = selectedImages.map((img) => img.composite_hash).filter((hash): hash is string => hash !== null)
    const success = await assignToGroup(compositeHashes, groupId)

    if (success) {
      handleSetGroupDialogOpen(false)
      onSelectionClear()
    }
  }

  const handleBatchTag = async () => {
    const compositeHashes = selectedImages.map((img) => img.composite_hash).filter((hash): hash is string => hash !== null)

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
      <div
        className="no-drag-select fixed bottom-6 left-1/2 z-[1100] flex min-w-[400px] -translate-x-1/2 items-center gap-2 rounded-lg border bg-background p-2 shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="flex-1 text-sm">{t('common:bulkActions.selectedCountImages', { count: selectedCount })}</p>

        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}

        <Button type="button" variant="ghost" size="icon-sm" onClick={handleDownload} disabled={loading} title={t('common:bulkActions.tooltips.download')}>
          <Download className="h-4 w-4" />
        </Button>

        <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleSetGroupDialogOpen(true)} disabled={loading} title={t('common:bulkActions.tooltips.addToGroup')}>
          <FolderOpen className="h-4 w-4" />
        </Button>

        <Button type="button" variant="ghost" size="icon-sm" onClick={handleBatchTag} disabled={loading} title={t('common:bulkActions.tooltips.batchTag') || '일괄 태그 생성'}>
          <Tags className="h-4 w-4" />
        </Button>

        <Button type="button" variant="ghost" size="icon-sm" onClick={handleDelete} disabled={loading} title={t('common:bulkActions.tooltips.delete')}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>

        <Button type="button" variant="ghost" size="icon-sm" onClick={onSelectionClear} title={t('common:bulkActions.tooltips.clearSelection')}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <GroupAssignModal
        open={groupDialogOpen}
        onClose={() => handleSetGroupDialogOpen(false)}
        selectedImageCount={selectedCount}
        onAssign={handleGroupAssign}
      />

      {error ? (
        <div className="fixed top-6 right-6 z-[1001] max-w-[400px]">
          <Alert variant="destructive" className="pr-10">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
            <button
              type="button"
              aria-label="close"
              onClick={clearError}
              className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-black/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Alert>
        </div>
      ) : null}
    </>
  )
}

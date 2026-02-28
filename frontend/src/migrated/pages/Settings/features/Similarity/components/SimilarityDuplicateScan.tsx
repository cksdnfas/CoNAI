import React, { useState } from 'react'
import { Copy, Delete, Search, SquareCheckBig, SquareDashed } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DuplicateGroup } from '../../../../../services/similarityApi'
import { imageApi } from '../../../../../services/api'
import { getThumbnailUrl } from '../utils/similarityHelpers'

interface SimilarityDuplicateScanProps {
  duplicateGroups: DuplicateGroup[]
  scanLoading: boolean
  onScanDuplicates: () => void
  onImagesDeleted?: () => void
}

export const SimilarityDuplicateScan: React.FC<SimilarityDuplicateScanProps> = ({
  duplicateGroups,
  scanLoading,
  onScanDuplicates,
  onImagesDeleted,
}) => {
  const { t } = useTranslation('settings')
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleToggleImage = (fileId: number) => {
    setSelectedImages((previous) => {
      const next = new Set(previous)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }

  const handleToggleGroup = (group: DuplicateGroup, selectAll: boolean) => {
    setSelectedImages((previous) => {
      const next = new Set(previous)
      group.images.forEach((image) => {
        if (!image.file_id) return
        if (selectAll) {
          next.add(image.file_id)
        } else {
          next.delete(image.file_id)
        }
      })
      return next
    })
  }

  const handleSelectAllButOne = (group: DuplicateGroup) => {
    setSelectedImages((previous) => {
      const next = new Set(previous)
      group.images.slice(1).forEach((image) => {
        if (image.file_id) {
          next.add(image.file_id)
        }
      })
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (selectedImages.size === 0) return
    setDeleting(true)
    try {
      const fileIds = Array.from(selectedImages)
      const result = await imageApi.deleteImageFiles(fileIds)

      if (!result.success) {
        alert(result.error || t('similarity.duplicateScan.deleteError'))
      } else {
        const count = result.details?.deletedFiles?.length || fileIds.length
        alert(t('similarity.duplicateScan.deleteSuccess', { count }))
      }

      setSelectedImages(new Set())
      setDeleteDialogOpen(false)
      if (onImagesDeleted) {
        onImagesDeleted()
      }
    } catch {
      alert(t('similarity.duplicateScan.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  const isGroupFullySelected = (group: DuplicateGroup) =>
    group.images.every((image) => image.file_id && selectedImages.has(image.file_id))

  const isGroupPartiallySelected = (group: DuplicateGroup) =>
    group.images.some((image) => image.file_id && selectedImages.has(image.file_id)) && !isGroupFullySelected(group)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('similarity.duplicateScan.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">{t('similarity.duplicateScan.description')}</p>

        <div className="flex gap-2">
          <Button onClick={onScanDuplicates} disabled={scanLoading}>
            {scanLoading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" /> : <Search className="h-4 w-4" />}
            {scanLoading ? t('similarity.duplicateScan.scanning') : t('similarity.duplicateScan.scanButton')}
          </Button>

          {selectedImages.size > 0 ? (
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Delete className="h-4 w-4" />
              {t('similarity.duplicateScan.deleteSelected', { count: selectedImages.size })}
            </Button>
          ) : null}
        </div>

        {duplicateGroups.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-semibold">
              {t('similarity.duplicateScan.foundGroups', { count: duplicateGroups.length })}
            </div>

            {duplicateGroups.map((group) => (
              <details key={group.groupId} className="rounded-md border p-2">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Copy className="h-4 w-4" />
                    <span>{t('similarity.duplicateScan.groupLabel', { id: group.groupId, count: group.images.length })}</span>
                  </div>
                  <Badge>{t('similarity.duplicateScan.similarityLabel', { percent: group.similarity.toFixed(1) })}</Badge>
                </summary>

                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={isGroupFullySelected(group) ? 'default' : 'outline'}
                      onClick={() => handleToggleGroup(group, !isGroupFullySelected(group))}
                    >
                      <SquareCheckBig className="h-4 w-4" />
                      {t('similarity.duplicateScan.selectAll')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleSelectAllButOne(group)}>
                      {t('similarity.duplicateScan.keepOne')}
                    </Button>
                    {isGroupFullySelected(group) || isGroupPartiallySelected(group) ? (
                      <Button size="sm" variant="outline" onClick={() => handleToggleGroup(group, false)}>
                        <SquareDashed className="h-4 w-4" />
                        {t('similarity.duplicateScan.deselectAll')}
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5">
                    {group.images.map((image) => {
                      if (!image.file_id) return null
                      const selected = selectedImages.has(image.file_id)

                      return (
                        <button
                          key={`file-${image.file_id}`}
                          type="button"
                          className={`relative overflow-hidden rounded border text-left transition ${selected ? 'border-destructive ring-destructive/40 ring-2' : 'border-border'}`}
                          onClick={() => handleToggleImage(image.file_id as number)}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            readOnly
                            className="absolute top-1 right-1 z-10"
                          />
                          <img
                            src={getThumbnailUrl(image) || ''}
                            alt={image.original_file_path ?? ''}
                            className={`h-[150px] w-full object-cover ${selected ? 'opacity-60' : ''}`}
                          />
                          <div className="bg-background p-1 text-xs">
                            <div>ID: {image.file_id}</div>
                            <div>{image.width} x {image.height}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : !scanLoading ? (
          <Alert>
            <AlertDescription>{t('similarity.duplicateScan.noResults')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      <Dialog open={deleteDialogOpen} onOpenChange={(nextOpen) => (!deleting ? setDeleteDialogOpen(nextOpen) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('similarity.duplicateScan.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('similarity.duplicateScan.deleteConfirmMessage', { count: selectedImages.size })}
            </DialogDescription>
          </DialogHeader>

          <Alert variant="destructive">
            <AlertDescription>{t('similarity.duplicateScan.deleteWarning')}</AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              {t('similarity.duplicateScan.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteSelected()} disabled={deleting}>
              {deleting ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
              ) : (
                <Delete className="h-4 w-4" />
              )}
              {deleting ? t('similarity.duplicateScan.deleting') : t('similarity.duplicateScan.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type DeleteMode = 'orphan' | 'cascade'

interface GroupDeleteConfirmDialogProps {
  open: boolean
  group: GroupWithStats | null
  childCount: number
  onClose: () => void
  onConfirm: (cascade: boolean) => void
}

export const GroupDeleteConfirmDialog: React.FC<GroupDeleteConfirmDialogProps> = ({
  open,
  group,
  childCount,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation(['imageGroups', 'common'])
  const [deleteMode, setDeleteMode] = React.useState<DeleteMode>('orphan')

  const hasChildren = childCount > 0

  const handleConfirm = () => {
    onConfirm(deleteMode === 'cascade')
  }

  if (!group) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('imageGroups:deleteConfirm.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm">{t('imageGroups:deleteConfirm.message', { name: group.name })}</p>

          <div className="bg-muted rounded-md p-3 text-sm text-muted-foreground">
            <p>{t('imageGroups:deleteConfirm.groupInfo.imageCount', { count: group.image_count })}</p>
            {hasChildren ? <p>{t('imageGroups:deleteConfirm.groupInfo.childCount', { count: childCount })}</p> : null}
          </div>

          <Alert>{t('imageGroups:deleteConfirm.warning.imageAssociations')}</Alert>

          {hasChildren ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">{t('imageGroups:deleteConfirm.options.title')}</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
                <input
                  type="radio"
                  name="deleteMode"
                  value="orphan"
                  checked={deleteMode === 'orphan'}
                  onChange={(event) => setDeleteMode(event.target.value as DeleteMode)}
                />
                <span>
                  <span className="block text-sm">{t('imageGroups:deleteConfirm.options.orphan.label')}</span>
                  <span className="block text-xs text-muted-foreground">{t('imageGroups:deleteConfirm.options.orphan.description')}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
                <input
                  type="radio"
                  name="deleteMode"
                  value="cascade"
                  checked={deleteMode === 'cascade'}
                  onChange={(event) => setDeleteMode(event.target.value as DeleteMode)}
                />
                <span>
                  <span className="block text-sm text-destructive">{t('imageGroups:deleteConfirm.options.cascade.label')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('imageGroups:deleteConfirm.options.cascade.description', { count: childCount })}
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>{t('common:delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

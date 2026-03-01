import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAllGroupsWithHierarchy } from '@/hooks/use-groups'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

interface GroupAssignModalProps {
  open: boolean
  onClose: () => void
  selectedImageCount: number
  onAssign: (groupId: number) => void | Promise<void>
  currentGroupId?: number
}

const GroupAssignModal: React.FC<GroupAssignModalProps> = ({
  open,
  onClose,
  selectedImageCount,
  onAssign,
  currentGroupId,
}) => {
  const { t } = useTranslation(['common', 'imageGroups'])
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)

  const { data: groups = [], isLoading, error: queryError } = useAllGroupsWithHierarchy()
  const error = queryError ? t('imageGroups:assignModal.loadError') : null

  const assignableGroups = useMemo(() => {
    return groups
      .filter((group) => group.id !== currentGroupId)
      .sort((a, b) => {
        const depthDiff = (a.depth ?? 0) - (b.depth ?? 0)
        if (depthDiff !== 0) return depthDiff
        return a.name.localeCompare(b.name)
      })
  }, [currentGroupId, groups])

  const handleAssign = async () => {
    if (!selectedGroupId) return
    await onAssign(selectedGroupId)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('imageGroups:assignModal.title')}</DialogTitle>
          <DialogDescription>{t('imageGroups:assignModal.description', { count: selectedImageCount })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error ? <Alert>{error}</Alert> : null}

          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : assignableGroups.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">{t('imageGroups:assignModal.emptyGroups')}</div>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="assign-group-select">
                {t('imageGroups:assignModal.title')}
              </label>
              <select
                id="assign-group-select"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={selectedGroupId ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectedGroupId(value === '' ? null : Number(value))
                }}
              >
                <option value="">{t('imageGroups:assignModal.selectPlaceholder', 'Select group')}</option>
                {assignableGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.depth && group.depth > 0 ? `${'-- '.repeat(group.depth)}` : ''}
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('imageGroups:assignModal.buttonCancel')}</Button>
          <Button type="button" onClick={handleAssign} disabled={!selectedGroupId}>{t('imageGroups:assignModal.buttonAssign')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default GroupAssignModal

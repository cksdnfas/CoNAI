import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WildcardWithItems } from '@/services/wildcard-api'

interface WildcardDeleteConfirmDialogProps {
  open: boolean
  wildcard: WildcardWithItems | null
  childCount: number
  onClose: () => void
  onConfirm: (cascade: boolean) => void
}

export function WildcardDeleteConfirmDialog({
  open,
  wildcard,
  childCount,
  onClose,
  onConfirm,
}: WildcardDeleteConfirmDialogProps) {
  const [deleteMode, setDeleteMode] = useState<'moveUp' | 'cascade'>('moveUp')

  if (!wildcard) {
    return null
  }

  const hasChildren = childCount > 0

  const handleConfirm = () => {
    onConfirm(deleteMode === 'cascade')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm Wildcard Deletion</DialogTitle>
          <DialogDescription>Are you sure you want to delete '{wildcard.name}' wildcard?</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="bg-muted rounded-md p-3 text-sm">
            <p>Items: {wildcard.items.length}</p>
            {hasChildren ? <p>Child wildcards: {childCount}</p> : null}
          </div>

          {hasChildren ? (
            <>
              <Alert>
                <AlertTitle>This wildcard has child wildcards.</AlertTitle>
                <AlertDescription>Choose whether to move children up or delete everything.</AlertDescription>
              </Alert>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Choose deletion option:</legend>
                <label className="flex items-start gap-2 rounded border p-2 text-sm">
                  <input
                    type="radio"
                    name="delete-mode"
                    value="moveUp"
                    checked={deleteMode === 'moveUp'}
                    onChange={() => setDeleteMode('moveUp')}
                  />
                  <span>
                    <strong>Delete this item only</strong>
                    <span className="text-muted-foreground block">Child wildcards will move one level up</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded border p-2 text-sm">
                  <input
                    type="radio"
                    name="delete-mode"
                    value="cascade"
                    checked={deleteMode === 'cascade'}
                    onChange={() => setDeleteMode('cascade')}
                  />
                  <span>
                    <strong className="text-destructive">Delete with children</strong>
                    <span className="text-muted-foreground block">{childCount} child wildcard(s) will also be deleted</span>
                  </span>
                </label>
              </fieldset>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>This action cannot be undone.</AlertTitle>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

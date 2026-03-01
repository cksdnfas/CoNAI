import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface LoraDatasetDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (captionMode: 'auto_tags' | 'merged') => void
}

const LoraDatasetDialog: React.FC<LoraDatasetDialogProps> = ({
  open,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation(['imageGroups', 'common'])
  const [mergePrompt, setMergePrompt] = useState(true)

  const handleConfirm = () => {
    onConfirm(mergePrompt ? 'merged' : 'auto_tags')
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('imageGroups:download.loraDatasetTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('imageGroups:download.loraDatasetDescription')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mergePrompt}
              onChange={(event) => setMergePrompt(event.target.checked)}
            />
            <span>{t('imageGroups:download.loraDatasetMergePrompt')}</span>
          </label>
          <p className="pl-5 text-xs text-muted-foreground">{t('imageGroups:download.loraDatasetMergePromptHelp')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common:buttons.cancel')}</Button>
          <Button type="button" onClick={handleConfirm}>{t('imageGroups:download.confirmButton')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default LoraDatasetDialog

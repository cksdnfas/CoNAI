import React, { useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('imageGroups:download.loraDatasetTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('imageGroups:download.loraDatasetDescription')}
        </Typography>
        <FormControlLabel
          control={<Checkbox checked={mergePrompt} onChange={(event) => setMergePrompt(event.target.checked)} />}
          label={t('imageGroups:download.loraDatasetMergePrompt')}
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
          {t('imageGroups:download.loraDatasetMergePromptHelp')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button onClick={handleConfirm} variant="contained" color="primary">
          {t('imageGroups:download.confirmButton')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default LoraDatasetDialog

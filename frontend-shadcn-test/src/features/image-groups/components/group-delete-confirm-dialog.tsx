import React from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'

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
  const [deleteMode, setDeleteMode] = React.useState<'orphan' | 'cascade'>('orphan')

  const hasChildren = childCount > 0

  const handleConfirm = () => {
    onConfirm(deleteMode === 'cascade')
  }

  if (!group) return null

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('imageGroups:deleteConfirm.title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body1" gutterBottom>
            {t('imageGroups:deleteConfirm.message', { name: group.name })}
          </Typography>
        </Box>

        <Box sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('imageGroups:deleteConfirm.groupInfo.imageCount', { count: group.image_count })}
          </Typography>
          {hasChildren ? (
            <Typography variant="body2" color="text.secondary">
              {t('imageGroups:deleteConfirm.groupInfo.childCount', { count: childCount })}
            </Typography>
          ) : null}
        </Box>

        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('imageGroups:deleteConfirm.warning.imageAssociations')}
        </Alert>

        {hasChildren ? (
          <FormControl component="fieldset" fullWidth>
            <Typography variant="subtitle2" gutterBottom>
              {t('imageGroups:deleteConfirm.options.title')}
            </Typography>
            <RadioGroup value={deleteMode} onChange={(event) => setDeleteMode(event.target.value as 'orphan' | 'cascade')}>
              <FormControlLabel
                value="orphan"
                control={<Radio />}
                label={
                  <Box>
                    <Typography variant="body2">{t('imageGroups:deleteConfirm.options.orphan.label')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('imageGroups:deleteConfirm.options.orphan.description')}
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="cascade"
                control={<Radio color="error" />}
                label={
                  <Box>
                    <Typography variant="body2" color="error">
                      {t('imageGroups:deleteConfirm.options.cascade.label')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('imageGroups:deleteConfirm.options.cascade.description', { count: childCount })}
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>
          </FormControl>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={handleConfirm} color="error" variant="contained">
          {t('common:delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

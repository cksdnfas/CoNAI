import React, { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useAllGroupsWithHierarchy } from '@/hooks/use-groups'

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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('imageGroups:assignModal.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('imageGroups:assignModal.description', { count: selectedImageCount })}
        </DialogContentText>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : assignableGroups.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">{t('imageGroups:assignModal.emptyGroups')}</Typography>
          </Box>
        ) : (
          <TextField
            select
            fullWidth
            label={t('imageGroups:assignModal.title')}
            value={selectedGroupId ?? ''}
            onChange={(event) => {
              const value = event.target.value
              setSelectedGroupId(value === '' ? null : Number(value))
            }}
          >
            <MenuItem value="">{t('imageGroups:assignModal.selectPlaceholder', 'Select group')}</MenuItem>
            {assignableGroups.map((group) => (
              <MenuItem key={group.id} value={group.id}>
                {group.depth && group.depth > 0 ? `${'-- '.repeat(group.depth)}` : ''}
                {group.name}
              </MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('imageGroups:assignModal.buttonCancel')}</Button>
        <Button onClick={handleAssign} color="primary" variant="contained" disabled={!selectedGroupId}>
          {t('imageGroups:assignModal.buttonAssign')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default GroupAssignModal

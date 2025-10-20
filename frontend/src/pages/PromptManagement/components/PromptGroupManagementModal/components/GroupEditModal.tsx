import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Box,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { EditingGroup } from '../hooks/useGroupManagement';

interface GroupEditModalProps {
  open: boolean;
  editingGroup: EditingGroup | null;
  onUpdate: (updates: Partial<EditingGroup>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export const GroupEditModal: React.FC<GroupEditModalProps> = ({
  open,
  editingGroup,
  onUpdate,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation('promptManagement');

  if (!editingGroup) return null;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        {editingGroup.id
          ? t('groupManagement.editForm.titleEdit')
          : t('groupManagement.editForm.titleAdd')}
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label={t('groupManagement.editForm.groupName.label')}
            fullWidth
            value={editingGroup.group_name}
            onChange={(e) => onUpdate({ group_name: e.target.value })}
            autoFocus
          />

          <TextField
            label={t('groupManagement.editForm.displayOrder.label')}
            type="number"
            value={editingGroup.display_order}
            onChange={(e) => onUpdate({ display_order: parseInt(e.target.value) || 0 })}
            sx={{ width: 150 }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={editingGroup.is_visible}
                onChange={(e) => onUpdate({ is_visible: e.target.checked })}
              />
            }
            label={t('groupManagement.editForm.visibility.label')}
          />
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onCancel}>
          {t('groupManagement.editForm.actions.cancel')}
        </Button>
        <Button onClick={onSave} variant="contained">
          {t('groupManagement.editForm.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

import React from 'react';
import { DialogActions, Button, CircularProgress } from '@mui/material';
import { Save } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface BottomActionsProps {
  saving: boolean;
  imageLoaded: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export const BottomActions: React.FC<BottomActionsProps> = ({
  saving,
  imageLoaded,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation('common');

  return (
    <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2 }}>
      <Button onClick={onCancel} disabled={saving}>
        {t('buttons.cancel')}
      </Button>
      <Button
        onClick={onSave}
        variant="contained"
        startIcon={saving ? <CircularProgress size={16} /> : <Save />}
        disabled={saving || !imageLoaded}
      >
        {saving ? t('messages.saving') : t('buttons.save')}
      </Button>
    </DialogActions>
  );
};

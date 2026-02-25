import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { CustomResolution } from '../types/nai.types';

interface CustomResolutionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (resolution: Omit<CustomResolution, 'id'>) => void;
  editResolution?: CustomResolution;
}

export default function CustomResolutionDialog({
  open,
  onClose,
  onSave,
  editResolution
}: CustomResolutionDialogProps) {
  const { t } = useTranslation('imageGeneration');
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [errors, setErrors] = useState<{ name?: string; width?: string; height?: string }>({});

  useEffect(() => {
    if (editResolution) {
      setName(editResolution.name);
      setWidth(editResolution.width.toString());
      setHeight(editResolution.height.toString());
    } else {
      setName('');
      setWidth('');
      setHeight('');
    }
    setErrors({});
  }, [editResolution, open]);

  const validate = () => {
    const newErrors: typeof errors = {};

    if (!name.trim()) {
      newErrors.name = t('nai.resolution.customDialog.nameRequired');
    }

    const widthNum = parseInt(width);
    if (!width || isNaN(widthNum) || widthNum < 64 || widthNum > 2048) {
      newErrors.width = t('nai.resolution.customDialog.widthInvalid');
    }

    const heightNum = parseInt(height);
    if (!height || isNaN(heightNum) || heightNum < 64 || heightNum > 2048) {
      newErrors.height = t('nai.resolution.customDialog.heightInvalid');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validate()) {
      onSave({
        name: name.trim(),
        width: parseInt(width),
        height: parseInt(height)
      });
      onClose();
    }
  };

  const handleClose = () => {
    setErrors({});
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {editResolution
          ? t('nai.resolution.customDialog.editTitle')
          : t('nai.resolution.customDialog.addTitle')}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={12}>
            <TextField
              fullWidth
              label={t('nai.resolution.customDialog.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={!!errors.name}
              helperText={errors.name}
              placeholder={t('nai.resolution.customDialog.namePlaceholder')}
            />
          </Grid>
          <Grid size={6}>
            <TextField
              fullWidth
              type="number"
              label={t('nai.resolution.customDialog.width')}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              error={!!errors.width}
              helperText={errors.width}
              inputProps={{ min: 64, max: 2048, step: 64 }}
            />
          </Grid>
          <Grid size={6}>
            <TextField
              fullWidth
              type="number"
              label={t('nai.resolution.customDialog.height')}
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              error={!!errors.height}
              helperText={errors.height}
              inputProps={{ min: 64, max: 2048, step: 64 }}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('nai.resolution.customDialog.cancel')}</Button>
        <Button onClick={handleSave} variant="contained">
          {t('nai.resolution.customDialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

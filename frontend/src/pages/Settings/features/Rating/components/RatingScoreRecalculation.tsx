import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Stack,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import axios from 'axios';

export const RatingScoreRecalculation: React.FC = () => {
  const { t } = useTranslation('settings');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleRecalculate = async () => {
    setConfirmDialog(false);
    setProcessing(true);
    setError(null);
    setSuccessMessage(null);
    setProgress(0);
    setTotal(0);

    try {
      const response = await axios.post('/api/images/recalculate-rating-scores');

      if (response.data.success) {
        const { total, success_count, fail_count } = response.data.data;
        setTotal(total);
        setProgress(total);
        setSuccessMessage(
          t('rating.recalculation.success', {
            total,
            success: success_count,
            failed: fail_count,
          })
        );
      } else {
        setError(response.data.error || t('rating.recalculation.failed'));
      }
    } catch (err: any) {
      console.error('[RatingScoreRecalculation] Error:', err);
      setError(err.response?.data?.error || t('rating.recalculation.failed'));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('rating.recalculation.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        {t('rating.recalculation.description')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}

      {processing && total > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" gutterBottom>
            {t('rating.recalculation.progress', { current: progress, total })}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={(progress / total) * 100}
          />
        </Box>
      )}

      <Stack spacing={2}>
        <Button
          variant="contained"
          color="primary"
          startIcon={processing ? <CircularProgress size={20} /> : <RefreshIcon />}
          onClick={() => setConfirmDialog(true)}
          disabled={processing}
          fullWidth
        >
          {processing
            ? t('rating.recalculation.buttons.processing')
            : t('rating.recalculation.buttons.recalculate')}
        </Button>
      </Stack>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog} onClose={() => setConfirmDialog(false)}>
        <DialogTitle>{t('rating.recalculation.confirmDialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('rating.recalculation.confirmDialog.message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(false)}>
            {t('rating.recalculation.confirmDialog.cancel')}
          </Button>
          <Button onClick={handleRecalculate} color="primary" variant="contained">
            {t('rating.recalculation.confirmDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

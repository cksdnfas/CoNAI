import React from 'react';
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
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface TaggerBatchOperationsProps {
  batchProcessing: boolean;
  batchProgress: number;
  batchTotal: number;
  untaggedCount: number | null;
  confirmDialog: boolean;
  onBatchTagUnprocessed: () => void;
  onBatchTagAll: () => void;
  onSetConfirmDialog: (open: boolean) => void;
}

export const TaggerBatchOperations: React.FC<TaggerBatchOperationsProps> = ({
  batchProcessing,
  batchProgress,
  batchTotal,
  untaggedCount,
  confirmDialog,
  onBatchTagUnprocessed,
  onBatchTagAll,
  onSetConfirmDialog,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('tagger.batch.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        {t('tagger.batch.description')}
      </Typography>

      {untaggedCount !== null && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('tagger.batch.untaggedCount', { count: untaggedCount })}
        </Alert>
      )}

      {batchProcessing && batchTotal > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" gutterBottom>
            {t('tagger.batch.progress', { current: batchProgress, total: batchTotal })}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={(batchProgress / batchTotal) * 100}
          />
        </Box>
      )}

      <Stack spacing={2}>
        <Button
          variant="contained"
          startIcon={batchProcessing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
          onClick={onBatchTagUnprocessed}
          disabled={batchProcessing}
          fullWidth
        >
          {batchProcessing ? t('tagger.batch.buttons.processing') : t('tagger.batch.buttons.tagUnprocessed')}
        </Button>

        <Button
          variant="outlined"
          color="warning"
          startIcon={batchProcessing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
          onClick={() => onSetConfirmDialog(true)}
          disabled={batchProcessing}
          fullWidth
        >
          {t('tagger.batch.buttons.tagAll')}
        </Button>
      </Stack>

      {/* Confirmation Dialog for Batch Tag All */}
      <Dialog open={confirmDialog} onClose={() => onSetConfirmDialog(false)}>
        <DialogTitle>{t('tagger.batch.confirmDialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('tagger.batch.confirmDialog.message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => onSetConfirmDialog(false)}>{t('tagger.batch.confirmDialog.cancel')}</Button>
          <Button onClick={onBatchTagAll} color="warning" variant="contained">
            {t('tagger.batch.confirmDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

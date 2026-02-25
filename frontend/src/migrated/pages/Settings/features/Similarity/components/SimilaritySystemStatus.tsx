import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Stack,
  LinearProgress,
  FormControlLabel,
  Switch,
  Box,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { SimilarityStats } from '../../../../../services/similarityApi';

interface SimilaritySystemStatusProps {
  stats: SimilarityStats | null;
  rebuilding: boolean;
  rebuildProgress: number;
  rebuildProcessed: number;
  rebuildTotal: number;
  autoGenerateHash: boolean;
  onAutoGenerateHashChange: (checked: boolean) => void;
  onRebuildHashes: () => void;
  onRefreshStats: () => void;
}

export const SimilaritySystemStatus: React.FC<SimilaritySystemStatusProps> = ({
  stats,
  rebuilding,
  rebuildProgress,
  rebuildProcessed,
  rebuildTotal,
  autoGenerateHash,
  onAutoGenerateHashChange,
  onRebuildHashes,
  onRefreshStats,
}) => {
  const { t } = useTranslation('settings');

  if (!stats) {
    return <CircularProgress />;
  }

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t('similarity.systemStatus.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('similarity.systemStatus.description')}
        </Typography>

        <Stack spacing={2}>
          <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
            <Chip
              label={t('similarity.systemStatus.totalImages', { count: stats.totalImages })}
              color="primary"
              variant="outlined"
            />
            <Chip
              label={t('similarity.systemStatus.withHash', { count: stats.imagesWithHash })}
              color="success"
              icon={<CheckCircleIcon />}
            />
            <Chip
              label={t('similarity.systemStatus.withoutHash', { count: stats.imagesWithoutHash })}
              color="warning"
            />
            <Chip
              label={t('similarity.systemStatus.completion', { percent: stats.completionPercentage })}
              color={stats.completionPercentage === 100 ? 'success' : 'info'}
            />
          </Stack>

          {rebuilding && (
            <Box>
              <Typography variant="body2" gutterBottom>
                {t('similarity.systemStatus.rebuildProgress', {
                  processed: rebuildProcessed,
                  total: rebuildTotal,
                  percent: rebuildProgress.toFixed(0)
                })}
              </Typography>
              <LinearProgress variant="determinate" value={rebuildProgress} />
            </Box>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={autoGenerateHash}
                onChange={(e) => onAutoGenerateHashChange(e.target.checked)}
                color="primary"
              />
            }
            label={t('similarity.systemStatus.autoGenerateHash')}
          />

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              startIcon={rebuilding ? <CircularProgress size={20} /> : <RefreshIcon />}
              onClick={onRebuildHashes}
              disabled={rebuilding || stats.imagesWithoutHash === 0}
            >
              {rebuilding ? t('similarity.systemStatus.rebuildingButton') : t('similarity.systemStatus.rebuildButton', { count: stats.imagesWithoutHash })}
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={onRefreshStats}
            >
              {t('similarity.systemStatus.refreshButton')}
            </Button>
          </Stack>

          {stats.imagesWithoutHash === 0 && (
            <Tooltip title={t('similarity.systemStatus.allComplete')} arrow>
              <Chip
                icon={<CheckCircleIcon />}
                label={t('similarity.systemStatus.allCompleteShort')}
                color="success"
                size="small"
              />
            </Tooltip>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

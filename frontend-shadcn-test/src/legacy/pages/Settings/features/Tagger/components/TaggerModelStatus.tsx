import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Stack,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  CloudUpload as CloudUploadIcon,
  CloudOff as CloudOffIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { TaggerServerStatus, TaggerModel } from '../../../../../services/settingsApi';
import { formatRelativeTime } from '../utils/taggerHelpers';

interface TaggerModelStatusProps {
  modelStatus: TaggerServerStatus | null;
  statusLoading: boolean;
  models: TaggerModel[];
  loading: boolean;
  onLoadModel: () => void;
  onUnloadModel: () => void;
  onRefreshStatus: () => void;
}

export const TaggerModelStatus: React.FC<TaggerModelStatusProps> = ({
  modelStatus,
  statusLoading,
  models,
  loading,
  onLoadModel,
  onUnloadModel,
  onRefreshStatus,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.default' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box flex={1}>
            <Typography variant="subtitle1" gutterBottom>
              {t('tagger.modelStatus.title')}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Chip
                label={modelStatus?.modelLoaded ? t('tagger.modelStatus.loaded') : t('tagger.modelStatus.unloaded')}
                color={modelStatus?.modelLoaded ? 'success' : 'default'}
                size="small"
                icon={modelStatus?.modelLoaded ? <CheckCircleIcon /> : undefined}
              />
              {modelStatus?.currentModel && (
                <Chip
                  label={models.find(m => m.name === modelStatus.currentModel)?.label || modelStatus.currentModel}
                  size="small"
                  variant="outlined"
                />
              )}
              {modelStatus?.currentDevice && (
                <Chip
                  label={modelStatus.currentDevice}
                  size="small"
                  color={modelStatus.currentDevice.includes('cuda') ? 'success' : 'default'}
                  variant="outlined"
                />
              )}
              {statusLoading && <CircularProgress size={16} />}
            </Stack>
            {modelStatus?.lastUsedAt && (
              <Typography variant="caption" color="text.secondary">
                {t('tagger.modelStatus.lastUsed')}: {formatRelativeTime(modelStatus.lastUsedAt, t)}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              onClick={onLoadModel}
              disabled={modelStatus?.modelLoaded || loading}
              startIcon={<CloudUploadIcon />}
              size="small"
            >
              {t('tagger.buttons.load')}
            </Button>
            <Button
              onClick={onUnloadModel}
              disabled={!modelStatus?.modelLoaded || loading}
              startIcon={<CloudOffIcon />}
              color="warning"
              size="small"
            >
              {t('tagger.buttons.unload')}
            </Button>
            <Button
              onClick={onRefreshStatus}
              disabled={statusLoading}
              startIcon={<RefreshIcon />}
              size="small"
              variant="outlined"
            >
              {t('tagger.buttons.refresh')}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

import React from 'react';
import {
  Box,
  FormControlLabel,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  TextField,
  Typography,
  Stack,
  Chip,
  CircularProgress,
  Button,
  Tooltip,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  CloudDownload as CloudDownloadIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { TaggerSettings, TaggerModel, TaggerDevice } from '../../../../../services/settingsApi';

interface TaggerConfigFormProps {
  localSettings: TaggerSettings;
  models: TaggerModel[];
  onUpdateSettings: (updates: Partial<TaggerSettings>) => void;
  onDownloadModel: () => void;
  onRefreshModels: () => void;
  downloading: boolean;
}

export const TaggerConfigForm: React.FC<TaggerConfigFormProps> = ({
  localSettings,
  models,
  onUpdateSettings,
  onDownloadModel,
  onRefreshModels,
  downloading,
}) => {
  const { t } = useTranslation('settings');
  const currentModel = models.find(m => m.name === localSettings.model);
  const isModelDownloaded = currentModel?.downloaded || false;

  return (
    <Stack spacing={3}>
      {/* Enable Auto-Tagging */}
      <FormControlLabel
        control={
          <Switch
            checked={localSettings.enabled}
            onChange={(e) => onUpdateSettings({ enabled: e.target.checked })}
          />
        }
        label={t('tagger.enableAutoTagging')}
      />

      {/* Model Selection */}
      {models.length > 0 ? (
        <FormControl fullWidth disabled={!localSettings.enabled}>
          <InputLabel>{t('tagger.model.label')}</InputLabel>
          <Select
            value={localSettings.model}
            label={t('tagger.model.label')}
            onChange={(e) => onUpdateSettings({ model: e.target.value as any })}
          >
            {models.map((model) => (
              <MenuItem key={model.name} value={model.name}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <Box>
                    <Typography variant="body1">{model.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {model.description}
                    </Typography>
                  </Box>
                  {model.downloaded && (
                    <Chip
                      size="small"
                      icon={<CheckCircleIcon />}
                      label={t('tagger.model.downloaded')}
                      color="success"
                      sx={{ ml: 2 }}
                    />
                  )}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">{t('tagger.model.loading')}</Typography>
        </Box>
      )}

      {/* Device Selection */}
      <FormControl fullWidth disabled={!localSettings.enabled}>
        <InputLabel>{t('tagger.device.label')}</InputLabel>
        <Select
          value={localSettings.device}
          label={t('tagger.device.label')}
          onChange={(e) => onUpdateSettings({ device: e.target.value as TaggerDevice })}
        >
          <MenuItem value="auto">
            <Box>
              <Typography variant="body1">{t('tagger.device.auto.title')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('tagger.device.auto.description')}
              </Typography>
            </Box>
          </MenuItem>
          <MenuItem value="cpu">
            <Box>
              <Typography variant="body1">{t('tagger.device.cpu.title')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('tagger.device.cpu.description')}
              </Typography>
            </Box>
          </MenuItem>
          <MenuItem value="cuda">
            <Box>
              <Typography variant="body1">{t('tagger.device.cuda.title')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('tagger.device.cuda.description')}
              </Typography>
            </Box>
          </MenuItem>
        </Select>
      </FormControl>

      {/* Download Status and Button */}
      {localSettings.enabled && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
            <Chip
              icon={isModelDownloaded ? <CheckCircleIcon /> : <InfoIcon />}
              label={
                isModelDownloaded
                  ? t('tagger.status.downloaded')
                  : t('tagger.status.notDownloaded')
              }
              color={isModelDownloaded ? 'success' : 'warning'}
              size="small"
            />
            <Tooltip
              title={
                isModelDownloaded
                  ? t('tagger.alerts.modelDownloaded', { model: currentModel?.label })
                  : t('tagger.alerts.modelNotDownloaded', { model: currentModel?.label })
              }
              arrow
            >
              <InfoIcon fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} />
            </Tooltip>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={downloading ? <CircularProgress size={20} /> : <CloudDownloadIcon />}
              onClick={onDownloadModel}
              disabled={downloading || isModelDownloaded}
            >
              {downloading ? t('tagger.buttons.downloading') : t('tagger.buttons.download')}
            </Button>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={onRefreshModels}
            >
              {t('tagger.buttons.refreshStatus')}
            </Button>
          </Stack>
        </Box>
      )}

      {/* General Threshold */}
      <Box>
        <Typography gutterBottom>
          {t('tagger.threshold.general.label', { value: localSettings.generalThreshold.toFixed(2) })}
        </Typography>
        <Slider
          value={localSettings.generalThreshold}
          onChange={(_, value) => onUpdateSettings({ generalThreshold: value as number })}
          min={0}
          max={1}
          step={0.05}
          marks={[
            { value: 0, label: '0.0' },
            { value: 0.5, label: '0.5' },
            { value: 1, label: '1.0' },
          ]}
          disabled={!localSettings.enabled}
        />
        <Typography variant="caption" color="text.secondary">
          {t('tagger.threshold.general.description')}
        </Typography>
      </Box>

      {/* Character Threshold */}
      <Box>
        <Typography gutterBottom>
          {t('tagger.threshold.character.label', { value: localSettings.characterThreshold.toFixed(2) })}
        </Typography>
        <Slider
          value={localSettings.characterThreshold}
          onChange={(_, value) => onUpdateSettings({ characterThreshold: value as number })}
          min={0}
          max={1}
          step={0.05}
          marks={[
            { value: 0, label: '0.0' },
            { value: 0.5, label: '0.5' },
            { value: 1, label: '1.0' },
          ]}
          disabled={!localSettings.enabled}
        />
        <Typography variant="caption" color="text.secondary">
          {t('tagger.threshold.character.description')}
        </Typography>
      </Box>

      {/* Python Path */}
      <TextField
        label={t('tagger.pythonPath.label')}
        value={localSettings.pythonPath}
        onChange={(e) => onUpdateSettings({ pythonPath: e.target.value })}
        fullWidth
        disabled={!localSettings.enabled}
        helperText={t('tagger.pythonPath.helper')}
      />
    </Stack>
  );
};

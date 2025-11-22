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
  Typography,
  Stack,
  Chip,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { TaggerSettings, TaggerModel, TaggerDevice } from '../../../../../services/settingsApi';

interface TaggerConfigFormProps {
  localSettings: TaggerSettings;
  models: TaggerModel[];
  onUpdateSettings: (updates: Partial<TaggerSettings>) => void;
}

export const TaggerConfigForm: React.FC<TaggerConfigFormProps> = ({
  localSettings,
  models,
  onUpdateSettings,
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
                    <Typography variant="body1">{t(`tagger.model.${model.name}.label`)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(`tagger.model.${model.name}.description`)}
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

      {/* Download Status */}
      {localSettings.enabled && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                ? t('tagger.alerts.modelDownloaded', {
                    model: currentModel ? t(`tagger.model.${currentModel.name}.label`) : ''
                  })
                : t('tagger.alerts.modelNotDownloaded', {
                    model: currentModel ? t(`tagger.model.${currentModel.name}.label`) : ''
                  })
            }
            arrow
          >
            <InfoIcon fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Box>
      )}

      {/* General Threshold */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography>
            {t('tagger.threshold.general.label', { value: localSettings.generalThreshold.toFixed(2) })}
          </Typography>
          <Tooltip title={t('tagger.threshold.general.description')} arrow>
            <InfoIcon fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Box>
        <Box sx={{ width: '90%', mx: 'auto' }}>
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
        </Box>
      </Box>

      {/* Character Threshold */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography>
            {t('tagger.threshold.character.label', { value: localSettings.characterThreshold.toFixed(2) })}
          </Typography>
          <Tooltip title={t('tagger.threshold.character.description')} arrow>
            <InfoIcon fontSize="small" sx={{ color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Box>
        <Box sx={{ width: '90%', mx: 'auto' }}>
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
        </Box>
      </Box>
    </Stack>
  );
};

import React, { useState } from 'react';
import {
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Switch,
  Typography,
  Paper,
  Alert,
  Button,
  Divider,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { MetadataExtractionSettings, StealthScanMode } from '../../../services/settingsApi';

interface MetadataSettingsProps {
  settings: MetadataExtractionSettings;
  onUpdate: (settings: Partial<MetadataExtractionSettings>) => Promise<void>;
}

const MetadataSettings: React.FC<MetadataSettingsProps> = ({ settings, onUpdate }) => {
  const { t } = useTranslation('settings');
  const [localSettings, setLocalSettings] = useState<MetadataExtractionSettings>(settings);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setUpdating(true);
    setError(null);

    try {
      await onUpdate(localSettings);
    } catch (err) {
      console.error('Failed to update metadata settings:', err);
      setError(t('messages.saveFailed'));
    } finally {
      setUpdating(false);
    }
  };

  const handleScanModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSettings({
      ...localSettings,
      stealthScanMode: event.target.value as StealthScanMode,
    });
  };

  const handleFileSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    if (!isNaN(value) && value > 0) {
      setLocalSettings({
        ...localSettings,
        stealthMaxFileSizeMB: value,
      });
    }
  };

  const handleResolutionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    if (!isNaN(value) && value > 0) {
      setLocalSettings({
        ...localSettings,
        stealthMaxResolutionMP: value,
      });
    }
  };

  const handleToggle = (field: keyof MetadataExtractionSettings) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSettings({
      ...localSettings,
      [field]: event.target.checked,
    });
  };

  const hasChanges = JSON.stringify(localSettings) !== JSON.stringify(settings);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('metadata.title')}
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('metadata.description')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        {/* Scan Mode */}
        <FormControl component="fieldset" fullWidth sx={{ mb: 3 }}>
          <FormLabel component="legend">
            <Typography variant="subtitle1" gutterBottom>
              {t('metadata.scanMode.title')}
            </Typography>
          </FormLabel>
          <RadioGroup
            value={localSettings.stealthScanMode}
            onChange={handleScanModeChange}
          >
            <FormControlLabel
              value="fast"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1">{t('metadata.scanMode.fast.label')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('metadata.scanMode.fast.description')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="full"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1">{t('metadata.scanMode.full.label')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('metadata.scanMode.full.description')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="skip"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1">{t('metadata.scanMode.skip.label')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('metadata.scanMode.skip.description')}
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>

        <Divider sx={{ my: 3 }} />

        {/* File Size Limit */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            {t('metadata.limits.title')}
          </Typography>
          <TextField
            fullWidth
            type="number"
            label={t('metadata.limits.fileSize.label')}
            value={localSettings.stealthMaxFileSizeMB}
            onChange={handleFileSizeChange}
            helperText={t('metadata.limits.fileSize.helper')}
            inputProps={{ min: 1, step: 0.5 }}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            type="number"
            label={t('metadata.limits.resolution.label')}
            value={localSettings.stealthMaxResolutionMP}
            onChange={handleResolutionChange}
            helperText={t('metadata.limits.resolution.helper')}
            inputProps={{ min: 1, step: 0.5 }}
          />
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Skip Settings */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            {t('metadata.skipSettings.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('metadata.skipSettings.description')}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={localSettings.skipStealthForComfyUI}
                onChange={handleToggle('skipStealthForComfyUI')}
              />
            }
            label={
              <Box>
                <Typography variant="body1">{t('metadata.skipSettings.comfyui.label')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('metadata.skipSettings.comfyui.description')}
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={localSettings.skipStealthForWebUI}
                onChange={handleToggle('skipStealthForWebUI')}
              />
            }
            label={
              <Box>
                <Typography variant="body1">{t('metadata.skipSettings.webui.label')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('metadata.skipSettings.webui.description')}
                </Typography>
              </Box>
            }
          />
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Secondary Extraction */}
        <Box sx={{ mb: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={localSettings.enableSecondaryExtraction}
                onChange={handleToggle('enableSecondaryExtraction')}
              />
            }
            label={
              <Box>
                <Typography variant="body1">{t('metadata.secondary.label')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('metadata.secondary.description')}
                </Typography>
              </Box>
            }
          />
        </Box>

        {/* Save Button */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!hasChanges || updating}
          >
            {updating ? t('tagger.buttons.save') + '...' : t('tagger.buttons.save')}
          </Button>
        </Box>
      </Paper>

      {/* Performance Info */}
      <Alert severity="info" sx={{ mt: 2 }}>
        <Typography variant="body2">
          {t('metadata.performanceNote')}
        </Typography>
      </Alert>
    </Box>
  );
};

export default MetadataSettings;

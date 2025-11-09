import React, { useState } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Paper,
  Alert,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Switch,
  Divider,
  Tooltip,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import type {
  GeneralSettings as GeneralSettingsType,
  SupportedLanguage,
  MetadataExtractionSettings,
  StealthScanMode
} from '../../../services/settingsApi';
import { SUPPORTED_LANGUAGES } from '@comfyui-image-manager/shared';

interface GeneralSettingsProps {
  settings: GeneralSettingsType;
  metadataSettings: MetadataExtractionSettings;
  onUpdate: (settings: Partial<GeneralSettingsType>) => Promise<void>;
  onMetadataUpdate: (settings: Partial<MetadataExtractionSettings>) => Promise<void>;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, metadataSettings, onUpdate, onMetadataUpdate }) => {
  const { t, i18n } = useTranslation('settings');
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLanguageChange = async (event: any) => {
    const newLanguage = event.target.value as SupportedLanguage;

    setUpdating(true);
    setError(null);

    try {
      // Update backend settings
      await onUpdate({ language: newLanguage });

      // Change i18n language
      await i18n.changeLanguage(newLanguage);
    } catch (err) {
      console.error('Failed to update language:', err);
      setError('Failed to update language setting');
    } finally {
      setUpdating(false);
    }
  };

  const handleMetadataUpdate = async (updates: Partial<MetadataExtractionSettings>) => {
    setUpdating(true);
    setError(null);

    try {
      await onMetadataUpdate(updates);
    } catch (err) {
      console.error('Failed to update metadata settings:', err);
      setError(t('messages.saveFailed'));
    } finally {
      setUpdating(false);
    }
  };

  const handleScanModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleMetadataUpdate({ stealthScanMode: event.target.value as StealthScanMode });
  };

  const handleFileSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    if (!isNaN(value) && value > 0) {
      handleMetadataUpdate({ stealthMaxFileSizeMB: value });
    }
  };

  const handleResolutionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    if (!isNaN(value) && value > 0) {
      handleMetadataUpdate({ stealthMaxResolutionMP: value });
    }
  };

  const handleMetadataToggle = (field: keyof MetadataExtractionSettings) => (event: React.ChangeEvent<HTMLInputElement>) => {
    handleMetadataUpdate({ [field]: event.target.checked });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('general.title')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        {/* Language Settings */}
        <FormControl fullWidth disabled={updating}>
          <InputLabel id="language-select-label">
            {t('general.language.label')}
          </InputLabel>
          <Select
            labelId="language-select-label"
            id="language-select"
            value={settings.language}
            label={t('general.language.label')}
            onChange={handleLanguageChange}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <MenuItem key={lang.code} value={lang.code}>
                {lang.name} ({lang.englishName})
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Gallery Enable/Disable */}
        <Box sx={{ mb: 2, mt: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.enableGallery ?? true}
                onChange={async (e) => {
                  try {
                    await onUpdate({
                      enableGallery: e.target.checked
                    });
                  } catch (err) {
                    console.error('Failed to update gallery setting:', err);
                    setError(t('messages.saveFailed'));
                  }
                }}
                disabled={updating}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="body1">{t('general.gallery.label')}</Typography>
                <Tooltip title={t('general.gallery.tooltip')} arrow>
                  <InfoOutlinedIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
                </Tooltip>
              </Box>
            }
          />
        </Box>

        {/* Delete Protection Settings */}
        <Box sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.deleteProtection?.enabled ?? true}
                onChange={async (e) => {
                  try {
                    await onUpdate({
                      deleteProtection: {
                        ...settings.deleteProtection,
                        enabled: e.target.checked,
                        recycleBinPath: 'RecycleBin'
                      }
                    });
                  } catch (err) {
                    console.error('Failed to update delete protection:', err);
                    setError(t('messages.saveFailed'));
                  }
                }}
                disabled={updating}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="body1">{t('general.deleteProtection.label')}</Typography>
                <Tooltip title={t('general.deleteProtection.tooltip')} arrow>
                  <InfoOutlinedIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
                </Tooltip>
              </Box>
            }
          />
        </Box>

        <Divider sx={{ my: 4 }} />

        {/* Metadata Extraction Optimization */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6">
            {t('general.metadata.title')}
          </Typography>
          <Tooltip title={t('general.metadata.performanceNote')} arrow>
            <InfoOutlinedIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
          </Tooltip>
        </Box>

        {/* Scan Mode */}
        <FormControl component="fieldset" fullWidth sx={{ mb: 3 }} disabled={updating}>
          <FormLabel component="legend">
            <Typography variant="subtitle1" gutterBottom>
              {t('general.metadata.scanMode.title')}
            </Typography>
          </FormLabel>
          <RadioGroup
            value={metadataSettings.stealthScanMode}
            onChange={handleScanModeChange}
          >
            <FormControlLabel
              value="fast"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1">{t('general.metadata.scanMode.fast.label')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('general.metadata.scanMode.fast.description')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="full"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1">{t('general.metadata.scanMode.full.label')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('general.metadata.scanMode.full.description')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="skip"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1">{t('general.metadata.scanMode.skip.label')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('general.metadata.scanMode.skip.description')}
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>

        <Divider sx={{ my: 3 }} />

        {/* File Size and Resolution Limits */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            {t('general.metadata.limits.title')}
          </Typography>
          <TextField
            fullWidth
            type="number"
            label={t('general.metadata.limits.fileSize.label')}
            value={metadataSettings.stealthMaxFileSizeMB}
            onChange={handleFileSizeChange}
            helperText={t('general.metadata.limits.fileSize.helper')}
            inputProps={{ min: 1, step: 0.5 }}
            disabled={updating}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            type="number"
            label={t('general.metadata.limits.resolution.label')}
            value={metadataSettings.stealthMaxResolutionMP}
            onChange={handleResolutionChange}
            helperText={t('general.metadata.limits.resolution.helper')}
            inputProps={{ min: 1, step: 0.5 }}
            disabled={updating}
          />
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Skip Settings */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            {t('general.metadata.skipSettings.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('general.metadata.skipSettings.description')}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={metadataSettings.skipStealthForComfyUI}
                onChange={handleMetadataToggle('skipStealthForComfyUI')}
                disabled={updating}
              />
            }
            label={
              <Box>
                <Typography variant="body1">{t('general.metadata.skipSettings.comfyui.label')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('general.metadata.skipSettings.comfyui.description')}
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={metadataSettings.skipStealthForWebUI}
                onChange={handleMetadataToggle('skipStealthForWebUI')}
                disabled={updating}
              />
            }
            label={
              <Box>
                <Typography variant="body1">{t('general.metadata.skipSettings.webui.label')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('general.metadata.skipSettings.webui.description')}
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
                checked={metadataSettings.enableSecondaryExtraction}
                onChange={handleMetadataToggle('enableSecondaryExtraction')}
                disabled={updating}
              />
            }
            label={
              <Box>
                <Typography variant="body1">{t('general.metadata.secondary.label')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('general.metadata.secondary.description')}
                </Typography>
              </Box>
            }
          />
        </Box>
      </Paper>
    </Box>
  );
};

export default GeneralSettings;

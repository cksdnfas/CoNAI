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
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { GeneralSettings as GeneralSettingsType, SupportedLanguage } from '../../../services/settingsApi';
import { SUPPORTED_LANGUAGES } from '@comfyui-image-manager/shared';

interface GeneralSettingsProps {
  settings: GeneralSettingsType;
  onUpdate: (settings: Partial<GeneralSettingsType>) => Promise<void>;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, onUpdate }) => {
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

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('general.language.description')}
        </Typography>
      </Paper>
    </Box>
  );
};

export default GeneralSettings;

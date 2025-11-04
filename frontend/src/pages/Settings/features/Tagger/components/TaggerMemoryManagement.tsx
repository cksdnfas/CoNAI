import React from 'react';
import {
  Box,
  Typography,
  Stack,
  FormControlLabel,
  Switch,
  Slider,
  Tooltip,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import type { TaggerSettings } from '../../../../../services/settingsApi';

interface TaggerMemoryManagementProps {
  localSettings: TaggerSettings;
  onUpdateSettings: (updates: Partial<TaggerSettings>) => void;
}

export const TaggerMemoryManagement: React.FC<TaggerMemoryManagementProps> = ({
  localSettings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('tagger.memoryManagement.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        {t('tagger.memoryManagement.description')}
      </Typography>

      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <FormControlLabel
            control={
              <Switch
                checked={localSettings.keepModelLoaded}
                onChange={(e) => onUpdateSettings({ keepModelLoaded: e.target.checked })}
              />
            }
            label={t('tagger.memoryManagement.keepModelLoaded')}
          />
          <Tooltip
            title={
              localSettings.keepModelLoaded
                ? t('tagger.memoryManagement.keepLoadedAlert')
                : t('tagger.memoryManagement.notKeepLoadedAlert')
            }
            arrow
          >
            <InfoOutlinedIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
          </Tooltip>
        </Box>

        {localSettings.keepModelLoaded && (
          <Box>
            <Typography gutterBottom>
              {t('tagger.memoryManagement.autoUnloadMinutes', { minutes: localSettings.autoUnloadMinutes })}
            </Typography>
            <Slider
              value={localSettings.autoUnloadMinutes}
              onChange={(_, value) => onUpdateSettings({ autoUnloadMinutes: value as number })}
              min={1}
              max={60}
              step={1}
              marks={[
                { value: 1, label: '1min' },
                { value: 15, label: '15min' },
                { value: 30, label: '30min' },
                { value: 60, label: '60min' },
              ]}
            />
            <Typography variant="caption" color="text.secondary">
              {t('tagger.memoryManagement.autoUnloadDescription')}
            </Typography>
          </Box>
        )}
      </Stack>
    </Box>
  );
};

import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Divider,
  Paper,
  Grid
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { MODELS } from '../constants/nai.constants';
import type { NAIParams } from '../types/nai.types';
import { WildcardTextField } from '../../../../components/WildcardTextField';
import ResolutionSettings from './ResolutionSettings';

interface NAIBasicSettingsProps {
  params: NAIParams;
  onChange: (params: NAIParams) => void;
  disabled?: boolean;
}

export default function NAIBasicSettings({ params, onChange, disabled = false }: NAIBasicSettingsProps) {
  const { t } = useTranslation('imageGeneration');

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
        {t('nai.naiSettings.basic.title')}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid size={12}>
          <FormControl fullWidth disabled={disabled}>
            <InputLabel>{t('nai.naiSettings.basic.model')}</InputLabel>
            <Select
              value={params.model}
              onChange={(e) => onChange({ ...params, model: e.target.value })}
              label={t('nai.naiSettings.basic.model')}
            >
              {MODELS.map(m => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={12}>
          <Typography variant="body2" gutterBottom fontWeight="medium">
            {t('nai.naiSettings.basic.resolution')}
          </Typography>
          <ResolutionSettings
            config={params.resolutionConfig}
            onChange={(resolutionConfig) => onChange({ ...params, resolutionConfig })}
            disabled={disabled}
          />
        </Grid>

        <Grid size={12}>
          <WildcardTextField
            multiline
            rows={4}
            label={t('nai.naiSettings.basic.prompt')}
            value={params.prompt}
            onChange={(value) => onChange({ ...params, prompt: value })}
            placeholder={t('nai.naiSettings.basic.promptPlaceholder')}
            required
            disabled={disabled}
          />
        </Grid>

        <Grid size={12}>
          <WildcardTextField
            multiline
            rows={2}
            label={t('nai.naiSettings.basic.negativePrompt')}
            value={params.negative_prompt}
            onChange={(value) => onChange({ ...params, negative_prompt: value })}
            placeholder={t('nai.naiSettings.basic.negativePromptPlaceholder')}
            disabled={disabled}
          />
        </Grid>
      </Grid>
    </Paper>
  );
}

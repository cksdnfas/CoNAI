import {
  TextField,
  Typography,
  Divider,
  Paper,
  Grid
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { NAIParams } from '../types/nai.types';

interface NAIOutputSettingsProps {
  params: NAIParams;
  onChange: (params: NAIParams) => void;
  disabled?: boolean;
}

export default function NAIOutputSettings({ params, onChange, disabled = false }: NAIOutputSettingsProps) {
  const { t } = useTranslation('imageGeneration');

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
        {t('nai.naiSettings.output.title')}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid size={12}>
          <TextField
            fullWidth
            type="number"
            label={t('nai.naiSettings.output.samples')}
            value={params.n_samples}
            onChange={(e) => onChange({ ...params, n_samples: parseInt(e.target.value) })}
            inputProps={{ min: 1, max: 8 }}
            disabled={disabled}
          />
        </Grid>
      </Grid>
    </Paper>
  );
}

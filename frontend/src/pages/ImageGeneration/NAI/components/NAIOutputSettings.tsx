import {
  TextField,
  Typography,
  Divider,
  Paper,
  Grid
} from '@mui/material';
import type { NAIParams } from '../types/nai.types';

interface NAIOutputSettingsProps {
  params: NAIParams;
  onChange: (params: NAIParams) => void;
  disabled?: boolean;
}

export default function NAIOutputSettings({ params, onChange, disabled = false }: NAIOutputSettingsProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
        출력 설정
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid size={12}>
          <TextField
            fullWidth
            type="number"
            label="샘플 수"
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

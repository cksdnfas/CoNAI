import {
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Divider,
  Paper,
  Grid
} from '@mui/material';
import { MODELS, RESOLUTIONS } from '../constants/nai.constants';
import type { NAIParams } from '../types/nai.types';

interface NAIBasicSettingsProps {
  params: NAIParams;
  onChange: (params: NAIParams) => void;
  disabled?: boolean;
}

export default function NAIBasicSettings({ params, onChange, disabled = false }: NAIBasicSettingsProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
        기본 설정
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid size={12}>
          <FormControl fullWidth disabled={disabled}>
            <InputLabel>모델</InputLabel>
            <Select
              value={params.model}
              onChange={(e) => onChange({ ...params, model: e.target.value })}
              label="모델"
            >
              {MODELS.map(m => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={12}>
          <FormControl fullWidth disabled={disabled}>
            <InputLabel>해상도</InputLabel>
            <Select
              value={params.resolution}
              onChange={(e) => onChange({ ...params, resolution: e.target.value })}
              label="해상도"
            >
              {Object.keys(RESOLUTIONS).map(key => {
                const res = RESOLUTIONS[key as keyof typeof RESOLUTIONS];
                return (
                  <MenuItem key={key} value={key}>
                    {key} ({res.width}×{res.height})
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={12}>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="프롬프트"
            value={params.prompt}
            onChange={(e) => onChange({ ...params, prompt: e.target.value })}
            placeholder="1girl, portrait, detailed face, masterpiece..."
            required
            disabled={disabled}
          />
        </Grid>

        <Grid size={12}>
          <TextField
            fullWidth
            multiline
            rows={2}
            label="네거티브 프롬프트"
            value={params.negative_prompt}
            onChange={(e) => onChange({ ...params, negative_prompt: e.target.value })}
            placeholder="bad anatomy, low quality..."
            disabled={disabled}
          />
        </Grid>
      </Grid>
    </Paper>
  );
}

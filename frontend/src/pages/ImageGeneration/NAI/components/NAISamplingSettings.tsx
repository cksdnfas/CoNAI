import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  Typography,
  Divider,
  Paper,
  Grid,
  FormControlLabel,
  Checkbox
} from '@mui/material';
import { SAMPLERS, NOISE_SCHEDULES } from '../constants/nai.constants';
import type { NAIParams } from '../types/nai.types';

interface NAISamplingSettingsProps {
  params: NAIParams;
  onChange: (params: NAIParams) => void;
  disabled?: boolean;
}

export default function NAISamplingSettings({ params, onChange, disabled = false }: NAISamplingSettingsProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
        샘플링 설정
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid size={12}>
          <FormControl fullWidth disabled={disabled}>
            <InputLabel>샘플러</InputLabel>
            <Select
              value={params.sampler}
              onChange={(e) => onChange({ ...params, sampler: e.target.value })}
              label="샘플러"
            >
              {SAMPLERS.map(s => (
                <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={12}>
          <FormControl fullWidth disabled={disabled}>
            <InputLabel>Noise Schedule</InputLabel>
            <Select
              value={params.noise_schedule}
              onChange={(e) => onChange({ ...params, noise_schedule: e.target.value })}
              label="Noise Schedule"
            >
              {NOISE_SCHEDULES.map(n => (
                <MenuItem key={n.value} value={n.value}>{n.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={12}>
          <Typography gutterBottom>Steps: {params.steps}</Typography>
          <Slider
            value={params.steps}
            onChange={(_, value) => onChange({ ...params, steps: value as number })}
            min={1}
            max={50}
            marks={[
              { value: 15, label: '15' },
              { value: 28, label: '28' },
              { value: 40, label: '40' }
            ]}
            disabled={disabled}
          />
        </Grid>

        <Grid size={12}>
          <Typography gutterBottom>Guidance: {params.scale}</Typography>
          <Slider
            value={params.scale}
            onChange={(_, value) => onChange({ ...params, scale: value as number })}
            min={0}
            max={10}
            step={0.1}
            marks={[
              { value: 0, label: '0' },
              { value: 5, label: '5' },
              { value: 7, label: '7' }
            ]}
            disabled={disabled}
          />
        </Grid>

        <Grid size={12}>
          <Typography gutterBottom>CFG Rescale: {params.cfg_rescale}</Typography>
          <Slider
            value={params.cfg_rescale}
            onChange={(_, value) => onChange({ ...params, cfg_rescale: value as number })}
            min={0}
            max={1}
            step={0.05}
            marks={[
              { value: 0, label: '0' },
              { value: 0.2, label: '0.2' },
              { value: 0.5, label: '0.5' }
            ]}
            disabled={disabled}
          />
        </Grid>

        <Grid size={12}>
          <Typography gutterBottom>Uncond Scale: {params.uncond_scale}</Typography>
          <Slider
            value={params.uncond_scale}
            onChange={(_, value) => onChange({ ...params, uncond_scale: value as number })}
            min={0}
            max={1.5}
            step={0.05}
            marks={[
              { value: 0, label: '0' },
              { value: 1, label: '1' },
              { value: 1.5, label: '1.5' }
            ]}
            disabled={disabled}
          />
        </Grid>

        <Grid size={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={params.variety_plus}
                onChange={(e) => onChange({ ...params, variety_plus: e.target.checked })}
                disabled={disabled}
              />
            }
            label="Variety+"
          />
        </Grid>
      </Grid>
    </Paper>
  );
}

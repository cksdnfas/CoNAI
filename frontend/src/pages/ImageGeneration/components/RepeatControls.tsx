import { Box, Checkbox, FormControlLabel, TextField, Typography, Chip, Button, Divider } from '@mui/material';
import { Repeat as RepeatIcon, Stop as StopIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export interface RepeatConfig {
  enabled: boolean;
  count: number; // -1 = 무한
  delaySeconds: number;
}

export interface RepeatState {
  isRunning: boolean;
  currentIteration: number;
  totalIterations: number;
}

interface RepeatControlsProps {
  config: RepeatConfig;
  state: RepeatState;
  onConfigChange: (config: RepeatConfig) => void;
  onStop: () => void;
  namespace?: 'imageGeneration' | 'workflows';
}

export default function RepeatControls({
  config,
  state,
  onConfigChange,
  onStop,
  namespace = 'imageGeneration'
}: RepeatControlsProps) {
  const { t } = useTranslation([namespace]);

  const handleEnabledChange = (checked: boolean) => {
    onConfigChange({ ...config, enabled: checked });
  };

  const handleCountChange = (value: string) => {
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= -1 && numValue <= 999) {
      onConfigChange({ ...config, count: numValue });
    }
  };

  const handleDelayChange = (value: string) => {
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= 1 && numValue <= 300) {
      onConfigChange({ ...config, delaySeconds: numValue });
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <RepeatIcon fontSize="small" />
        <Typography variant="subtitle1" fontWeight="bold">
          {t(`${namespace}:repeat.title`)}
        </Typography>
      </Box>
      <Divider sx={{ mb: 2 }} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* 반복 활성화 */}
        <FormControlLabel
          control={
            <Checkbox
              checked={config.enabled}
              onChange={(e) => handleEnabledChange(e.target.checked)}
              disabled={state.isRunning}
            />
          }
          label={t(`${namespace}:repeat.enable`)}
        />

        {config.enabled && (
          <>
            {/* 반복 횟수 */}
            <TextField
              fullWidth
              type="number"
              label={t(`${namespace}:repeat.count`)}
              value={config.count}
              onChange={(e) => handleCountChange(e.target.value)}
              disabled={state.isRunning}
              inputProps={{ min: -1, max: 999 }}
              helperText={
                config.count === -1
                  ? t(`${namespace}:repeat.infinite`)
                  : t(`${namespace}:repeat.countHelp`)
              }
            />

            {/* 대기 시간 */}
            <TextField
              fullWidth
              type="number"
              label={t(`${namespace}:repeat.delay`)}
              value={config.delaySeconds}
              onChange={(e) => handleDelayChange(e.target.value)}
              disabled={state.isRunning}
              inputProps={{ min: 1, max: 300 }}
              helperText={t(`${namespace}:repeat.delayHelp`)}
            />

            {/* 진행 상태 */}
            {state.isRunning && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    label={
                      config.count === -1
                        ? t(`${namespace}:repeat.progress`, {
                            current: state.currentIteration
                          })
                        : t(`${namespace}:repeat.progressWithTotal`, {
                            current: state.currentIteration,
                            total: state.totalIterations
                          })
                    }
                    color="primary"
                    size="small"
                  />
                </Box>
                <Button
                  fullWidth
                  variant="outlined"
                  color="error"
                  startIcon={<StopIcon />}
                  onClick={onStop}
                >
                  {t(`${namespace}:repeat.stop`)}
                </Button>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

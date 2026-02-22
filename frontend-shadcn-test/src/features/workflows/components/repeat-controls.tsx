import { Box, Button, Checkbox, Chip, Divider, FormControlLabel, TextField, Typography } from '@mui/material'
import { Repeat as RepeatIcon, Stop as StopIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

export interface RepeatConfig {
  enabled: boolean
  count: number
  delaySeconds: number
}

export interface RepeatState {
  isRunning: boolean
  currentIteration: number
  totalIterations: number
}

interface RepeatControlsProps {
  config: RepeatConfig
  state: RepeatState
  onConfigChange: (config: RepeatConfig) => void
  onStop: () => void
  namespace?: 'imageGeneration' | 'workflows'
}

export default function RepeatControls({
  config,
  state,
  onConfigChange,
  onStop,
  namespace = 'imageGeneration',
}: RepeatControlsProps) {
  const { t } = useTranslation([namespace])

  const getKey = (key: string) => {
    if (namespace === 'imageGeneration') {
      return `nai.repeat.${key}`
    }
    return `repeat.${key}`
  }

  const handleEnabledChange = (checked: boolean) => {
    onConfigChange({ ...config, enabled: checked })
  }

  const handleCountChange = (value: string) => {
    const numValue = parseInt(value, 10)
    if (!Number.isNaN(numValue) && numValue >= -1 && numValue <= 999) {
      onConfigChange({ ...config, count: numValue })
    }
  }

  const handleDelayChange = (value: string) => {
    const numValue = parseInt(value, 10)
    if (!Number.isNaN(numValue) && numValue >= 1 && numValue <= 300) {
      onConfigChange({ ...config, delaySeconds: numValue })
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <RepeatIcon fontSize="small" />
        <Typography variant="subtitle1" fontWeight="bold">
          {t(getKey('title'))}
        </Typography>
      </Box>
      <Divider sx={{ mb: 2 }} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <FormControlLabel
          control={<Checkbox checked={config.enabled} onChange={(event) => handleEnabledChange(event.target.checked)} disabled={state.isRunning} />}
          label={t(getKey('enable'))}
        />

        {config.enabled ? (
          <>
            <TextField
              fullWidth
              type="number"
              label={t(getKey('count'))}
              value={config.count}
              onChange={(event) => handleCountChange(event.target.value)}
              disabled={state.isRunning}
              inputProps={{ min: -1, max: 999 }}
              helperText={config.count === -1 ? t(getKey('infinite')) : t(getKey('countHelp'))}
            />

            <TextField
              fullWidth
              type="number"
              label={t(getKey('delay'))}
              value={config.delaySeconds}
              onChange={(event) => handleDelayChange(event.target.value)}
              disabled={state.isRunning}
              inputProps={{ min: 1, max: 300 }}
              helperText={t(getKey('delayHelp'))}
            />

            {state.isRunning ? (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    label={
                      config.count === -1
                        ? t(getKey('progress'), { current: state.currentIteration })
                        : t(getKey('progressWithTotal'), { current: state.currentIteration, total: state.totalIterations })
                    }
                    color="primary"
                    size="small"
                  />
                </Box>
                <Button fullWidth variant="outlined" color="error" startIcon={<StopIcon />} onClick={onStop}>
                  {t(getKey('stop'))}
                </Button>
              </Box>
            ) : null}
          </>
        ) : null}
      </Box>
    </Box>
  )
}

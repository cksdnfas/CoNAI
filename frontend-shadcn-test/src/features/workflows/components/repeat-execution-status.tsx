import { Box, Chip, Divider, LinearProgress, Paper, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { ComfyUIServer } from '../../../../legacy-src/services/api/comfyuiServerApi'
import type { ServerRepeatState } from '../types/workflow.types'

interface RepeatExecutionStatusProps {
  servers: ComfyUIServer[]
  serverRepeatStates: Record<number, ServerRepeatState>
}

export function RepeatExecutionStatus({ servers, serverRepeatStates }: RepeatExecutionStatusProps) {
  const { t } = useTranslation(['workflows'])
  if (Object.keys(serverRepeatStates).length === 0) {
    return null
  }

  const completedTotal = Object.values(serverRepeatStates).reduce((sum, state) => sum + state.currentIteration, 0)
  const plannedTotal = Object.values(serverRepeatStates).reduce(
    (sum, state) => sum + (state.totalIterations === -1 ? 0 : state.totalIterations),
    0,
  )
  const hasInfinite = Object.values(serverRepeatStates).some((state) => state.totalIterations === -1)
  const progress = plannedTotal > 0 ? (completedTotal / plannedTotal) * 100 : 0

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        {t('workflows:repeatExecution.statusTitle')}
      </Typography>
      <Divider sx={{ mb: 2 }} />

      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" gutterBottom>
          {t('workflows:repeatExecution.overall', {
            completed: completedTotal,
            total: plannedTotal > 0 ? ` / ${plannedTotal}` : '',
          })}
          {hasInfinite ? t('workflows:repeatExecution.withInfinite') : ''}
        </Typography>
        {plannedTotal > 0 ? <LinearProgress variant="determinate" value={progress} sx={{ mt: 1 }} /> : null}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {Object.entries(serverRepeatStates).map(([serverIdText, state]) => {
          const serverId = parseInt(serverIdText, 10)
          const server = servers.find((item) => item.id === serverId)
          if (!server) {
            return null
          }

          return (
            <Box
              key={serverId}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              <Typography variant="body2" sx={{ flex: 1 }}>
                {server.name}
              </Typography>
              <Chip
                label={
                  state.totalIterations === -1
                    ? t('workflows:repeatExecution.serverProgressInfinite', { count: state.currentIteration })
                    : `${state.currentIteration} / ${t('workflows:repeatExecution.serverProgress', { count: state.totalIterations })}`
                }
                size="small"
                color={state.isRunning ? 'primary' : 'default'}
              />
            </Box>
          )
        })}
      </Box>
    </Paper>
  )
}

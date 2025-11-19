import { Box, Typography, Paper, Divider, LinearProgress, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ComfyUIServer } from '../../../services/api/comfyuiServerApi';
import type { ServerRepeatState } from '../types/workflow.types';

interface RepeatExecutionStatusProps {
  servers: ComfyUIServer[];
  serverRepeatStates: Record<number, ServerRepeatState>;
}

/**
 * 반복 실행 현황 컴포넌트
 * - 전체 진행률 표시
 * - 서버별 진행률 표시
 */
export function RepeatExecutionStatus({
  servers,
  serverRepeatStates
}: RepeatExecutionStatusProps) {
  const { t } = useTranslation(['workflows']);
  if (Object.keys(serverRepeatStates).length === 0) {
    return null;
  }

  // 전체 진행률 계산
  const completedTotal = Object.values(serverRepeatStates).reduce(
    (sum, state) => sum + state.currentIteration,
    0
  );
  const plannedTotal = Object.values(serverRepeatStates).reduce(
    (sum, state) => sum + (state.totalIterations === -1 ? 0 : state.totalIterations),
    0
  );
  const hasInfinite = Object.values(serverRepeatStates).some(
    state => state.totalIterations === -1
  );
  const progress = plannedTotal > 0 ? (completedTotal / plannedTotal) * 100 : 0;

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        {t('workflows:repeatExecution.statusTitle')}
      </Typography>
      <Divider sx={{ mb: 2 }} />

      {/* 전체 진행률 */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" gutterBottom>
          {t('workflows:repeatExecution.overall', {
            completed: completedTotal,
            total: plannedTotal > 0 ? ` / ${plannedTotal}` : ''
          })}
          {hasInfinite && t('workflows:repeatExecution.withInfinite')}
        </Typography>
        {plannedTotal > 0 && (
          <LinearProgress variant="determinate" value={progress} sx={{ mt: 1 }} />
        )}
      </Box>

      {/* 서버별 진행률 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {Object.entries(serverRepeatStates).map(([serverIdStr, state]) => {
          const serverId = parseInt(serverIdStr);
          const server = servers.find(s => s.id === serverId);
          if (!server) return null;

          return (
            <Box
              key={serverId}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover'
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
          );
        })}
      </Box>
    </Paper>
  );
}

import {
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  Divider,
  LinearProgress,
  CircularProgress,
  Chip
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { Workflow } from '../../../services/api/workflowApi';
import type { ComfyUIServer } from '../../../services/api/comfyuiServerApi';
import type {
  ServerConnectionStatus,
  ServerGenerationStatus,
  ServerRepeatState
} from '../types/workflow.types';

interface ServerStatusListProps {
  workflow: Workflow;
  servers: ComfyUIServer[];
  serverStatus: Record<number, ServerConnectionStatus>;
  generationStatus: Record<number, ServerGenerationStatus>;
  serverRepeatStates: Record<number, ServerRepeatState>;
  onGenerate: (serverId: number) => void;
  onStartRepeat: (serverId: number) => void;
  onStopRepeat: (serverId: number) => void;
}

/**
 * 서버 상태 목록 컴포넌트
 * - 서버별 연결 상태
 * - 서버별 생성 버튼 및 반복 실행 버튼
 * - 서버별 반복 실행 상태 표시
 */
export function ServerStatusList({
  workflow,
  servers,
  serverStatus,
  generationStatus,
  serverRepeatStates,
  onGenerate,
  onStartRepeat,
  onStopRepeat
}: ServerStatusListProps) {
  const { t } = useTranslation(['workflows']);

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        {t('workflows:generate.serversListTitle')}
      </Typography>
      <Divider sx={{ mb: 2 }} />

      {servers.length === 0 && (
        <Alert severity="info">
          {t('workflows:generate.noServers')}
        </Alert>
      )}

      {servers.map(server => {
        const status = serverStatus[server.id];
        const genStatus = generationStatus[server.id];
        const repeatState = serverRepeatStates[server.id];

        return (
          <Box key={server.id} sx={{ mb: 2, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {status?.connected ? (
                <CheckCircleIcon color="success" fontSize="small" />
              ) : (
                <ErrorIcon color="error" fontSize="small" />
              )}
              <Typography variant="body2" fontWeight="bold" sx={{ flex: 1 }}>
                {server.name}
              </Typography>
              {genStatus?.status === 'generating' && (
                <CircularProgress size={16} />
              )}
            </Box>

            {status?.responseTime && (
              <Typography variant="caption" color="text.secondary" display="block">
                {t('workflows:generate.responseTime', { time: status.responseTime })}
              </Typography>
            )}

            {/* 서버별 반복 상태 */}
            {repeatState && (
              <Box sx={{ mt: 1, mb: 1 }}>
                <Chip
                  label={
                    repeatState.totalIterations === -1
                      ? t('workflows:serverStatus.executingInfinite', { count: repeatState.currentIteration })
                      : t('workflows:serverStatus.executingProgress', {
                          current: repeatState.currentIteration,
                          total: repeatState.totalIterations
                        })
                  }
                  color="primary"
                  size="small"
                />
              </Box>
            )}

            {/* 서버별 제어 버튼 */}
            <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onGenerate(server.id)}
                disabled={
                  !status?.connected ||
                  genStatus?.status === 'generating' ||
                  repeatState?.isRunning ||
                  !workflow.is_active
                }
              >
                {t('workflows:serverStatus.generate')}
              </Button>
              {!repeatState?.isRunning ? (
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  onClick={() => onStartRepeat(server.id)}
                  disabled={
                    !status?.connected ||
                    genStatus?.status === 'generating' ||
                    !workflow.is_active
                  }
                >
                  {t('workflows:serverStatus.startRepeat')}
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => onStopRepeat(server.id)}
                >
                  {t('workflows:serverStatus.stop')}
                </Button>
              )}
            </Box>

            {genStatus?.status === 'generating' && (
              <LinearProgress sx={{ mt: 1 }} />
            )}

            {genStatus?.status === 'failed' && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {genStatus.error || t('workflows:generate.generationFailed')}
              </Alert>
            )}
          </Box>
        );
      })}
    </Paper>
  );
}

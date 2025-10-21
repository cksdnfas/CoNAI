import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  PlayArrow as PlayIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { workflowApi, type Workflow, type MarkedField } from '../../services/api/workflowApi';
import { comfyuiServerApi, type ComfyUIServer } from '../../services/api/comfyuiServerApi';
import { generationHistoryApi } from '../../services/api';
import { GenerationHistoryList } from '../ImageGeneration/components/GenerationHistoryList';
import RepeatControls from '../ImageGeneration/components/RepeatControls';
import type { RepeatConfig, RepeatState } from '../ImageGeneration/components/RepeatControls';

interface ServerGenerationStatus {
  status: 'idle' | 'generating' | 'completed' | 'failed';
  historyId?: number;
  progress?: number;
  imageId?: number;
  generatedImage?: any;
  error?: string;
  executionTime?: number;
}

export default function WorkflowGeneratePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(['workflows', 'common']);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});

  // 서버 관련 상태
  const [servers, setServers] = useState<ComfyUIServer[]>([]);
  const [serverStatus, setServerStatus] = useState<Record<number, {
    connected: boolean;
    responseTime?: number;
    error?: string;
  }>>({});
  const [generationStatus, setGenerationStatus] = useState<Record<number, ServerGenerationStatus>>({});

  // 반복 실행 관련 상태
  const [repeatConfig, setRepeatConfig] = useState<RepeatConfig>({
    enabled: false,
    count: 3,
    delaySeconds: 5
  });
  const [repeatState, setRepeatState] = useState<RepeatState>({
    isRunning: false,
    currentIteration: 0,
    totalIterations: 0
  });
  const [repeatTimeoutId, setRepeatTimeoutId] = useState<number | null>(null);

  // 히스토리 새로고침 트리거
  const [historyRefreshKey, setHistoryRefreshKey] = useState<number>(0);

  useEffect(() => {
    loadWorkflow();
    loadServers();
  }, [id]);

  const loadWorkflow = async () => {
    try {
      setLoading(true);
      const response = await workflowApi.getWorkflow(parseInt(id!));
      const workflowData: Workflow = response.data;

      setWorkflow(workflowData);

      // 기본값으로 formData 초기화
      if (workflowData.marked_fields) {
        const initialData: Record<string, any> = {};
        workflowData.marked_fields.forEach((field: MarkedField) => {
          initialData[field.id] = field.default_value || '';
        });
        setFormData(initialData);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadServers = async () => {
    try {
      const response = await comfyuiServerApi.getAllServers(true); // activeOnly
      setServers(response.data || []);

      // 각 서버별 상태 초기화
      const statusMap: Record<number, ServerGenerationStatus> = {};
      (response.data || []).forEach((server: ComfyUIServer) => {
        statusMap[server.id] = { status: 'idle' };
      });
      setGenerationStatus(statusMap);

      // 연결 테스트
      testAllServers(response.data || []);
    } catch (err: any) {
      console.error('Failed to load servers:', err);
    }
  };

  const testAllServers = async (serverList: ComfyUIServer[]) => {
    const results = await Promise.all(
      serverList.map(async (server) => {
        try {
          const startTime = Date.now();
          const response = await comfyuiServerApi.testConnection(server.id);
          const responseTime = Date.now() - startTime;

          return {
            serverId: server.id,
            connected: response.data?.isConnected || false,
            responseTime
          };
        } catch (err) {
          return {
            serverId: server.id,
            connected: false,
            error: 'Connection failed'
          };
        }
      })
    );

    const statusMap: Record<number, any> = {};
    results.forEach(result => {
      statusMap[result.serverId] = {
        connected: result.connected,
        responseTime: result.responseTime,
        error: result.error
      };
    });
    setServerStatus(statusMap);
  };

  const handleFieldChange = (fieldId: string, value: any) => {
    setFormData({
      ...formData,
      [fieldId]: value
    });
  };

  const buildPromptData = (): Record<string, any> => {
    if (!workflow?.workflow_json || !workflow?.marked_fields) {
      return {};
    }

    try {
      const workflowObj = JSON.parse(workflow.workflow_json);
      const promptData = JSON.parse(JSON.stringify(workflowObj)); // Deep clone

      // Marked Fields 값을 JSON Path에 따라 설정
      workflow.marked_fields.forEach((field: MarkedField) => {
        const path = field.jsonPath.split('.');
        let current: any = promptData;

        for (let i = 0; i < path.length - 1; i++) {
          if (!(path[i] in current)) {
            current[path[i]] = {};
          }
          current = current[path[i]];
        }

        const lastKey = path[path.length - 1];
        const value = formData[field.id];

        // 타입에 따라 변환
        if (field.type === 'number') {
          current[lastKey] = parseFloat(value) || 0;
        } else {
          current[lastKey] = value;
        }
      });

      return promptData;
    } catch (err) {
      console.error('Failed to build prompt data:', err);
      return {};
    }
  };

  const handleGenerateOnServer = async (serverId: number) => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    // 필수 필드 검증
    if (workflow?.marked_fields) {
      const missingFields = workflow.marked_fields.filter(
        (field: MarkedField) => field.required && !formData[field.id]
      );

      if (missingFields.length > 0) {
        setError(t('workflows:generate.missingFields', { fields: missingFields.map(f => f.label).join(', ') }));
        return;
      }
    }

    try {
      // 상태 업데이트
      setGenerationStatus(prev => ({
        ...prev,
        [serverId]: { status: 'generating', progress: 0 }
      }));
      setError(null);

      const promptData = buildPromptData();
      const response = await workflowApi.generateImageOnServer(parseInt(id!), serverId, promptData);

      // api_history_id 저장하고 폴링 시작
      const apiHistoryId = response.data.api_history_id;
      if (!apiHistoryId) {
        console.error('No api_history_id in response');
        setError('Failed to start image generation');
        return;
      }

      setGenerationStatus(prev => ({
        ...prev,
        [serverId]: {
          status: 'generating',
          historyId: apiHistoryId
        }
      }));

      // 폴링 시작 (api_history_id 사용)
      pollGenerationStatus(serverId, apiHistoryId);
    } catch (err: any) {
      setGenerationStatus(prev => ({
        ...prev,
        [serverId]: {
          status: 'failed',
          error: err.response?.data?.error || err.message
        }
      }));
    }
  };

  const pollGenerationStatus = async (serverId: number, apiHistoryId: number) => {
    const checkStatus = async () => {
      try {
        const response = await generationHistoryApi.getById(apiHistoryId);
        const data = response.record;

        if (data.generation_status === 'completed' || data.generation_status === 'failed') {
          setGenerationStatus(prev => ({
            ...prev,
            [serverId]: {
              status: data.generation_status,
              historyId: apiHistoryId,
              imageId: data.generated_image_id,
              generatedImage: data.generated_image,
              error: data.error_message,
              executionTime: data.execution_time
            }
          }));

          // 생성 완료 시 업로드 완료 대기 후 히스토리 목록 새로고침
          if (data.generation_status === 'completed') {
            waitForUploadCompletion(apiHistoryId);
          }
        } else {
          // 계속 폴링
          setTimeout(checkStatus, 2000);
        }
      } catch (err) {
        console.error('Failed to check status:', err);
        setTimeout(checkStatus, 2000); // 에러가 나도 계속 시도
      }
    };

    checkStatus();
  };

  const handleGenerateOnAllServers = async () => {
    const connectedServers = servers.filter(s => serverStatus[s.id]?.connected);

    if (connectedServers.length === 0) {
      setError(t('workflows:generate.noConnectedServers'));
      return;
    }

    // 반복 실행 시작 시 상태 초기화
    const isFirstRepeatExecution = repeatConfig.enabled && !repeatState.isRunning;
    if (isFirstRepeatExecution) {
      setRepeatState({
        isRunning: true,
        currentIteration: 1,
        totalIterations: repeatConfig.count === -1 ? -1 : repeatConfig.count
      });
    }

    // 모든 연결된 서버에 동시 요청
    const generationPromises = connectedServers.map(server =>
      handleGenerateOnServer(server.id)
    );

    // 모든 생성이 완료될 때까지 대기
    await Promise.all(generationPromises);

    // 반복 실행 처리
    if (repeatConfig.enabled) {
      const currentIteration = isFirstRepeatExecution ? 1 : repeatState.currentIteration;
      const shouldContinue = repeatConfig.count === -1 || currentIteration < repeatState.totalIterations;

      if (shouldContinue) {
        // 다음 반복 예약
        const timeoutId = window.setTimeout(() => {
          setRepeatState(prev => ({
            ...prev,
            currentIteration: prev.currentIteration + 1
          }));
          handleGenerateOnAllServers(); // 재귀 호출
        }, repeatConfig.delaySeconds * 1000);

        setRepeatTimeoutId(timeoutId);
      } else {
        // 반복 완료
        handleStopRepeat();
      }
    }
  };

  const handleStopRepeat = () => {
    if (repeatTimeoutId) {
      clearTimeout(repeatTimeoutId);
      setRepeatTimeoutId(null);
    }
    setRepeatState({
      isRunning: false,
      currentIteration: 0,
      totalIterations: 0
    });
  };

  // 업로드 완료 대기 후 히스토리 새로고침
  const waitForUploadCompletion = async (historyId: number) => {
    const maxAttempts = 30; // 최대 30초 대기
    const pollInterval = 1000; // 1초마다 체크
    let attempts = 0;

    const checkCompletion = async (): Promise<boolean> => {
      try {
        const response = await generationHistoryApi.getById(historyId);
        return response.record.generation_status === 'completed';
      } catch {
        return false;
      }
    };

    const poll = async () => {
      attempts++;
      const isCompleted = await checkCompletion();

      if (isCompleted) {
        // 업로드 완료 - 히스토리 새로고침
        setHistoryRefreshKey(prev => prev + 1);
      } else if (attempts < maxAttempts) {
        // 아직 완료 안됨 - 계속 폴링
        setTimeout(poll, pollInterval);
      } else {
        // 타임아웃 - 그냥 새로고침
        setHistoryRefreshKey(prev => prev + 1);
      }
    };

    // 폴링 시작
    poll();
  };

  const renderField = (field: MarkedField) => {
    const value = formData[field.id] || '';

    switch (field.type) {
      case 'textarea':
        return (
          <TextField
            key={field.id}
            fullWidth
            multiline
            rows={4}
            label={field.label}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            placeholder={field.placeholder}
            sx={{ mb: 2 }}
          />
        );

      case 'number':
        return (
          <TextField
            key={field.id}
            fullWidth
            type="number"
            label={field.label}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            placeholder={field.placeholder}
            inputProps={{
              min: field.min,
              max: field.max
            }}
            sx={{ mb: 2 }}
          />
        );

      case 'select':
        return (
          <TextField
            key={field.id}
            fullWidth
            select
            label={field.label}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            SelectProps={{ native: true }}
            sx={{ mb: 2 }}
          >
            <option value="">{t('workflows:generate.selectPlaceholder')}</option>
            {field.options?.map((option: string) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </TextField>
        );

      default: // text
        return (
          <TextField
            key={field.id}
            fullWidth
            label={field.label}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            placeholder={field.placeholder}
            sx={{ mb: 2 }}
          />
        );
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (!workflow) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('workflows:card.notFound')}</Alert>
      </Box>
    );
  }

  const promptData = buildPromptData();

  return (
    <Box sx={{ p: 3 }}>
      {/* 헤더 */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={() => navigate('/image-generation?tab=workflows')}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4">{workflow.name}</Typography>
          {workflow.description && (
            <Typography variant="body2" color="text.secondary">
              {workflow.description}
            </Typography>
          )}
        </Box>
        {!workflow.is_active && (
          <Chip label={t('workflows:card.inactive')} color="default" />
        )}
      </Box>

      {/* 알림 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 2열 레이아웃 */}
      <Grid container spacing={3}>
        {/* 왼쪽: 워크플로우 설정 */}
        <Grid size={{ xs: 12, md: 12, lg: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* 입력 폼 */}
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('workflows:generate.settingsTitle')}
              </Typography>
              <Divider sx={{ mb: 3 }} />

              {workflow.marked_fields && workflow.marked_fields.length > 0 ? (
                <Box>
                  {workflow.marked_fields.map((field: MarkedField) => renderField(field))}
                </Box>
              ) : (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t('workflows:alerts.noConfigurableFields')}
                </Alert>
              )}

              {/* 전송 데이터 미리보기 */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="body2">
                    {t('workflows:generate.previewTitle')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box
                    component="pre"
                    sx={{
                      p: 2,
                      borderRadius: 1,
                      overflow: 'auto',
                      maxHeight: 400,
                      fontSize: '0.75rem',
                      fontFamily: 'monospace'
                    }}
                  >
                    {JSON.stringify(promptData, null, 2)}
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Paper>

            {/* 반복 실행 설정 */}
            <Paper sx={{ p: 3 }}>
              <RepeatControls
                config={repeatConfig}
                state={repeatState}
                onConfigChange={setRepeatConfig}
                onStop={handleStopRepeat}
                namespace="workflows"
              />
            </Paper>

            {/* 모든 서버 동시 생성 버튼 */}
            <Button
              fullWidth
              variant="contained"
              size="large"
              startIcon={<PlayIcon />}
              onClick={handleGenerateOnAllServers}
              disabled={
                servers.filter(s => serverStatus[s.id]?.connected).length === 0 ||
                !workflow.is_active ||
                repeatState.isRunning
              }
            >
              {t('workflows:generate.generateAll', { count: servers.filter(s => serverStatus[s.id]?.connected).length })}
            </Button>

            {/* 서버 상태 */}
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

                return (
                  <Box key={server.id} sx={{ mb: 2, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      {status?.connected ? (
                        <CheckCircleIcon color="success" fontSize="small" />
                      ) : (
                        <ErrorIcon color="error" fontSize="small" />
                      )}
                      <Typography variant="body2" fontWeight="bold">{server.name}</Typography>
                      {genStatus?.status === 'generating' && (
                        <CircularProgress size={16} />
                      )}
                    </Box>

                    {status?.responseTime && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('workflows:generate.responseTime', { time: status.responseTime })}
                      </Typography>
                    )}

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

            {/* 워크플로우 비활성 경고 */}
            {!workflow.is_active && (
              <Alert severity="warning">
                {t('workflows:alerts.inactiveWarning')}
              </Alert>
            )}
          </Box>
        </Grid>

        {/* 오른쪽: 히스토리 목록 */}
        <Grid size={{ xs: 12, md: 12, lg: 8 }}>
          <GenerationHistoryList
            key={historyRefreshKey}
            serviceType="comfyui"
            workflowId={parseInt(id!)}
          />
        </Grid>
      </Grid>
    </Box>
  );
}

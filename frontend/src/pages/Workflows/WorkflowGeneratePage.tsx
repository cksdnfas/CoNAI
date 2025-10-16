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
  Card,
  CardMedia,
  CardContent,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  PlayArrow as PlayIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { workflowApi, type Workflow, type MarkedField } from '../../services/api/workflowApi';
import { comfyuiServerApi, type ComfyUIServer } from '../../services/api/comfyuiServerApi';

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
        setError(`필수 필드를 입력하세요: ${missingFields.map(f => f.label).join(', ')}`);
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

      // historyId 저장하고 폴링 시작
      setGenerationStatus(prev => ({
        ...prev,
        [serverId]: {
          status: 'generating',
          historyId: response.data.history_id
        }
      }));

      // 폴링 시작
      pollGenerationStatus(serverId, response.data.history_id);
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

  const pollGenerationStatus = async (serverId: number, historyId: number) => {
    const checkStatus = async () => {
      try {
        const response = await workflowApi.getGenerationStatus(historyId);
        const data = response.data;

        if (data.status === 'completed' || data.status === 'failed') {
          setGenerationStatus(prev => ({
            ...prev,
            [serverId]: {
              status: data.status,
              historyId,
              imageId: data.generated_image_id,
              generatedImage: data.generated_image,
              error: data.error_message,
              executionTime: data.execution_time
            }
          }));
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
      setError('연결된 서버가 없습니다');
      return;
    }

    // 모든 연결된 서버에 동시 요청
    connectedServers.forEach(server => {
      handleGenerateOnServer(server.id);
    });
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
            <option value="">선택하세요</option>
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
        <Alert severity="error">워크플로우를 찾을 수 없습니다</Alert>
      </Box>
    );
  }

  const promptData = buildPromptData();

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      {/* 헤더 */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={() => navigate('/workflows')}>
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
          <Chip label="비활성" color="default" />
        )}
      </Box>

      {/* 알림 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 입력 폼 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          생성 설정
        </Typography>
        <Divider sx={{ mb: 3 }} />

        {workflow.marked_fields && workflow.marked_fields.length > 0 ? (
          <Box>
            {workflow.marked_fields.map((field: MarkedField) => renderField(field))}
          </Box>
        ) : (
          <Alert severity="info" sx={{ mb: 2 }}>
            이 워크플로우에는 설정 가능한 필드가 없습니다.
          </Alert>
        )}

        {/* 전송 데이터 미리보기 */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2">
              전송될 데이터 미리보기
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

      {/* 모든 서버 동시 생성 버튼 */}
      <Button
        fullWidth
        variant="outlined"
        size="large"
        startIcon={<PlayIcon />}
        onClick={handleGenerateOnAllServers}
        disabled={
          servers.filter(s => serverStatus[s.id]?.connected).length === 0 ||
          !workflow.is_active
        }
        sx={{ mb: 3 }}
      >
        모든 활성 서버에서 동시 생성 ({servers.filter(s => serverStatus[s.id]?.connected).length}개)
      </Button>

      {/* 서버 목록 */}
      <Typography variant="h6" gutterBottom>
        ComfyUI 서버 목록
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        각 서버별로 독립적으로 이미지를 생성할 수 있습니다
      </Typography>

      {servers.length === 0 && (
        <Alert severity="info">
          등록된 ComfyUI 서버가 없습니다. 서버 관리 페이지에서 서버를 추가하세요.
        </Alert>
      )}

      {servers.map(server => {
        const status = serverStatus[server.id];
        const genStatus = generationStatus[server.id];

        return (
          <Card key={server.id} sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                {status?.connected ? (
                  <CheckCircleIcon color="success" fontSize="small" />
                ) : (
                  <ErrorIcon color="error" fontSize="small" />
                )}
                <Typography variant="h6">{server.name}</Typography>
                {server.description && (
                  <Chip label={server.description} size="small" sx={{ ml: 1 }} />
                )}
              </Box>

              <Typography variant="body2" color="text.secondary" gutterBottom>
                {server.endpoint}
              </Typography>

              {status?.responseTime && (
                <Typography variant="caption" color="text.secondary" display="block">
                  응답 시간: {status.responseTime}ms
                </Typography>
              )}

              {status?.error && (
                <Typography variant="caption" color="error" display="block">
                  {status.error}
                </Typography>
              )}

              <Divider sx={{ my: 2 }} />

              {/* 생성 버튼 */}
              <Button
                fullWidth
                variant="contained"
                startIcon={genStatus?.status === 'generating' ? <CircularProgress size={20} /> : <PlayIcon />}
                onClick={() => handleGenerateOnServer(server.id)}
                disabled={
                  !status?.connected ||
                  !workflow.is_active ||
                  genStatus?.status === 'generating'
                }
              >
                {genStatus?.status === 'generating' ? '생성 중...' : '이 서버로 생성'}
              </Button>

              {/* 생성 상태 표시 */}
              {genStatus?.status === 'generating' && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    생성 중...
                  </Typography>
                  <LinearProgress />
                </Box>
              )}

              {genStatus?.status === 'completed' && genStatus.generatedImage && (
                <Box sx={{ mt: 2 }}>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2">
                        이미지 생성 완료!
                      </Typography>
                      {genStatus.executionTime && (
                        <Typography variant="caption" color="text.secondary">
                          {genStatus.executionTime}초
                        </Typography>
                      )}
                    </Box>
                  </Alert>
                  <Card>
                    <CardMedia
                      component="img"
                      image={genStatus.generatedImage.thumbnail_url}
                      alt="Generated image"
                      sx={{ maxHeight: 300, objectFit: 'contain' }}
                    />
                    <CardContent>
                      <Button
                        fullWidth
                        variant="outlined"
                        onClick={() => navigate(`/image/${genStatus.imageId}`)}
                      >
                        이미지 상세보기
                      </Button>
                    </CardContent>
                  </Card>
                </Box>
              )}

              {genStatus?.status === 'failed' && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {genStatus.error || '이미지 생성에 실패했습니다'}
                </Alert>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* 워크플로우가 비활성 상태일 때 */}
      {!workflow.is_active && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          이 워크플로우는 현재 비활성 상태입니다. 이미지를 생성하려면 먼저 활성화해야 합니다.
        </Alert>
      )}
    </Box>
  );
}

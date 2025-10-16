import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Divider,
  IconButton,
  Chip,
  Card,
  CardContent
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Upload as UploadIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { workflowApi, type Workflow, type MarkedField } from '../../services/api/workflowApi';
import { MarkedFieldsGuide } from './MarkedFieldsGuide';
import { MarkedFieldsPreview } from './MarkedFieldsPreview';

export default function WorkflowFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 폼 데이터
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workflowJson, setWorkflowJson] = useState('');
  const [apiEndpoint, setApiEndpoint] = useState('http://127.0.0.1:8188');
  const [isActive, setIsActive] = useState(true);
  const [markedFields, setMarkedFields] = useState<MarkedField[]>([]);

  // JSON 유효성 검사
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode) {
      loadWorkflow();
    }
  }, [id]);

  const loadWorkflow = async () => {
    try {
      setLoading(true);
      const response = await workflowApi.getWorkflow(parseInt(id!));
      const workflow: Workflow = response.data;

      setName(workflow.name);
      setDescription(workflow.description || '');
      setWorkflowJson(workflow.workflow_json);
      setApiEndpoint(workflow.api_endpoint || 'http://127.0.0.1:8188');
      setIsActive(workflow.is_active);
      setMarkedFields(workflow.marked_fields || []);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWorkflowJsonChange = (value: string) => {
    setWorkflowJson(value);

    // JSON 유효성 검사
    if (value.trim()) {
      try {
        JSON.parse(value);
        setJsonError(null);
      } catch (err) {
        setJsonError('유효하지 않은 JSON 형식입니다');
      }
    } else {
      setJsonError(null);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        handleWorkflowJsonChange(content);
      };
      reader.readAsText(file);
    }
  };

  const addMarkedField = () => {
    const newField: MarkedField = {
      id: `field_${Date.now()}`,
      label: '',
      jsonPath: '',
      type: 'text',
      required: false
    };
    setMarkedFields([...markedFields, newField]);
  };

  const updateMarkedField = (index: number, updates: Partial<MarkedField>) => {
    const updated = [...markedFields];
    updated[index] = { ...updated[index], ...updates };
    setMarkedFields(updated);
  };

  const removeMarkedField = (index: number) => {
    setMarkedFields(markedFields.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    // 유효성 검사
    if (!name.trim()) {
      setError('워크플로우 이름을 입력하세요');
      return;
    }

    if (!workflowJson.trim()) {
      setError('Workflow JSON을 입력하세요');
      return;
    }

    if (jsonError) {
      setError('JSON 형식을 확인하세요');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const data = {
        name: name.trim(),
        description: description.trim() || undefined,
        workflow_json: workflowJson,
        marked_fields: markedFields.length > 0 ? markedFields : undefined,
        api_endpoint: apiEndpoint,
        is_active: isActive
      };

      if (isEditMode) {
        await workflowApi.updateWorkflow(parseInt(id!), data);
        setSuccess('워크플로우가 수정되었습니다');
      } else {
        await workflowApi.createWorkflow(data);
        setSuccess('워크플로우가 생성되었습니다');
      }

      // 잠시 후 목록으로 이동
      setTimeout(() => {
        navigate('/workflows');
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      {/* 헤더 */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={() => navigate('/workflows')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4">
          {isEditMode ? '워크플로우 편집' : '워크플로우 추가'}
        </Typography>
      </Box>

      {/* 알림 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      {/* 기본 정보 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          기본 정보
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <TextField
          fullWidth
          label="워크플로우 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          sx={{ mb: 2 }}
        />

        <TextField
          fullWidth
          label="설명"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={2}
          sx={{ mb: 2 }}
        />

        <TextField
          fullWidth
          label="API Endpoint"
          value={apiEndpoint}
          onChange={(e) => setApiEndpoint(e.target.value)}
          placeholder="http://127.0.0.1:8188"
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          }
          label="활성화"
        />
      </Paper>

      {/* Workflow JSON */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Workflow JSON
          </Typography>
          <Button
            component="label"
            startIcon={<UploadIcon />}
            size="small"
          >
            파일 업로드
            <input
              type="file"
              accept=".json"
              hidden
              onChange={handleFileUpload}
            />
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />

        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2">
            <strong>중요:</strong> ComfyUI에서 "Save (API Format)" 버튼으로 저장한 JSON을 사용하세요.
            일반 워크플로우 JSON은 작동하지 않습니다.
          </Typography>
        </Alert>

        <TextField
          fullWidth
          multiline
          rows={15}
          value={workflowJson}
          onChange={(e) => handleWorkflowJsonChange(e.target.value)}
          placeholder='{"prompt": {...}}'
          error={!!jsonError}
          helperText={jsonError || 'ComfyUI에서 Export한 Workflow API JSON을 붙여넣으세요'}
          sx={{
            '& .MuiInputBase-input': {
              fontFamily: 'monospace',
              fontSize: '0.875rem'
            }
          }}
        />

        {workflowJson && !jsonError && (
          <Box sx={{ mt: 2 }}>
            <Chip
              label={`${JSON.stringify(JSON.parse(workflowJson)).length} 문자`}
              size="small"
              color="success"
            />
          </Box>
        )}
      </Paper>

      {/* Marked Fields 가이드 */}
      <MarkedFieldsGuide />

      {/* Marked Fields (선택사항) */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Marked Fields 설정
          </Typography>
          <Button
            startIcon={<AddIcon />}
            onClick={addMarkedField}
            variant="contained"
            size="small"
          >
            필드 추가
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />

        {markedFields.map((field, index) => (
          <Card key={field.id} sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start' }}>
                <TextField
                  label="필드 ID"
                  value={field.id}
                  onChange={(e) => updateMarkedField(index, { id: e.target.value })}
                  size="small"
                  placeholder="prompt_positive"
                  helperText="고유 식별자"
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="라벨"
                  value={field.label}
                  onChange={(e) => updateMarkedField(index, { label: e.target.value })}
                  size="small"
                  placeholder="프롬프트"
                  helperText="사용자에게 표시될 이름"
                  sx={{ flex: 1 }}
                />
                <TextField
                  select
                  label="타입"
                  value={field.type}
                  onChange={(e) => updateMarkedField(index, { type: e.target.value as any })}
                  size="small"
                  helperText="입력 방식"
                  sx={{ flex: 1 }}
                  SelectProps={{ native: true }}
                >
                  <option value="text">텍스트 (한 줄)</option>
                  <option value="textarea">긴 텍스트 (여러 줄)</option>
                  <option value="number">숫자</option>
                  <option value="select">선택 (드롭다운)</option>
                </TextField>
                <IconButton
                  onClick={() => removeMarkedField(index)}
                  color="error"
                  size="small"
                  sx={{ mt: 1 }}
                >
                  <DeleteIcon />
                </IconButton>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                <TextField
                  fullWidth
                  label="JSON Path *"
                  value={field.jsonPath}
                  onChange={(e) => updateMarkedField(index, { jsonPath: e.target.value })}
                  placeholder="6.inputs.text"
                  size="small"
                  helperText="Workflow JSON 내 경로. 예: 6.inputs.text (6번 노드의 text 입력)"
                  sx={{ flex: 2 }}
                />
                <TextField
                  fullWidth
                  label="기본값"
                  value={field.default_value || ''}
                  onChange={(e) => updateMarkedField(index, { default_value: e.target.value })}
                  size="small"
                  placeholder={field.type === 'number' ? '512' : 'a beautiful landscape'}
                  helperText="비어있을 경우 표시될 값"
                  sx={{ flex: 1 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.required || false}
                      onChange={(e) => updateMarkedField(index, { required: e.target.checked })}
                      size="small"
                    />
                  }
                  label="필수"
                  sx={{ mt: 1 }}
                />
              </Box>

              {field.type === 'number' && (
                <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                  <TextField
                    label="최소값"
                    type="number"
                    value={field.min || ''}
                    onChange={(e) => updateMarkedField(index, { min: parseFloat(e.target.value) })}
                    size="small"
                    placeholder="1"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="최대값"
                    type="number"
                    value={field.max || ''}
                    onChange={(e) => updateMarkedField(index, { max: parseFloat(e.target.value) })}
                    size="small"
                    placeholder="150"
                    sx={{ flex: 1 }}
                  />
                </Box>
              )}

              {field.type === 'select' && (
                <TextField
                  fullWidth
                  label="선택 옵션 (쉼표로 구분)"
                  value={field.options?.join(', ') || ''}
                  onChange={(e) => updateMarkedField(index, {
                    options: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                  })}
                  size="small"
                  placeholder="euler, dpm++, ddim"
                  helperText="예: euler, dpm++ 2m, ddim"
                  sx={{ mb: 1 }}
                />
              )}
            </CardContent>
          </Card>
        ))}

        {markedFields.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
            <Typography variant="body2">
              Marked Fields가 없습니다. 추가하려면 "필드 추가" 버튼을 클릭하세요
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Marked Fields 미리보기 */}
      <MarkedFieldsPreview workflowJson={workflowJson} markedFields={markedFields} />

      {/* 저장 버튼 */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          onClick={() => navigate('/workflows')}
          disabled={saving}
        >
          취소
        </Button>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          onClick={handleSubmit}
          disabled={saving || !!jsonError || !name.trim() || !workflowJson.trim()}
        >
          {saving ? '저장 중...' : (isEditMode ? '수정' : '생성')}
        </Button>
      </Box>
    </Box>
  );
}

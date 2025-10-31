import { useState, useEffect, useCallback, useRef } from 'react';
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
  Upload as UploadIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { workflowApi, type Workflow, type MarkedField } from '../../services/api/workflowApi';
import { MarkedFieldsGuide } from './MarkedFieldsGuide';
import { MarkedFieldsPreview } from './MarkedFieldsPreview';
import WorkflowViewer from './components/WorkflowViewer';

export default function WorkflowFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const { t } = useTranslation(['workflows', 'common']);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 폼 데이터
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workflowJson, setWorkflowJson] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [color, setColor] = useState('#2196f3');
  const [markedFields, setMarkedFields] = useState<MarkedField[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Color picker debounce
  const colorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleColorChange = useCallback((newColor: string) => {
    if (colorTimeoutRef.current) {
      clearTimeout(colorTimeoutRef.current);
    }
    colorTimeoutRef.current = setTimeout(() => {
      setColor(newColor);
    }, 100); // 100ms debounce
  }, []);

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
      setIsActive(workflow.is_active);
      setColor(workflow.color || '#2196f3');
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
        setJsonError(t('workflows:form.invalidJson'));
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
      setError(t('workflows:form.nameRequired'));
      return;
    }

    if (!workflowJson.trim()) {
      setError(t('workflows:form.jsonRequired'));
      return;
    }

    if (jsonError) {
      setError(t('workflows:form.validateJson'));
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
        is_active: isActive,
        color: color
      };

      if (isEditMode) {
        await workflowApi.updateWorkflow(parseInt(id!), data);
        setSuccess(t('workflows:alerts.updated'));
      } else {
        await workflowApi.createWorkflow(data);
        setSuccess(t('workflows:alerts.created'));
      }

      // 잠시 후 목록으로 이동
      setTimeout(() => {
        navigate('/image-generation?tab=workflows');
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
        <IconButton onClick={() => navigate('/image-generation?tab=workflows')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4">
          {isEditMode ? t('workflows:page.editTitle') : t('workflows:page.createTitle')}
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
          {t('workflows:form.basicInfo')}
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <TextField
          fullWidth
          label={t('workflows:form.workflowName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          sx={{ mb: 2 }}
        />

        <TextField
          fullWidth
          label={t('workflows:form.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={2}
          sx={{ mb: 2 }}
        />

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            워크플로우 색상
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {[
              { color: '#2196f3', label: '파란색 (기본)' },
              { color: '#f44336', label: '빨간색' },
              { color: '#4caf50', label: '초록색' },
              { color: '#ff9800', label: '주황색' },
              { color: '#9c27b0', label: '보라색' },
              { color: '#00bcd4', label: '청록색' },
              { color: '#ffeb3b', label: '노란색' },
              { color: '#795548', label: '갈색' },
              { color: '#607d8b', label: '회색' },
              { color: '#e91e63', label: '핑크색' },
            ].map((item) => (
              <Box
                key={item.color}
                onClick={() => setColor(item.color)}
                sx={{
                  width: 40,
                  height: 40,
                  bgcolor: item.color,
                  borderRadius: 1,
                  cursor: 'pointer',
                  border: color === item.color ? '3px solid #000' : '2px solid #ddd',
                  transition: 'all 0.2s',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    boxShadow: 2,
                  },
                }}
                title={item.label}
              />
            ))}
            <input
              type="color"
              defaultValue={color}
              onInput={(e) => handleColorChange((e.target as HTMLInputElement).value)}
              style={{
                width: '40px',
                height: '40px',
                border: '2px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="직접 색상 선택"
            />
          </Box>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          }
          label={t('workflows:form.activate')}
        />
      </Paper>

      {/* Workflow JSON */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            {t('workflows:form.workflowJson')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {workflowJson && !jsonError && (
              <Button
                variant="outlined"
                startIcon={<ViewIcon />}
                size="small"
                onClick={() => setViewerOpen(true)}
              >
                View Graph
              </Button>
            )}
            <Button
              component="label"
              startIcon={<UploadIcon />}
              size="small"
            >
              {t('workflows:form.uploadFile')}
              <input
                type="file"
                accept=".json"
                hidden
                onChange={handleFileUpload}
              />
            </Button>
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />

        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2">
            <strong>{t('workflows:alerts.importantNote')}</strong> {t('workflows:alerts.apiFormatWarning')}
          </Typography>
        </Alert>

        <TextField
          fullWidth
          multiline
          rows={15}
          value={workflowJson}
          onChange={(e) => handleWorkflowJsonChange(e.target.value)}
          placeholder={t('workflows:form.jsonPlaceholder')}
          error={!!jsonError}
          helperText={jsonError || t('workflows:form.jsonHelper')}
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
              label={t('workflows:form.jsonCharCount', { count: JSON.stringify(JSON.parse(workflowJson)).length })}
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
            {t('workflows:markedFields.sectionTitle')}
          </Typography>
          <Button
            startIcon={<AddIcon />}
            onClick={addMarkedField}
            variant="contained"
            size="small"
          >
            {t('workflows:markedFields.addField')}
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />

        {markedFields.map((field, index) => (
          <Card key={field.id} sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start' }}>
                <TextField
                  label={t('workflows:fieldForm.fieldId')}
                  value={field.id}
                  onChange={(e) => updateMarkedField(index, { id: e.target.value })}
                  size="small"
                  placeholder={t('workflows:fieldForm.fieldIdPlaceholder')}
                  helperText={t('workflows:fieldForm.fieldIdHelper')}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label={t('workflows:fieldForm.label')}
                  value={field.label}
                  onChange={(e) => updateMarkedField(index, { label: e.target.value })}
                  size="small"
                  placeholder={t('workflows:fieldForm.labelPlaceholder')}
                  helperText={t('workflows:fieldForm.labelHelper')}
                  sx={{ flex: 1 }}
                />
                <TextField
                  select
                  label={t('workflows:fieldForm.type')}
                  value={field.type}
                  onChange={(e) => updateMarkedField(index, { type: e.target.value as any })}
                  size="small"
                  helperText={t('workflows:fieldForm.typeHelper')}
                  sx={{ flex: 1 }}
                  SelectProps={{ native: true }}
                >
                  <option value="text">{t('workflows:fieldForm.typeText')}</option>
                  <option value="textarea">{t('workflows:fieldForm.typeTextarea')}</option>
                  <option value="number">{t('workflows:fieldForm.typeNumber')}</option>
                  <option value="select">{t('workflows:fieldForm.typeSelect')}</option>
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
                  label={t('workflows:fieldForm.jsonPath')}
                  value={field.jsonPath}
                  onChange={(e) => updateMarkedField(index, { jsonPath: e.target.value })}
                  placeholder={t('workflows:fieldForm.jsonPathPlaceholder')}
                  size="small"
                  helperText={t('workflows:fieldForm.jsonPathHelper')}
                  sx={{ flex: 2 }}
                />
                <TextField
                  fullWidth
                  label={t('workflows:fieldForm.defaultValue')}
                  value={field.default_value || ''}
                  onChange={(e) => updateMarkedField(index, { default_value: e.target.value })}
                  size="small"
                  placeholder={t('workflows:fieldForm.defaultValuePlaceholder')}
                  helperText={t('workflows:fieldForm.defaultValueHelper')}
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
                  label={t('workflows:fieldForm.required')}
                  sx={{ mt: 1 }}
                />
              </Box>

              {field.type === 'number' && (
                <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                  <TextField
                    label={t('workflows:fieldForm.minValue')}
                    type="number"
                    value={field.min || ''}
                    onChange={(e) => updateMarkedField(index, { min: parseFloat(e.target.value) })}
                    size="small"
                    placeholder={t('workflows:fieldForm.minPlaceholder')}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label={t('workflows:fieldForm.maxValue')}
                    type="number"
                    value={field.max || ''}
                    onChange={(e) => updateMarkedField(index, { max: parseFloat(e.target.value) })}
                    size="small"
                    placeholder={t('workflows:fieldForm.maxPlaceholder')}
                    sx={{ flex: 1 }}
                  />
                </Box>
              )}

              {field.type === 'select' && (
                <TextField
                  fullWidth
                  label={t('workflows:fieldForm.selectOptions')}
                  value={field.options?.join(', ') || ''}
                  onChange={(e) => updateMarkedField(index, {
                    options: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                  })}
                  size="small"
                  placeholder={t('workflows:fieldForm.selectOptionsPlaceholder')}
                  helperText={t('workflows:fieldForm.selectOptionsHelper')}
                  sx={{ mb: 1 }}
                />
              )}
            </CardContent>
          </Card>
        ))}

        {markedFields.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
            <Typography variant="body2">
              {t('workflows:markedFields.noFields')}
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
          onClick={() => navigate('/image-generation?tab=workflows')}
          disabled={saving}
        >
          {t('workflows:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          onClick={handleSubmit}
          disabled={saving || !!jsonError || !name.trim() || !workflowJson.trim()}
        >
          {saving ? t('workflows:actions.saving') : (isEditMode ? t('workflows:actions.update') : t('workflows:actions.create'))}
        </Button>
      </Box>

      {/* Workflow Viewer Dialog */}
      {workflowJson && !jsonError && (
        <WorkflowViewer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          workflowName={name || 'Workflow Preview'}
          workflowJson={workflowJson}
        />
      )}
    </Box>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Divider,
  Chip,
  Tabs,
  Tab,
  IconButton,
  FormControlLabel,
  Switch
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Add as AddIcon,
  Upload as UploadIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { workflowApi, type Workflow, type MarkedField } from '../../services/api/workflowApi';
import { MarkedFieldsGuide } from './MarkedFieldsGuide';
import { MarkedFieldsPreview } from './MarkedFieldsPreview';
import EnhancedWorkflowGraphViewer from './components/EnhancedWorkflowGraphViewer';
import WorkflowJsonViewer from './components/WorkflowJsonViewer';
import { MarkedFieldsList, useMarkedFieldValidation } from './components/MarkedFields';

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
  const [jsonTabValue, setJsonTabValue] = useState(0);

  // Validation hook for marked fields
  const validation = useMarkedFieldValidation(markedFields);

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

  // Handle parameter right-click from Graph View
  const handleParameterRightClick = (
    nodeId: string,
    paramKey: string,
    paramValue: any
  ) => {
    const jsonPath = `${nodeId}.inputs.${paramKey}`;

    // Check for duplicates
    const isDuplicate = markedFields.some((field) => field.jsonPath === jsonPath);
    if (isDuplicate) {
      setError(`Parameter "${paramKey}" from node ${nodeId} is already in Marked Fields`);
      setTimeout(() => setError(null), 3000);
      return;
    }

    // Infer field type from value
    let fieldType: 'text' | 'number' | 'textarea' = 'text';
    if (typeof paramValue === 'number') {
      fieldType = 'number';
    } else if (typeof paramValue === 'string' && paramValue.length > 100) {
      fieldType = 'textarea';
    }

    // Create new marked field
    const newField: MarkedField = {
      id: `field_${Date.now()}`,
      label: `${paramKey} (Node ${nodeId})`,
      jsonPath,
      type: fieldType,
      required: false,
    };

    setMarkedFields([...markedFields, newField]);
    setSuccess(`Added "${paramKey}" from Node ${nodeId} to Marked Fields`);
    setTimeout(() => setSuccess(null), 3000);
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

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={jsonTabValue} onChange={(_, newValue) => setJsonTabValue(newValue)}>
            <Tab label="JSON Editor" />
            <Tab label="Graph View" disabled={!workflowJson || !!jsonError} />
            <Tab label="JSON View" disabled={!workflowJson || !!jsonError} />
          </Tabs>
        </Box>

        {/* Tab Panel 0: JSON Editor */}
        <Box role="tabpanel" hidden={jsonTabValue !== 0}>
          {jsonTabValue === 0 && (
            <>
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
            </>
          )}
        </Box>

        {/* Tab Panel 1: Graph View */}
        <Box role="tabpanel" hidden={jsonTabValue !== 1}>
          {jsonTabValue === 1 && workflowJson && !jsonError && (
            <Box sx={{ height: '600px', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <EnhancedWorkflowGraphViewer
                workflowJson={workflowJson}
                onParameterRightClick={handleParameterRightClick}
              />
            </Box>
          )}
        </Box>

        {/* Tab Panel 2: JSON View */}
        <Box role="tabpanel" hidden={jsonTabValue !== 2}>
          {jsonTabValue === 2 && workflowJson && !jsonError && (
            <Box sx={{ height: '600px', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'auto' }}>
              <WorkflowJsonViewer workflowJson={workflowJson} />
            </Box>
          )}
        </Box>
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

        {/* Validation Summary */}
        {(validation.errorCount > 0 || validation.warningCount > 0) && (
          <Alert severity={validation.errorCount > 0 ? 'error' : 'warning'} sx={{ mb: 2 }}>
            {validation.errorCount > 0 && (
              <Typography variant="body2">
                {validation.errorCount} error{validation.errorCount > 1 ? 's' : ''} found
              </Typography>
            )}
            {validation.warningCount > 0 && (
              <Typography variant="body2">
                {validation.warningCount} warning{validation.warningCount > 1 ? 's' : ''} found
              </Typography>
            )}
          </Alert>
        )}

        {/* Marked Fields List with drag-and-drop */}
        <MarkedFieldsList
          fields={markedFields}
          onFieldsChange={setMarkedFields}
          onUpdateField={updateMarkedField}
          onDeleteField={removeMarkedField}
        />
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
    </Box>
  );
}

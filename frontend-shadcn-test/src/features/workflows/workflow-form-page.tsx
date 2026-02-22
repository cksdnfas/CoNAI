import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Upload as UploadIcon,
} from '@mui/icons-material'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { workflowApi, type MarkedField, type Workflow } from '@/services/workflow-api'
import { MarkedFieldsGuide } from './components/marked-fields-guide'
import { MarkedFieldsPreview } from './components/marked-fields-preview'
import EnhancedWorkflowGraphViewer from '../../../legacy-src/pages/Workflows/components/EnhancedWorkflowGraphViewer'
import { MarkedFieldsList, useMarkedFieldValidation } from '../../../legacy-src/pages/Workflows/components/MarkedFields'
import WorkflowJsonViewer from './components/workflow-json-viewer'

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeResponse = error as {
      response?: { data?: { error?: string } }
      message?: string
    }
    return maybeResponse.response?.data?.error || maybeResponse.message || 'Unknown error'
  }
  return 'Unknown error'
}

export function WorkflowFormPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isEditMode = Boolean(id)
  const { t } = useTranslation(['workflows', 'common'])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workflowJson, setWorkflowJson] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [color, setColor] = useState('#2196f3')
  const [markedFields, setMarkedFields] = useState<MarkedField[]>([])
  const [jsonTabValue, setJsonTabValue] = useState(0)

  const validation = useMarkedFieldValidation(markedFields)
  const colorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleColorChange = useCallback((newColor: string) => {
    if (colorTimeoutRef.current) {
      clearTimeout(colorTimeoutRef.current)
    }
    colorTimeoutRef.current = setTimeout(() => {
      setColor(newColor)
    }, 100)
  }, [])

  const [jsonError, setJsonError] = useState<string | null>(null)

  const loadWorkflow = useCallback(async () => {
    if (!id) {
      return
    }

    try {
      setLoading(true)
      const response = await workflowApi.getWorkflow(parseInt(id, 10))
      const workflow: Workflow = response.data

      setName(workflow.name)
      setDescription(workflow.description || '')
      setWorkflowJson(workflow.workflow_json)
      setIsActive(workflow.is_active)
      setColor(workflow.color || '#2196f3')
      setMarkedFields(workflow.marked_fields || [])
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (isEditMode) {
      void loadWorkflow()
    }
  }, [isEditMode, loadWorkflow])

  const handleWorkflowJsonChange = (value: string) => {
    setWorkflowJson(value)
    if (value.trim()) {
      try {
        JSON.parse(value)
        setJsonError(null)
      } catch {
        setJsonError(t('workflows:form.invalidJson'))
      }
    } else {
      setJsonError(null)
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = (readerEvent) => {
      const content = readerEvent.target?.result
      if (typeof content === 'string') {
        handleWorkflowJsonChange(content)
      }
    }
    reader.readAsText(file)
  }

  const addMarkedField = () => {
    const newField: MarkedField = {
      id: `field_${Date.now()}`,
      label: '',
      jsonPath: '',
      type: 'text',
      required: false,
    }
    setMarkedFields([...markedFields, newField])
  }

  const updateMarkedField = (index: number, updates: Partial<MarkedField>) => {
    const updated = [...markedFields]
    updated[index] = { ...updated[index], ...updates }
    setMarkedFields(updated)
  }

  const removeMarkedField = (index: number) => {
    setMarkedFields(markedFields.filter((_, fieldIndex) => fieldIndex !== index))
  }

  const handleParameterRightClick = (
    nodeId: string,
    paramKey: string,
    paramValue: unknown,
    paramType: string,
    nodeTitle: string,
    classType: string,
  ) => {
    void paramType
    void classType
    const jsonPath = `${nodeId}.inputs.${paramKey}`
    const isDuplicate = markedFields.some((field) => field.jsonPath === jsonPath)
    if (isDuplicate) {
      setError(`Parameter "${paramKey}" from node ${nodeId} is already in Marked Fields`)
      window.setTimeout(() => setError(null), 3000)
      return
    }

    let fieldType: 'text' | 'number' | 'textarea' = 'text'
    if (typeof paramValue === 'number') {
      fieldType = 'number'
    } else if (typeof paramValue === 'string' && paramValue.length > 100) {
      fieldType = 'textarea'
    }

    const cleanTitle = nodeTitle
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')

    const autoLabel = `#${nodeId}_${cleanTitle}(${paramKey.toUpperCase()})`

    const newField: MarkedField = {
      id: `field_${Date.now()}`,
      label: autoLabel,
      jsonPath,
      type: fieldType,
      required: false,
    }

    setMarkedFields([...markedFields, newField])
    setSuccess(`Added "${paramKey}" from Node ${nodeId} to Marked Fields`)
    window.setTimeout(() => setSuccess(null), 3000)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('workflows:form.nameRequired'))
      return
    }

    if (!workflowJson.trim()) {
      setError(t('workflows:form.jsonRequired'))
      return
    }

    if (jsonError) {
      setError(t('workflows:form.validateJson'))
      return
    }

    try {
      setSaving(true)
      setError(null)

      const data = {
        name: name.trim(),
        description: description.trim() || undefined,
        workflow_json: workflowJson,
        marked_fields: markedFields.length > 0 ? markedFields : undefined,
        is_active: isActive,
        color,
      }

      if (isEditMode && id) {
        await workflowApi.updateWorkflow(parseInt(id, 10), data)
        setSuccess(t('workflows:alerts.updated'))
      } else {
        await workflowApi.createWorkflow(data)
        setSuccess(t('workflows:alerts.created'))
      }

      window.setTimeout(() => {
        navigate('/image-generation?tab=workflows')
      }, 1500)
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={() => navigate('/image-generation?tab=workflows')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4">{isEditMode ? t('workflows:page.editTitle') : t('workflows:page.createTitle')}</Typography>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {success ? <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert> : null}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          {t('workflows:form.basicInfo')}
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <TextField
          fullWidth
          label={t('workflows:form.workflowName')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          sx={{ mb: 2 }}
        />

        <TextField
          fullWidth
          label={t('workflows:form.description')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          multiline
          rows={2}
          sx={{ mb: 2 }}
        />

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('workflows:form.colorLabel')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {[
              { color: '#2196f3', label: t('workflows:colors.blue') },
              { color: '#f44336', label: t('workflows:colors.red') },
              { color: '#4caf50', label: t('workflows:colors.green') },
              { color: '#ff9800', label: t('workflows:colors.orange') },
              { color: '#9c27b0', label: t('workflows:colors.purple') },
              { color: '#00bcd4', label: t('workflows:colors.cyan') },
              { color: '#ffeb3b', label: t('workflows:colors.yellow') },
              { color: '#795548', label: t('workflows:colors.brown') },
              { color: '#607d8b', label: t('workflows:colors.gray') },
              { color: '#e91e63', label: t('workflows:colors.pink') },
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
              onInput={(event) => handleColorChange((event.target as HTMLInputElement).value)}
              style={{
                width: '40px',
                height: '40px',
                border: '2px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title={t('workflows:form.customColorTooltip')}
            />
          </Box>
        </Box>

        <FormControlLabel
          control={<Switch checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />}
          label={t('workflows:form.activate')}
        />
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{t('workflows:form.workflowJson')}</Typography>
          <Button component="label" startIcon={<UploadIcon />} size="small">
            {t('workflows:form.uploadFile')}
            <input type="file" accept=".json" hidden onChange={handleFileUpload} />
          </Button>
        </Box>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={jsonTabValue} onChange={(_event, newValue) => setJsonTabValue(newValue)}>
            <Tab label="JSON Editor" />
            <Tab label="Graph View" disabled={!workflowJson || Boolean(jsonError)} />
            <Tab label="JSON View" disabled={!workflowJson || Boolean(jsonError)} />
          </Tabs>
        </Box>

        <Box role="tabpanel" hidden={jsonTabValue !== 0}>
          {jsonTabValue === 0 ? (
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
                onChange={(event) => handleWorkflowJsonChange(event.target.value)}
                placeholder={t('workflows:form.jsonPlaceholder')}
                error={Boolean(jsonError)}
                helperText={jsonError || t('workflows:form.jsonHelper')}
                sx={{
                  '& .MuiInputBase-input': {
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                  },
                }}
              />

              {workflowJson && !jsonError ? (
                <Box sx={{ mt: 2 }}>
                  <Chip
                    label={t('workflows:form.jsonCharCount', { count: JSON.stringify(JSON.parse(workflowJson)).length })}
                    size="small"
                    color="success"
                  />
                </Box>
              ) : null}
            </>
          ) : null}
        </Box>

        <Box role="tabpanel" hidden={jsonTabValue !== 1}>
          {jsonTabValue === 1 && workflowJson && !jsonError ? (
            <Box sx={{ height: '600px', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <EnhancedWorkflowGraphViewer workflowJson={workflowJson} onParameterRightClick={handleParameterRightClick} />
            </Box>
          ) : null}
        </Box>

        <Box role="tabpanel" hidden={jsonTabValue !== 2}>
          {jsonTabValue === 2 && workflowJson && !jsonError ? (
            <Box sx={{ height: '600px', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'auto' }}>
              <WorkflowJsonViewer workflowJson={workflowJson} />
            </Box>
          ) : null}
        </Box>
      </Paper>

      <MarkedFieldsGuide />

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{t('workflows:markedFields.sectionTitle')}</Typography>
          <Button startIcon={<AddIcon />} onClick={addMarkedField} variant="contained" size="small">
            {t('workflows:markedFields.addField')}
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />

        {validation.errorCount > 0 || validation.warningCount > 0 ? (
          <Alert severity={validation.errorCount > 0 ? 'error' : 'warning'} sx={{ mb: 2 }}>
            {validation.errorCount > 0 ? (
              <Typography variant="body2">
                {validation.errorCount} error{validation.errorCount > 1 ? 's' : ''} found
              </Typography>
            ) : null}
            {validation.warningCount > 0 ? (
              <Typography variant="body2">
                {validation.warningCount} warning{validation.warningCount > 1 ? 's' : ''} found
              </Typography>
            ) : null}
          </Alert>
        ) : null}

        <MarkedFieldsList
          fields={markedFields}
          onFieldsChange={setMarkedFields}
          onUpdateField={updateMarkedField}
          onDeleteField={removeMarkedField}
        />
      </Paper>

      <MarkedFieldsPreview workflowJson={workflowJson} markedFields={markedFields} />

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" onClick={() => navigate('/image-generation?tab=workflows')} disabled={saving}>
          {t('workflows:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          onClick={handleSubmit}
          disabled={saving || Boolean(jsonError) || !name.trim() || !workflowJson.trim()}
        >
          {saving ? t('workflows:actions.saving') : isEditMode ? t('workflows:actions.update') : t('workflows:actions.create')}
        </Button>
      </Box>
    </Box>
  )
}

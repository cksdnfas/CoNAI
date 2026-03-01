import { useState } from 'react'
import { Box,
Typography,
Paper,
Alert,
Divider,
Button,
TextField,
Accordion,
AccordionSummary,
AccordionDetails, } from '@/features/workflows/utils/workflow-ui'
import { Visibility as VisibilityIcon,
ExpandMore as ExpandMoreIcon,
CheckCircle as CheckCircleIcon,
Error as ErrorIcon, } from '@/features/workflows/utils/workflow-icons'
import { useTranslation } from 'react-i18next'
import type { MarkedField } from '@/services/workflow-api'

interface MarkedFieldsPreviewProps {
  workflowJson: string
  markedFields: MarkedField[]
}

export function MarkedFieldsPreview({ workflowJson, markedFields }: MarkedFieldsPreviewProps) {
  const { t } = useTranslation(['workflows'])
  const [testData, setTestData] = useState<Record<string, unknown>>({})
  const [showSubstituted, setShowSubstituted] = useState(false)

  let workflowObj: Record<string, unknown> | null = null
  let parseError: string | null = null

  try {
    if (workflowJson.trim()) {
      workflowObj = JSON.parse(workflowJson) as Record<string, unknown>
    }
  } catch {
    parseError = t('workflows:preview.parseError')
  }

  const validatePath = (jsonPath: string): { valid: boolean; currentValue: unknown; error?: string } => {
    if (!workflowObj) {
      return { valid: false, currentValue: null, error: t('workflows:preview.noJson') }
    }

    try {
      const keys = jsonPath.split('.')
      let current: unknown = workflowObj

      for (const key of keys) {
        if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
          current = (current as Record<string, unknown>)[key]
        } else {
          return { valid: false, currentValue: null, error: t('workflows:preview.pathNotFound', { path: jsonPath }) }
        }
      }

      return { valid: true, currentValue: current }
    } catch {
      return { valid: false, currentValue: null, error: t('workflows:preview.validationError') }
    }
  }

  const generateTestData = () => {
    const data: Record<string, unknown> = {}
    markedFields.forEach((field) => {
      data[field.id] = field.default_value || (field.type === 'number' ? 0 : '')
    })
    setTestData(data)
    setShowSubstituted(true)
  }

  const substituteTestData = (): string => {
    if (!workflowObj) return ''

    try {
      const cloned = JSON.parse(JSON.stringify(workflowObj)) as Record<string, unknown>

      markedFields.forEach((field) => {
        const value = testData[field.id] ?? field.default_value
        if (value === undefined || value === null) return

        const keys = field.jsonPath.split('.')
        let current: Record<string, unknown> = cloned

        for (let i = 0; i < keys.length - 1; i += 1) {
          if (!(keys[i] in current)) {
            current[keys[i]] = {}
          }
          current = current[keys[i]] as Record<string, unknown>
        }

        const lastKey = keys[keys.length - 1]
        current[lastKey] = field.type === 'number' ? parseFloat(String(value)) || 0 : value
      })

      return JSON.stringify(cloned, null, 2)
    } catch {
      return t('workflows:preview.substitutionError')
    }
  }

  const renderField = (field: MarkedField) => {
    const value = (testData[field.id] ?? field.default_value ?? '') as string | number

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
            onChange={(event) => setTestData({ ...testData, [field.id]: event.target.value })}
            placeholder={field.placeholder}
            size="small"
            sx={{ mb: 2 }}
          />
        )

      case 'number':
        return (
          <TextField
            key={field.id}
            fullWidth
            type="number"
            label={field.label}
            value={value}
            onChange={(event) => setTestData({ ...testData, [field.id]: event.target.value })}
            placeholder={field.placeholder}
            inputProps={{
              min: field.min,
              max: field.max,
            }}
            size="small"
            sx={{ mb: 2 }}
          />
        )

      case 'select':
        return (
          <TextField
            key={field.id}
            fullWidth
            select
            label={field.label}
            value={value}
            onChange={(event) => setTestData({ ...testData, [field.id]: event.target.value })}
            SelectProps={{ native: true }}
            size="small"
            sx={{ mb: 2 }}
          >
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </TextField>
        )

      default:
        return (
          <TextField
            key={field.id}
            fullWidth
            label={field.label}
            value={value}
            onChange={(event) => setTestData({ ...testData, [field.id]: event.target.value })}
            placeholder={field.placeholder}
            size="small"
            sx={{ mb: 2 }}
          />
        )
    }
  }

  if (markedFields.length === 0) {
    return null
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <VisibilityIcon color="primary" />
        <Typography variant="h6">{t('workflows:preview.title')}</Typography>
      </Box>
      <Divider sx={{ mb: 3 }} />

      {parseError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {parseError}
        </Alert>
      ) : null}

      {workflowObj ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            {t('workflows:preview.validationResults')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {markedFields.map((field) => {
              const validation = validatePath(field.jsonPath)
              return (
                <Box
                  key={field.id}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    p: 1,
                    bgcolor: validation.valid ? 'success.50' : 'error.50',
                    borderRadius: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {validation.valid ? <CheckCircleIcon color="success" fontSize="small" /> : <ErrorIcon color="error" fontSize="small" />}
                    <Typography variant="body2">
                      <strong>{field.label}</strong> ({field.jsonPath})
                    </Typography>
                  </Box>
                  {validation.valid && validation.currentValue !== undefined ? (
                    <Box
                      sx={{
                        ml: 4,
                        p: 1,
                        bgcolor: 'background.paper',
                        borderRadius: 0.5,
                        wordBreak: 'break-word',
                        maxWidth: '100%',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        {t('workflows:preview.currentValue')}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          mt: 0.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                        }}
                      >
                        {JSON.stringify(validation.currentValue)}
                      </Typography>
                    </Box>
                  ) : null}
                  {!validation.valid ? (
                    <Typography variant="caption" color="error" sx={{ ml: 4 }}>
                      ⚠️ {validation.error}
                    </Typography>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        </Box>
      ) : null}

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          {t('workflows:preview.formTitle')}
        </Typography>
        <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}>
          {markedFields.map((field) => renderField(field))}
          <Button variant="contained" fullWidth disabled>
            {t('workflows:preview.generateButton')}
          </Button>
        </Box>
      </Box>

      <Box>
        <Button variant="outlined" onClick={generateTestData} sx={{ mb: 2 }}>
          {t('workflows:preview.testDataButton')}
        </Button>

        {showSubstituted ? (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2">{t('workflows:preview.viewJsonTitle')}</Typography>
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
                  fontFamily: 'monospace',
                }}
              >
                {substituteTestData()}
              </Box>
            </AccordionDetails>
          </Accordion>
        ) : null}
      </Box>
    </Paper>
  )
}

import { useState } from 'react'
import { Alert, Box, IconButton, Paper, Snackbar, Tooltip, Typography } from '@mui/material'
import { ContentCopy as CopyIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'

interface WorkflowJsonViewerProps {
  workflowJson: string | object
}

export default function WorkflowJsonViewer({ workflowJson }: WorkflowJsonViewerProps) {
  const { t } = useTranslation(['workflows'])
  const [copySuccess, setCopySuccess] = useState(false)

  const jsonString = typeof workflowJson === 'string' ? workflowJson : JSON.stringify(workflowJson, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopySuccess(true)
    } catch (copyError) {
      console.error('Failed to copy:', copyError)
    }
  }

  const renderJsonWithHighlight = (json: string) => {
    const lines = json.split('\n')

    return lines.map((line, index) => {
      const highlightedLine = line
        .replace(/"([^"]+)":/g, '<span style="color: #e06c75;">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span style="color: #98c379;">"$1"</span>')
        .replace(/: (\d+\.?\d*)/g, ': <span style="color: #d19a66;">$1</span>')
        .replace(/: (true|false|null)/g, ': <span style="color: #56b6c2;">$1</span>')
        .replace(/([{}[\]])/g, '<span style="color: #abb2bf;">$1</span>')

      return (
        <div
          key={index}
          style={{
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: '0.875rem',
            lineHeight: '1.5',
            padding: '2px 0',
          }}
          dangerouslySetInnerHTML={{ __html: highlightedLine }}
        />
      )
    })
  }

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, px: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {t('workflows:jsonViewer.title')}
        </Typography>
        <Tooltip title={t('workflows:jsonViewer.copyToClipboard')}>
          <IconButton size="small" onClick={handleCopy}>
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          overflow: 'auto',
          bgcolor: '#282c34',
          color: '#abb2bf',
          p: 2,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {renderJsonWithHighlight(jsonString)}
      </Paper>

      <Snackbar
        open={copySuccess}
        autoHideDuration={2000}
        onClose={() => setCopySuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setCopySuccess(false)} severity="success" sx={{ width: '100%' }}>
          {t('workflows:jsonViewer.copied')}
        </Alert>
      </Snackbar>
    </Box>
  )
}

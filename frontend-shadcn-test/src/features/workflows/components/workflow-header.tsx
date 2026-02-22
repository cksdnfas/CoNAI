import { Box, Chip, IconButton, Typography } from '@mui/material'
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Workflow } from '../../../../legacy-src/services/api/workflowApi'

interface WorkflowHeaderProps {
  workflow: Workflow
}

export function WorkflowHeader({ workflow }: WorkflowHeaderProps) {
  const navigate = useNavigate()
  const { t } = useTranslation(['workflows'])

  return (
    <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
      <IconButton onClick={() => navigate('/image-generation?tab=workflows')}>
        <ArrowBackIcon />
      </IconButton>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h4">{workflow.name}</Typography>
        {workflow.description ? (
          <Typography variant="body2" color="text.secondary">
            {workflow.description}
          </Typography>
        ) : null}
      </Box>
      {!workflow.is_active ? <Chip label={t('workflows:card.inactive')} color="default" /> : null}
    </Box>
  )
}

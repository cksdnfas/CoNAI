import { Box, Typography, IconButton, Chip } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Workflow } from '../../../services/api/workflowApi';

interface WorkflowHeaderProps {
  workflow: Workflow;
}

/**
 * 워크플로우 헤더 컴포넌트
 * - 뒤로가기 버튼
 * - 워크플로우 이름 및 설명
 * - 비활성 상태 표시
 */
export function WorkflowHeader({ workflow }: WorkflowHeaderProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(['workflows']);

  return (
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
  );
}

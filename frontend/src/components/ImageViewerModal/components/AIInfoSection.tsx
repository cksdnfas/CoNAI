import React, { useState } from 'react';
import { Box, Typography, IconButton, Collapse } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';

interface AIInfoSectionProps {
  image: ImageRecord;
}

/**
 * Collapsible AI generation information section
 */
export const AIInfoSection: React.FC<AIInfoSectionProps> = ({ image }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true); // 기본 펼쳐진 상태
  const hasAIInfo = image.ai_tool || image.model_name || image.steps ||
                    image.cfg_scale || image.sampler || image.seed;

  if (!hasAIInfo) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          px: 1,
          py: 0.5,
          borderRadius: 1,
          mb: 1,
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Typography variant="subtitle2" color="primary">
          {t('imageDetail:sections.aiInfo')}
        </Typography>
        <IconButton size="small" sx={{ p: 0 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
          {image.ai_tool && (
            <Typography variant="body2">
              {t('imageDetail:aiInfo.toolShort')}: {image.ai_tool}
            </Typography>
          )}
          {image.model_name && (
            <Typography variant="body2">
              {t('imageDetail:aiInfo.model')}: {image.model_name}
            </Typography>
          )}
          {image.steps && (
            <Typography variant="body2">
              {t('imageDetail:aiInfo.steps')}: {image.steps}
            </Typography>
          )}
          {image.cfg_scale && (
            <Typography variant="body2">
              {t('imageDetail:aiInfo.cfgShort')}: {image.cfg_scale}
            </Typography>
          )}
          {image.sampler && (
            <Typography variant="body2">
              {t('imageDetail:aiInfo.sampler')}: {image.sampler}
            </Typography>
          )}
          {image.seed && (
            <Typography variant="body2">
              {t('imageDetail:aiInfo.seed')}: {image.seed}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

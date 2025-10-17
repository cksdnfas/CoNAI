import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';

interface AIInfoSectionProps {
  image: ImageRecord;
}

/**
 * AI generation information section
 */
export const AIInfoSection: React.FC<AIInfoSectionProps> = ({ image }) => {
  const { t } = useTranslation();
  const hasAIInfo = image.ai_tool || image.model_name || image.steps ||
                    image.cfg_scale || image.sampler || image.seed;

  if (!hasAIInfo) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" gutterBottom color="primary">
        {t('imageDetail:sections.aiInfo')}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
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
    </Box>
  );
};

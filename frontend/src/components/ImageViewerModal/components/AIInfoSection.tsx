import React from 'react';
import { Box, Typography } from '@mui/material';
import type { ImageRecord } from '../../../types/image';

interface AIInfoSectionProps {
  image: ImageRecord;
}

/**
 * AI generation information section
 */
export const AIInfoSection: React.FC<AIInfoSectionProps> = ({ image }) => {
  const hasAIInfo = image.ai_tool || image.model_name || image.steps ||
                    image.cfg_scale || image.sampler || image.seed;

  if (!hasAIInfo) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" gutterBottom color="primary">
        AI 생성 정보
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {image.ai_tool && (
          <Typography variant="body2">
            도구: {image.ai_tool}
          </Typography>
        )}
        {image.model_name && (
          <Typography variant="body2">
            모델: {image.model_name}
          </Typography>
        )}
        {image.steps && (
          <Typography variant="body2">
            스텝: {image.steps}
          </Typography>
        )}
        {image.cfg_scale && (
          <Typography variant="body2">
            CFG: {image.cfg_scale}
          </Typography>
        )}
        {image.sampler && (
          <Typography variant="body2">
            샘플러: {image.sampler}
          </Typography>
        )}
        {image.seed && (
          <Typography variant="body2">
            시드: {image.seed}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

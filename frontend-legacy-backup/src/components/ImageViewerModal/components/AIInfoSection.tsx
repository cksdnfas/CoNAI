import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';

interface AIInfoSectionProps {
  image: ImageRecord;
  onCopy?: (text: string) => void;
}

interface AIInfoItem {
  label: string;
  value: string | number;
}

/**
 * Compact AI generation information section with copy functionality
 */
export const AIInfoSection: React.FC<AIInfoSectionProps> = ({ image, onCopy }) => {
  const { t } = useTranslation();

  // Build AI info items array
  const aiInfoItems: AIInfoItem[] = [];

  if (image.ai_tool) {
    aiInfoItems.push({
      label: t('imageDetail:aiInfo.toolShort'),
      value: image.ai_tool,
    });
  }
  if (image.model_name) {
    aiInfoItems.push({
      label: t('imageDetail:aiInfo.model'),
      value: image.model_name,
    });
  }
  if (image.steps) {
    aiInfoItems.push({
      label: t('imageDetail:aiInfo.steps'),
      value: image.steps,
    });
  }
  if (image.cfg_scale) {
    aiInfoItems.push({
      label: t('imageDetail:aiInfo.cfgShort'),
      value: image.cfg_scale,
    });
  }
  if (image.sampler) {
    aiInfoItems.push({
      label: t('imageDetail:aiInfo.sampler'),
      value: image.sampler,
    });
  }
  if (image.seed) {
    aiInfoItems.push({
      label: t('imageDetail:aiInfo.seed'),
      value: image.seed,
    });
  }

  if (aiInfoItems.length === 0) return null;

  const handleItemClick = (value: string | number) => {
    if (onCopy) {
      onCopy(String(value));
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        {aiInfoItems.map((item, index) => (
          <Box
            key={index}
            onClick={() => handleItemClick(item.value)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              px: 1,
              py: 0.5,
              borderRadius: 0.5,
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.04)'
                  : 'rgba(0, 0, 0, 0.025)',
              border: (theme) =>
                theme.palette.mode === 'dark'
                  ? '1px solid rgba(255, 255, 255, 0.1)'
                  : '1px solid rgba(0, 0, 0, 0.1)',
              cursor: 'pointer',
              transition: 'all 0.15s ease-in-out',
              '&:hover': {
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.06)'
                    : 'rgba(0, 0, 0, 0.04)',
                borderColor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.15)'
                    : 'rgba(0, 0, 0, 0.15)',
              },
              '&:active': {
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'rgba(0, 0, 0, 0.06)',
              },
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                color: 'text.secondary',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                fontSize: '0.65rem',
                minWidth: 'fit-content',
              }}
            >
              {item.label}
            </Typography>
            <Box
              sx={{
                flex: 1,
                height: '1px',
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'rgba(0, 0, 0, 0.08)',
                mx: 0.75,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 500,
                color: 'text.primary',
                fontFamily: typeof item.value === 'number' ? 'monospace' : 'inherit',
                textAlign: 'right',
                wordBreak: 'break-word',
                fontSize: '0.75rem',
              }}
            >
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

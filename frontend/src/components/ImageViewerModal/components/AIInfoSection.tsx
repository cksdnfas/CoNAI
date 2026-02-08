import React, { useState } from 'react';
import { Box, Typography, IconButton, Collapse } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';

interface AIInfoSectionProps {
  image: ImageRecord;
}

interface AIInfoItem {
  label: string;
  value: string | number;
}

/**
 * Collapsible AI generation information section with improved label-value distinction
 */
export const AIInfoSection: React.FC<AIInfoSectionProps> = ({ image }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true); // 기본 펼쳐진 상태

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
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            pl: 1,
          }}
        >
          {aiInfoItems.map((item, index) => (
            <Box
              key={index}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.03)'
                    : 'rgba(0, 0, 0, 0.02)',
                border: (theme) =>
                  theme.palette.mode === 'dark'
                    ? '1px solid rgba(255, 255, 255, 0.08)'
                    : '1px solid rgba(0, 0, 0, 0.08)',
                transition: 'all 0.15s ease-in-out',
                '&:hover': {
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.05)'
                      : 'rgba(0, 0, 0, 0.04)',
                  borderColor: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.15)'
                      : 'rgba(0, 0, 0, 0.15)',
                },
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontSize: '0.7rem',
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
                      ? 'rgba(255, 255, 255, 0.1)'
                      : 'rgba(0, 0, 0, 0.1)',
                  mx: 1,
                }}
              />
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 500,
                  color: 'text.primary',
                  fontFamily: typeof item.value === 'number' ? 'monospace' : 'inherit',
                  textAlign: 'right',
                  wordBreak: 'break-word',
                }}
              >
                {item.value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

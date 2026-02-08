import React, { useState } from 'react';
import { Button, Tooltip, Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import {
  InfoOutlined as InfoIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';
import { formatFileSize, formatDate, truncateFilename } from '@comfyui-image-manager/shared';

interface FileInfoSectionProps {
  image: ImageRecord;
}

/**
 * Compact file information button with tooltip display
 */
export const FileInfoSection: React.FC<FileInfoSectionProps> = ({ image }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const fileInfoText = [
    `${t('imageDetail:fileInfo.filenameLabel')}: ${truncateFilename(image.original_file_path || '', 40)}`,
    `${t('imageDetail:fileInfo.dimensionsLabel')}: ${image.width} × ${image.height}`,
    `${t('imageDetail:fileInfo.fileSizeLabel')}: ${formatFileSize(image.file_size ?? 0)}`,
    `${t('imageDetail:fileInfo.uploadDateLabel')}: ${formatDate(image.first_seen_date)}`,
  ].join('\n');

  const handleClick = () => {
    if (isMobile) {
      setTooltipOpen(!tooltipOpen);
    }
  };

  const handleClose = () => {
    if (isMobile) {
      setTooltipOpen(false);
    }
  };

  return (
    <Tooltip
      title={
        <Box sx={{ whiteSpace: 'pre-line', p: 0.5 }}>
          {fileInfoText.split('\n').map((line, index) => (
            <Typography key={index} variant="caption" sx={{ display: 'block', lineHeight: 1.6 }}>
              {line}
            </Typography>
          ))}
        </Box>
      }
      placement="top"
      arrow
      open={isMobile ? tooltipOpen : undefined}
      onClose={handleClose}
      disableHoverListener={isMobile}
      disableFocusListener={isMobile}
      disableTouchListener={isMobile}
    >
      <Button
        fullWidth
        variant="outlined"
        startIcon={<InfoIcon />}
        onClick={handleClick}
        sx={{
          justifyContent: 'flex-start',
          py: 1,
          px: 2,
          borderColor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.23)'
              : 'rgba(0, 0, 0, 0.23)',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.05)'
              : 'rgba(0, 0, 0, 0.02)',
          color: 'text.primary',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.08)'
                : 'rgba(0, 0, 0, 0.04)',
            borderColor: 'primary.main',
            transform: 'translateY(-1px)',
            boxShadow: (theme) =>
              theme.palette.mode === 'dark'
                ? '0 2px 8px rgba(0, 0, 0, 0.4)'
                : '0 2px 8px rgba(0, 0, 0, 0.15)',
          },
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
          }}
        >
          {t('imageDetail:sections.fileInfo')}
        </Typography>
      </Button>
    </Tooltip>
  );
};

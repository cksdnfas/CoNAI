import React, { useState } from 'react';
import { Box, Typography, IconButton, Collapse, Chip, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  InsertDriveFile as FileIcon,
  AspectRatio as DimensionsIcon,
  Storage as SizeIcon,
  Schedule as DateIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';
import { formatFileSize, formatDate, truncateFilename } from '@comfyui-image-manager/shared';

interface FileInfoSectionProps {
  image: ImageRecord;
}

/**
 * Collapsible file information section with tooltip-based info display
 */
export const FileInfoSection: React.FC<FileInfoSectionProps> = ({ image }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [expanded, setExpanded] = useState(false);
  const [mobileTooltipOpen, setMobileTooltipOpen] = useState<string | null>(null);

  const fileInfoItems = [
    {
      id: 'filename',
      icon: <FileIcon sx={{ fontSize: 16 }} />,
      label: t('imageDetail:fileInfo.filenameLabel'),
      value: truncateFilename(image.original_file_path || '', 20),
      fullValue: image.original_file_path || '',
    },
    {
      id: 'dimensions',
      icon: <DimensionsIcon sx={{ fontSize: 16 }} />,
      label: t('imageDetail:fileInfo.dimensionsLabel'),
      value: `${image.width} × ${image.height}`,
      fullValue: `${t('imageDetail:imageInfo.dimensions')}: ${image.width} × ${image.height}`,
    },
    {
      id: 'fileSize',
      icon: <SizeIcon sx={{ fontSize: 16 }} />,
      label: t('imageDetail:fileInfo.fileSizeLabel'),
      value: formatFileSize(image.file_size ?? 0),
      fullValue: `${t('imageDetail:fileInfo.fileSize')}: ${formatFileSize(image.file_size ?? 0)}`,
    },
    {
      id: 'uploadDate',
      icon: <DateIcon sx={{ fontSize: 16 }} />,
      label: t('imageDetail:fileInfo.uploadDateLabel'),
      value: formatDate(image.first_seen_date).split(' ')[0], // Show only date part
      fullValue: `${t('imageDetail:fileInfo.uploadDate')}: ${formatDate(image.first_seen_date)}`,
    },
  ];

  const handleMobileClick = (id: string) => {
    if (isMobile) {
      setMobileTooltipOpen(mobileTooltipOpen === id ? null : id);
    }
  };

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
          {t('imageDetail:sections.fileInfo')}
        </Typography>
        <IconButton size="small" sx={{ p: 0 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            pl: 1,
          }}
        >
          {fileInfoItems.map((item) => (
            <Tooltip
              key={item.id}
              title={item.fullValue}
              placement="top"
              arrow
              open={isMobile ? mobileTooltipOpen === item.id : undefined}
              disableHoverListener={isMobile}
              disableFocusListener={isMobile}
              disableTouchListener={isMobile}
            >
              <Chip
                icon={item.icon}
                label={
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        color: 'text.secondary',
                      }}
                    >
                      {item.label}:
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{
                        fontWeight: 500,
                        color: 'text.primary',
                      }}
                    >
                      {item.value}
                    </Typography>
                  </Box>
                }
                onClick={() => handleMobileClick(item.id)}
                sx={{
                  height: 'auto',
                  py: 0.5,
                  px: 1,
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.05)'
                      : 'rgba(0, 0, 0, 0.04)',
                  border: (theme) =>
                    theme.palette.mode === 'dark'
                      ? '1px solid rgba(255, 255, 255, 0.12)'
                      : '1px solid rgba(0, 0, 0, 0.12)',
                  cursor: isMobile ? 'pointer' : 'default',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    bgcolor: (theme) =>
                      theme.palette.mode === 'dark'
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(0, 0, 0, 0.08)',
                    transform: 'translateY(-1px)',
                    boxShadow: (theme) =>
                      theme.palette.mode === 'dark'
                        ? '0 2px 8px rgba(0, 0, 0, 0.4)'
                        : '0 2px 8px rgba(0, 0, 0, 0.15)',
                  },
                  '& .MuiChip-icon': {
                    color: 'text.secondary',
                    marginLeft: 0.5,
                  },
                }}
              />
            </Tooltip>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

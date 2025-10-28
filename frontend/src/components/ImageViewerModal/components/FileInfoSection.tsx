import React, { useState } from 'react';
import { Box, Typography, IconButton, Collapse } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';
import { formatFileSize, formatDate, truncateFilename } from '@comfyui-image-manager/shared';

interface FileInfoSectionProps {
  image: ImageRecord;
}

/**
 * Collapsible file information section
 */
export const FileInfoSection: React.FC<FileInfoSectionProps> = ({ image }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

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
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
          <Typography variant="body2" title={image.original_file_path ?? ''}>
            {t('imageDetail:fileInfo.filename')}: {truncateFilename(image.original_file_path || '')}
          </Typography>
          <Typography variant="body2">
            {t('imageDetail:imageInfo.dimensions')}: {image.width} × {image.height}
          </Typography>
          <Typography variant="body2">
            {t('imageDetail:fileInfo.fileSize')}: {formatFileSize(image.file_size ?? 0)}
          </Typography>
          <Typography variant="body2">
            {t('imageDetail:fileInfo.uploadDate')}: {formatDate(image.first_seen_date)}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
};

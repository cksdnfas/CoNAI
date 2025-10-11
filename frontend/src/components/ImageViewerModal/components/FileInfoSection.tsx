import React, { useState } from 'react';
import { Box, Typography, IconButton, Collapse } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon } from '@mui/icons-material';
import type { ImageRecord } from '../../../types/image';
import { formatFileSize, formatDate, truncateFilename } from '../utils/formatters';

interface FileInfoSectionProps {
  image: ImageRecord;
}

/**
 * Collapsible file information section
 */
export const FileInfoSection: React.FC<FileInfoSectionProps> = ({ image }) => {
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
          파일 정보
        </Typography>
        <IconButton size="small" sx={{ p: 0 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
          <Typography variant="body2" title={image.original_name}>
            파일명: {truncateFilename(image.original_name)}
          </Typography>
          <Typography variant="body2">
            크기: {image.width} × {image.height}
          </Typography>
          <Typography variant="body2">
            파일 크기: {formatFileSize(image.file_size)}
          </Typography>
          <Typography variant="body2">
            업로드: {formatDate(image.upload_date)}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
};

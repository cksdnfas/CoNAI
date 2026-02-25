import React from 'react';
import { DialogTitle, Box, IconButton, Typography } from '@mui/material';
import { Close, ZoomIn, ZoomOut, FitScreen } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface TopBarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitScreen: () => void;
  onClose: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitScreen,
  onClose,
}) => {
  const { t } = useTranslation('common');

  return (
    <DialogTitle
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: 1,
        borderColor: 'divider',
        py: 1.5,
        px: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h6">{t('imageEditor.title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton onClick={onZoomOut} size="small">
            <ZoomOut fontSize="small" />
          </IconButton>
          <Typography
            variant="body2"
            sx={{ minWidth: 60, textAlign: 'center', lineHeight: '32px' }}
          >
            {Math.round(zoom * 100)}%
          </Typography>
          <IconButton onClick={onZoomIn} size="small">
            <ZoomIn fontSize="small" />
          </IconButton>
          <IconButton onClick={onFitScreen} size="small">
            <FitScreen fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <IconButton onClick={onClose} size="small">
        <Close />
      </IconButton>
    </DialogTitle>
  );
};

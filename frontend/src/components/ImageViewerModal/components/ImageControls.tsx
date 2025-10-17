import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import {
  Close as CloseIcon,
  Info as InfoIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RotateLeft as RotateLeftIcon,
  RotateRight as RotateRightIcon,
  Flip as FlipIcon,
  FlipCameraAndroid as FlipVerticalIcon,
  Refresh as ResetIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ImageControlsProps {
  scale: number;
  isMobile: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onReset: () => void;
  onOpenDrawer?: () => void;
  onClose: () => void;
}

/**
 * Image transformation controls toolbar
 */
export const ImageControls: React.FC<ImageControlsProps> = ({
  scale,
  isMobile,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
  onFlipHorizontal,
  onFlipVertical,
  onReset,
  onOpenDrawer,
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        p: 1,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)',
      }}
    >
      {/* Left side - Transformation controls */}
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <IconButton
          onClick={onZoomOut}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.zoomOut')}
        >
          <ZoomOutIcon />
        </IconButton>
        <Typography variant="caption" sx={{ color: 'white', minWidth: '50px', textAlign: 'center' }}>
          {Math.round(scale * 100)}%
        </Typography>
        <IconButton
          onClick={onZoomIn}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.zoomIn')}
        >
          <ZoomInIcon />
        </IconButton>
        <IconButton
          onClick={onRotateLeft}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.rotateLeft')}
        >
          <RotateLeftIcon />
        </IconButton>
        <IconButton
          onClick={onRotateRight}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.rotateRight')}
        >
          <RotateRightIcon />
        </IconButton>
        <IconButton
          onClick={onFlipHorizontal}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.flipHorizontal')}
        >
          <FlipIcon />
        </IconButton>
        <IconButton
          onClick={onFlipVertical}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.flipVertical')}
        >
          <FlipVerticalIcon />
        </IconButton>
        <IconButton
          onClick={onReset}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.reset')}
        >
          <ResetIcon />
        </IconButton>
      </Box>

      {/* Right side - Action buttons */}
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {isMobile && onOpenDrawer && (
          <IconButton
            onClick={onOpenDrawer}
            sx={{ color: 'white' }}
            size="small"
            title={t('imageDetail:controls.info')}
          >
            <InfoIcon />
          </IconButton>
        )}
        <IconButton
          onClick={onClose}
          sx={{ color: 'white' }}
          size="small"
          title={t('imageDetail:controls.close')}
        >
          <CloseIcon />
        </IconButton>
      </Box>
    </Box>
  );
};

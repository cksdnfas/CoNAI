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
          title="축소"
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
          title="확대"
        >
          <ZoomInIcon />
        </IconButton>
        <IconButton
          onClick={onRotateLeft}
          sx={{ color: 'white' }}
          size="small"
          title="왼쪽 회전"
        >
          <RotateLeftIcon />
        </IconButton>
        <IconButton
          onClick={onRotateRight}
          sx={{ color: 'white' }}
          size="small"
          title="오른쪽 회전"
        >
          <RotateRightIcon />
        </IconButton>
        <IconButton
          onClick={onFlipHorizontal}
          sx={{ color: 'white' }}
          size="small"
          title="좌우 반전"
        >
          <FlipIcon />
        </IconButton>
        <IconButton
          onClick={onFlipVertical}
          sx={{ color: 'white' }}
          size="small"
          title="상하 반전"
        >
          <FlipVerticalIcon />
        </IconButton>
        <IconButton
          onClick={onReset}
          sx={{ color: 'white' }}
          size="small"
          title="원본 크기로 되돌리기"
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
          >
            <InfoIcon />
          </IconButton>
        )}
        <IconButton
          onClick={onClose}
          sx={{ color: 'white' }}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </Box>
    </Box>
  );
};

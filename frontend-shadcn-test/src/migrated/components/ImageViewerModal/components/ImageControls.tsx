import React, { useState } from 'react';
import { Box, IconButton, Typography, useMediaQuery, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
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
  HighQuality as HighQualityIcon,
  Image as ThumbnailIcon,
  Edit as EditIcon,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ImageControlsProps {
  scale: number;
  isMobile: boolean;
  showOriginal: boolean;
  isGif: boolean;
  isVideo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onReset: () => void;
  onToggleOriginal: () => void;
  onEdit?: () => void;
  onOpenDrawer?: () => void;
  onClose: () => void;
}

/**
 * Image transformation controls toolbar with mobile optimization
 */
export const ImageControls: React.FC<ImageControlsProps> = ({
  scale,
  isMobile,
  showOriginal,
  isGif,
  isVideo,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
  onFlipHorizontal,
  onFlipVertical,
  onReset,
  onToggleOriginal,
  onEdit,
  onOpenDrawer,
  onClose,
}) => {
  const { t } = useTranslation();
  const isVeryNarrow = useMediaQuery('(max-width:420px)');
  const buttonSize = isVeryNarrow ? 'small' : 'medium';
  const iconFontSize = isVeryNarrow ? 'small' : 'medium';
  const [moreAnchor, setMoreAnchor] = useState<null | HTMLElement>(null);

  const handleMoreClose = () => setMoreAnchor(null);

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
        p: { xs: 0.5, sm: 1 },
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)',
      }}
    >
      {/* Left side - Transformation controls */}
      <Box sx={{ display: 'flex', gap: { xs: 0.25, sm: 0.5 }, alignItems: 'center', flexWrap: 'nowrap' }}>
        <IconButton
          onClick={onZoomOut}
          sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
          size={buttonSize}
          title={t('imageDetail:viewer.controls.zoomOut')}
        >
          <ZoomOutIcon fontSize={iconFontSize} />
        </IconButton>
        <Typography
          variant="caption"
          sx={{
            color: 'white',
            minWidth: { xs: '40px', sm: '50px' },
            textAlign: 'center',
            fontSize: { xs: '0.65rem', sm: '0.75rem' }
          }}
        >
          {Math.round(scale * 100)}%
        </Typography>
        <IconButton
          onClick={onZoomIn}
          sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
          size={buttonSize}
          title={t('imageDetail:viewer.controls.zoomIn')}
        >
          <ZoomInIcon fontSize={iconFontSize} />
        </IconButton>

        {/* On narrow screens: overflow menu for rotate/flip/edit */}
        {isVeryNarrow ? (
          <>
            <IconButton
              onClick={(e) => setMoreAnchor(e.currentTarget)}
              sx={{ color: 'white', p: 0.5 }}
              size="small"
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={moreAnchor}
              open={Boolean(moreAnchor)}
              onClose={handleMoreClose}
              slotProps={{ paper: { sx: { bgcolor: 'rgba(30,30,30,0.95)', color: 'white' } } }}
            >
              <MenuItem onClick={() => { onRotateLeft(); handleMoreClose(); }}>
                <ListItemIcon><RotateLeftIcon sx={{ color: 'white' }} fontSize="small" /></ListItemIcon>
                <ListItemText>{t('imageDetail:viewer.controls.rotateLeft')}</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => { onRotateRight(); handleMoreClose(); }}>
                <ListItemIcon><RotateRightIcon sx={{ color: 'white' }} fontSize="small" /></ListItemIcon>
                <ListItemText>{t('imageDetail:viewer.controls.rotateRight')}</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => { onFlipHorizontal(); handleMoreClose(); }}>
                <ListItemIcon><FlipIcon sx={{ color: 'white' }} fontSize="small" /></ListItemIcon>
                <ListItemText>{t('imageDetail:viewer.controls.flipHorizontal')}</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => { onFlipVertical(); handleMoreClose(); }}>
                <ListItemIcon><FlipVerticalIcon sx={{ color: 'white' }} fontSize="small" /></ListItemIcon>
                <ListItemText>{t('imageDetail:viewer.controls.flipVertical')}</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => { onReset(); handleMoreClose(); }}>
                <ListItemIcon><ResetIcon sx={{ color: 'white' }} fontSize="small" /></ListItemIcon>
                <ListItemText>{t('imageDetail:viewer.controls.reset')}</ListItemText>
              </MenuItem>
              {onEdit && !isGif && !isVideo && (
                <MenuItem onClick={() => { onEdit(); handleMoreClose(); }}>
                  <ListItemIcon><EditIcon sx={{ color: 'white' }} fontSize="small" /></ListItemIcon>
                  <ListItemText>Edit</ListItemText>
                </MenuItem>
              )}
            </Menu>
          </>
        ) : (
          <>
            <IconButton
              onClick={onRotateLeft}
              sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
              size={buttonSize}
              title={t('imageDetail:viewer.controls.rotateLeft')}
            >
              <RotateLeftIcon fontSize={iconFontSize} />
            </IconButton>
            <IconButton
              onClick={onRotateRight}
              sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
              size={buttonSize}
              title={t('imageDetail:viewer.controls.rotateRight')}
            >
              <RotateRightIcon fontSize={iconFontSize} />
            </IconButton>
            <IconButton
              onClick={onFlipHorizontal}
              sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
              size={buttonSize}
              title={t('imageDetail:viewer.controls.flipHorizontal')}
            >
              <FlipIcon fontSize={iconFontSize} />
            </IconButton>
            <IconButton
              onClick={onFlipVertical}
              sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
              size={buttonSize}
              title={t('imageDetail:viewer.controls.flipVertical')}
            >
              <FlipVerticalIcon fontSize={iconFontSize} />
            </IconButton>
            <IconButton
              onClick={onReset}
              sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
              size={buttonSize}
              title={t('imageDetail:viewer.controls.reset')}
            >
              <ResetIcon fontSize={iconFontSize} />
            </IconButton>
            {/* Edit button for img2img (images only) */}
            {onEdit && !isGif && !isVideo && (
              <IconButton
                onClick={onEdit}
                sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
                size={buttonSize}
                title="Edit for img2img"
              >
                <EditIcon fontSize={iconFontSize} />
              </IconButton>
            )}
          </>
        )}

        {/* Original/Thumbnail toggle (not for GIF/Video) - always visible */}
        {!isGif && !isVideo && (
          <IconButton
            onClick={onToggleOriginal}
            sx={{
              color: 'white',
              bgcolor: showOriginal ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
              '&:hover': {
                bgcolor: showOriginal ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
              },
              p: { xs: 0.5, sm: 1 }
            }}
            size={buttonSize}
            title={showOriginal ? t('imageDetail:viewThumbnail') : t('imageDetail:viewOriginal')}
          >
            {showOriginal ? <ThumbnailIcon fontSize={iconFontSize} /> : <HighQualityIcon fontSize={iconFontSize} />}
          </IconButton>
        )}
      </Box>

      {/* Right side - Action buttons */}
      <Box sx={{ display: 'flex', gap: { xs: 0.25, sm: 0.5 } }}>
        {isMobile && onOpenDrawer && (
          <IconButton
            onClick={onOpenDrawer}
            sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
            size={buttonSize}
            title={t('imageDetail:viewer.controls.info')}
          >
            <InfoIcon fontSize={iconFontSize} />
          </IconButton>
        )}
        <IconButton
          onClick={onClose}
          sx={{ color: 'white', p: { xs: 0.5, sm: 1 } }}
          size={buttonSize}
          title={t('imageDetail:viewer.controls.close')}
        >
          <CloseIcon fontSize={iconFontSize} />
        </IconButton>
      </Box>
    </Box>
  );
};

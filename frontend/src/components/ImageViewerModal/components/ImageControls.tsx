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
  HighQuality as HighQualityIcon,
  Image as ThumbnailIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ImageControlsProps {
  scale: number;
  isMobile: boolean;
  showOriginal: boolean; // 원본 이미지 표시 여부
  isGif: boolean; // GIF 파일 여부 (GIF는 원본 전환 버튼 숨김)
  isVideo: boolean; // 비디오 파일 여부 (비디오는 원본 전환 및 편집 버튼 숨김)
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onReset: () => void;
  onToggleOriginal: () => void; // 원본/썸네일 전환
  onEdit?: () => void; // 편집 모드 열기
  onOpenDrawer?: () => void;
  onClose: () => void;
}

/**
 * Image transformation controls toolbar
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

        {/* 원본/썸네일 전환 버튼 (GIF와 비디오는 제외) */}
        {!isGif && !isVideo && (
          <IconButton
            onClick={onToggleOriginal}
            sx={{
              color: 'white',
              bgcolor: showOriginal ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
              '&:hover': {
                bgcolor: showOriginal ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
              }
            }}
            size="small"
            title={showOriginal ? t('imageDetail:viewThumbnail') : t('imageDetail:viewOriginal')}
          >
            {showOriginal ? <ThumbnailIcon /> : <HighQualityIcon />}
          </IconButton>
        )}

        {/* Edit button for img2img (이미지 파일만) */}
        {onEdit && !isGif && !isVideo && (
          <IconButton
            onClick={onEdit}
            sx={{ color: 'white' }}
            size="small"
            title="Edit for img2img"
          >
            <EditIcon />
          </IconButton>
        )}
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

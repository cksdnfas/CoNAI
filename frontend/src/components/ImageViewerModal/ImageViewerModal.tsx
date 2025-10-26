import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogActions,
  Button,
  Box,
  Paper,
  Drawer,
  useMediaQuery,
  useTheme,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Download as DownloadIcon,
  InfoOutlined as InfoIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ImageRecord, ImageSearchParams } from '../../types/image';
import type { GenerationHistoryRecord } from '@comfyui-image-manager/shared';
import ImageNavigation from './ImageNavigation';
import { ImageGridModal } from '../ImageGrid';
import { getBackendOrigin } from '../../utils/backend';
import { settingsApi } from '../../services/settingsApi';
import { imageApi, generationHistoryApi } from '../../services/api';
import { useImageTransform } from './hooks/useImageTransform';
import { useImageNavigation } from './hooks/useImageNavigation';
import { useGroupImages } from './hooks/useGroupImages';
import { ImageControls } from './components/ImageControls';
import { ImageDisplay } from './components/ImageDisplay';
import { ImageDetailSidebar } from './components/ImageDetailSidebar';

interface ImageViewerModalProps {
  open: boolean;
  onClose: () => void;
  image: ImageRecord | null;
  images?: ImageRecord[];
  currentIndex?: number;
  onImageChange?: (index: number) => void;
  onImageDeleted?: (imageId: number) => void;
  searchContext?: 'all' | 'search' | 'group';
  searchParams?: ImageSearchParams;
  groupId?: number;
  // 히스토리 컨텍스트
  isHistoryContext?: boolean;
  historyRecord?: GenerationHistoryRecord;
}

const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  open,
  onClose,
  image,
  images = [],
  currentIndex = 0,
  onImageChange,
  onImageDeleted,
  searchContext = 'all',
  searchParams,
  groupId,
  isHistoryContext = false,
  historyRecord,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const backendOrigin = getBackendOrigin();

  const [drawerOpen, setDrawerOpen] = useState(!isMobile);
  const [isTaggerEnabled, setIsTaggerEnabled] = useState(false);
  const [currentImage, setCurrentImage] = useState<ImageRecord | null>(image);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isRandomMode, setIsRandomMode] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Custom hooks
  const transform = useImageTransform(image?.id, open);
  const navigation = useImageNavigation({
    images,
    currentIndex,
    onImageChange,
    isOpen: open,
    onClose,
    searchContext,
    searchParams,
    groupId,
    onRandomImageLoaded: (newImage: ImageRecord) => {
      setCurrentImage(newImage);
    },
    onRandomModeChange: (isRandom: boolean) => {
      setIsRandomMode(isRandom);
    },
  });
  const groupImages = useGroupImages();

  // Load settings to check if tagger is enabled
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingsApi.getSettings();
        setIsTaggerEnabled(settings.tagger.enabled);
      } catch (err) {
        console.error('Failed to load settings:', err);
        setIsTaggerEnabled(false);
      }
    };

    loadSettings();
  }, []);

  // Update current image when prop changes
  useEffect(() => {
    setCurrentImage(image);
  }, [image]);

  // Reload image after auto-tag generation
  const handleAutoTagGenerated = async () => {
    if (!image?.id) return;
    try {
      const response = await imageApi.getImage(image.id);
      if (response.success && response.data) {
        setCurrentImage(response.data);
      }
    } catch (err) {
      console.error('Failed to reload image after tagging:', err);
    }
  };

  // Event handlers
  const handleDownload = () => {
    if (!image) return;
    const link = document.createElement('a');

    // 히스토리 컨텍스트일 때는 업로드 경로 직접 사용
    if (isHistoryContext && image.image_url) {
      link.href = `${backendOrigin}${image.image_url}`;
    } else {
      link.href = `${backendOrigin}/api/images/${image.id}/download/original`;
    }

    link.download = image.original_name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGoToDetail = () => {
    if (image) {
      navigate(`/image/${image.id}`);
      onClose();
    }
  };

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentImage) return;

    try {
      let response: { success: boolean; error?: string };

      // 히스토리 컨텍스트일 때는 히스토리 삭제 API 사용
      if (isHistoryContext) {
        response = await generationHistoryApi.delete(currentImage.id);
      } else {
        response = await imageApi.deleteImage(currentImage.id);
      }

      if (response.success) {
        setSnackbar({
          open: true,
          message: t('imageDetail:actions.deleteSuccess'),
          severity: 'success',
        });

        // Notify parent component
        if (onImageDeleted) {
          onImageDeleted(currentImage.id);
        }

        // Navigate to next/previous image or close modal
        if (images.length > 1) {
          if (currentIndex < images.length - 1) {
            // Move to next image
            navigation.handleNext();
          } else if (currentIndex > 0) {
            // Move to previous image
            navigation.handlePrevious();
          } else {
            // Only one image, close modal
            onClose();
          }
        } else {
          // No other images, close modal
          onClose();
        }
      } else {
        setSnackbar({
          open: true,
          message: response.error || t('imageDetail:actions.deleteError'),
          severity: 'error',
        });
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      setSnackbar({
        open: true,
        message: t('imageDetail:actions.deleteError'),
        severity: 'error',
      });
    } finally {
      setDeleteDialogOpen(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  if (!currentImage) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          width: '90vw',
          height: '90vh',
          maxWidth: '90vw',
          maxHeight: '90vh',
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Main content area */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Image area */}
        <Box
          sx={{
            flex: isMobile ? 1 : '1 1 auto',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'black',
            position: 'relative',
          }}
        >
          {/* Controls */}
          <ImageControls
            scale={transform.scale}
            isMobile={isMobile}
            onZoomIn={transform.handleZoomIn}
            onZoomOut={transform.handleZoomOut}
            onRotateLeft={transform.handleRotateLeft}
            onRotateRight={transform.handleRotateRight}
            onFlipHorizontal={transform.handleFlipHorizontal}
            onFlipVertical={transform.handleFlipVertical}
            onReset={transform.handleReset}
            onOpenDrawer={isMobile ? () => setDrawerOpen(true) : undefined}
            onClose={onClose}
          />

          {/* Image display */}
          <ImageDisplay
            image={currentImage}
            scale={transform.scale}
            rotation={transform.rotation}
            flipX={transform.flipX}
            flipY={transform.flipY}
            imagePosition={transform.imagePosition}
            isDragging={transform.isDragging}
            containerRef={transform.imageContainerRef}
            onMouseDown={transform.handleMouseDown}
          />
        </Box>

        {/* Desktop sidebar */}
        {!isMobile && (
          <Paper
            sx={{
              flex: '0 0 30%',
              minWidth: '325px',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 0,
            }}
            elevation={0}
          >
            <ImageDetailSidebar
              image={currentImage}
              onGroupClick={groupImages.handleGroupClick}
              isTaggerEnabled={isTaggerEnabled}
              onAutoTagGenerated={handleAutoTagGenerated}
              isHistoryContext={isHistoryContext}
              linkedImageId={historyRecord?.linked_image_id}
            />
          </Paper>
        )}

        {/* Mobile drawer */}
        {isMobile && (
          <Drawer
            anchor="right"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            ModalProps={{
              style: { zIndex: 1400 }
            }}
            slotProps={{
              paper: {
                sx: {
                  width: '80vw',
                  maxWidth: 400,
                },
              },
            }}
          >
            <ImageDetailSidebar
              image={currentImage}
              onGroupClick={groupImages.handleGroupClick}
              isTaggerEnabled={isTaggerEnabled}
              onAutoTagGenerated={handleAutoTagGenerated}
              isHistoryContext={isHistoryContext}
              linkedImageId={historyRecord?.linked_image_id}
            />
          </Drawer>
        )}
      </Box>

      {/* Bottom action bar */}
      <DialogActions
        sx={{
          flexShrink: 0,
          justifyContent: 'space-between',
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <ImageNavigation
          currentIndex={currentIndex}
          totalCount={images?.length ?? 0}
          onPrevious={navigation.handlePrevious}
          onNext={navigation.handleNext}
          {...(!isHistoryContext && { onRandom: navigation.handleRandom })}
          isRandomMode={isRandomMode}
          currentImage={currentImage}
        />

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {!isHistoryContext && (
            <Tooltip title={t('imageDetail:actions.goToDetail')}>
              <IconButton size="small" onClick={handleGoToDetail}>
                <InfoIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('imageDetail:actions.download')}>
            <IconButton size="small" onClick={handleDownload}>
              <DownloadIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('imageDetail:actions.delete')}>
            <IconButton size="small" onClick={handleDeleteClick} color="error">
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogActions>

      {/* Group images modal */}
      {groupImages.groupModalOpen && (
        <ImageGridModal
          open={groupImages.groupModalOpen}
          onClose={groupImages.handleGroupModalClose}
          images={groupImages.groupImages}
          loading={groupImages.groupImagesLoading}
          title={groupImages.selectedGroup ? t('imageDetail:groupModal.title', { name: groupImages.selectedGroup.name }) : t('imageDetail:groupModal.defaultTitle')}
          pageSize={groupImages.groupImagesPageSize}
          onPageSizeChange={groupImages.handleGroupImagesPageSizeChange}
          currentPage={groupImages.groupImagesPage}
          totalPages={groupImages.groupImagesTotalPages}
          total={groupImages.groupImagesTotal}
          onPageChange={groupImages.handleGroupImagesPageChange}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('imageDetail:actions.delete')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('imageDetail:actions.deleteConfirm')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} color="primary">
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            {t('imageDetail:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbar.severity} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default ImageViewerModal;

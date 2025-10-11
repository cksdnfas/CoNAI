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
} from '@mui/material';
import {
  Download as DownloadIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { ImageRecord } from '../../types/image';
import ImageNavigation from './ImageNavigation';
import { ImageGridModal } from '../ImageGrid';
import { getBackendOrigin } from '../../utils/backend';
import { settingsApi } from '../../services/settingsApi';
import { imageApi } from '../../services/api';
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
}

const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  open,
  onClose,
  image,
  images = [],
  currentIndex = 0,
  onImageChange,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const backendOrigin = getBackendOrigin();

  const [drawerOpen, setDrawerOpen] = useState(!isMobile);
  const [isTaggerEnabled, setIsTaggerEnabled] = useState(false);
  const [currentImage, setCurrentImage] = useState<ImageRecord | null>(image);

  // Custom hooks
  const transform = useImageTransform(image?.id, open);
  const navigation = useImageNavigation({
    images,
    currentIndex,
    onImageChange,
    isOpen: open,
    onClose,
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
    link.href = `${backendOrigin}/api/images/${image.id}/download/original`;
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
            flex: isMobile ? 1 : '0 0 70%',
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
          totalCount={images.length}
          onPrevious={navigation.handlePrevious}
          onNext={navigation.handleNext}
          onRandom={navigation.handleRandom}
        />

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            startIcon={<LinkIcon />}
            onClick={handleGoToDetail}
          >
            상세 페이지
          </Button>
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
          >
            다운로드
          </Button>
        </Box>
      </DialogActions>

      {/* Group images modal */}
      {groupImages.groupModalOpen && (
        <ImageGridModal
          open={groupImages.groupModalOpen}
          onClose={groupImages.handleGroupModalClose}
          images={groupImages.groupImages}
          loading={groupImages.groupImagesLoading}
          title={groupImages.selectedGroup ? `${groupImages.selectedGroup.name} 그룹` : '그룹 이미지'}
          pageSize={groupImages.groupImagesPageSize}
          onPageSizeChange={groupImages.handleGroupImagesPageSizeChange}
          currentPage={groupImages.groupImagesPage}
          totalPages={groupImages.groupImagesTotalPages}
          total={groupImages.groupImagesTotal}
          onPageChange={groupImages.handleGroupImagesPageChange}
        />
      )}
    </Dialog>
  );
};

export default ImageViewerModal;

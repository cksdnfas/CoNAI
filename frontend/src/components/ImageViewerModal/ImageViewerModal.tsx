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
import { getBackendOrigin, buildUploadsUrl } from '../../utils/backend';
import { settingsApi } from '../../services/settingsApi';
import { imageApi, generationHistoryApi } from '../../services/api';
import { useImageTransform } from './hooks/useImageTransform';
import { useImageNavigation } from './hooks/useImageNavigation';
import { useGroupImages } from './hooks/useGroupImages';
import { ImageControls } from './components/ImageControls';
import { ImageDisplay } from './components/ImageDisplay';
import { ImageDetailSidebar } from './components/ImageDetailSidebar';
import { ImageEditorModal } from '../ImageEditorModal';

// ✅ composite_hash 기반으로 변경
interface ImageViewerModalProps {
  open: boolean;
  onClose: () => void;
  image: ImageRecord | null;
  images?: ImageRecord[];
  currentIndex?: number;
  onImageChange?: (index: number) => void;
  onImageDeleted?: (compositeHash: string) => void;  // composite_hash
  searchContext?: 'all' | 'search' | 'group';
  searchParams?: ImageSearchParams;
  groupId?: number;
  allImageIds?: number[]; // ✅ 전체 이미지 image_files.id 목록 (랜덤 선택용)
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
  allImageIds = [],
  isHistoryContext = false,
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
  const [showOriginal, setShowOriginal] = useState(false); // 원본 이미지 표시 여부 (기본: 썸네일)
  const [editorOpen, setEditorOpen] = useState(false); // 이미지 편집 모달
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [lastFocusedElement, setLastFocusedElement] = useState<HTMLElement | null>(null); // Focus management for nested modals

  // Custom hooks - ✅ composite_hash 사용 (null 체크 포함)
  const transform = useImageTransform(image?.composite_hash || undefined, open);
  const navigation = useImageNavigation({
    images,
    currentIndex,
    onImageChange,
    isOpen: open,
    onClose,
    searchContext,
    searchParams,
    groupId,
    allImageIds,
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

  // Update current image when prop changes (but only when not in random mode)
  // ✅ composite_hash 기반 메타데이터 조회 로직 추가
  // Optimized to prevent redundant fetches for the same composite_hash
  useEffect(() => {
    // 랜덤 모드가 아닐 때만 prop 변경사항 반영
    if (!isRandomMode && image) {
      // 1단계: composite_hash 확인
      if (!image.composite_hash) {
        console.warn('[ImageViewerModal] No composite_hash, using props data');
        setCurrentImage(image);
        return;
      }

      // Skip fetching if the composite_hash hasn't changed
      // This prevents redundant requests when only the image object reference changes
      if (currentImage?.composite_hash === image.composite_hash) {
        return;
      }

      // 2단계: DB에서 메타데이터 조회 (file_type 포함)
      const fetchMetadata = async () => {
        try {
          const metadata = await imageApi.getMetadata(image.composite_hash!);
          setCurrentImage(metadata);
        } catch (error) {
          // 4단계: 실패 시 props 데이터 사용 (안전장치)
          console.error('[ImageViewerModal] Metadata fetch failed, using props data:', error);
          setCurrentImage(image);
        }
      };

      fetchMetadata();
    }
  }, [image?.composite_hash, isRandomMode, currentImage?.composite_hash]);

  // ✅ Reload image after auto-tag generation (composite_hash)
  const handleAutoTagGenerated = async () => {
    if (!image?.composite_hash) return;
    try {
      const response = await imageApi.getImage(image.composite_hash);
      // console.log('[ImageViewerModal] API Response:', response);
      // console.log('[ImageViewerModal] response.data.auto_tags:', response.data?.auto_tags);
      if (response.success && response.data) {
        setCurrentImage(response.data);
      }
    } catch (err) {
      console.error('Failed to reload image after tagging:', err);
    }
  };

  // ✅ Event handlers (composite_hash)
  const handleDownload = () => {
    if (!image) return;
    const link = document.createElement('a');

    // 히스토리 컨텍스트일 때는 업로드 경로 직접 사용
    if (isHistoryContext && image.image_url) {
      link.href = image.image_url.startsWith('http') ? image.image_url : `${backendOrigin}${image.image_url}`;
    } else if (image.image_url) {
      // 백엔드가 제공한 image_url 우선 사용
      link.href = image.image_url.startsWith('http') ? image.image_url : `${backendOrigin}${image.image_url}`;
    } else if (image.original_file_path) {
      // by-path 사용
      link.href = `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path)}`;
    } else if (image.composite_hash) {
      // composite_hash 사용 (모든 파일 타입)
      link.href = `${backendOrigin}/api/images/${image.composite_hash}/download/original`;
    } else {
      console.error('Cannot download: no valid identifier found');
      return;
    }

    link.download = image.original_file_path || `image_${image.composite_hash?.substring(0, 8) || 'unknown'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGoToDetail = () => {
    if (image && image.composite_hash) {
      navigate(`/image/${image.composite_hash!}`);
      onClose();
    }
  };

  const handleDeleteClick = () => {
    // Store currently focused element for restoration
    setLastFocusedElement(document.activeElement as HTMLElement);
    setDeleteDialogOpen(true);
  };

  // ✅ Delete handler (composite_hash)
  const handleDeleteConfirm = async () => {
    if (!currentImage) return;

    try {
      let response: { success: boolean; error?: string };

      // 히스토리 컨텍스트일 때는 히스토리 삭제 API 사용
      // Note: History context still uses id (number) for history records
      if (isHistoryContext) {
        // @ts-ignore - history records may have id field
        response = await generationHistoryApi.delete(currentImage.id || currentImage.composite_hash);
      } else {
        if (!currentImage.composite_hash) {
          throw new Error('Image is still processing');
        }
        response = await imageApi.deleteImage(currentImage.composite_hash);
      }

      if (response.success) {
        setSnackbar({
          open: true,
          message: t('imageDetail:actions.deleteSuccess'),
          severity: 'success',
        });

        // Notify parent component
        if (onImageDeleted && currentImage.composite_hash) {
          onImageDeleted(currentImage.composite_hash);
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
    // Restore focus to the element that opened the dialog
    if (lastFocusedElement) {
      setTimeout(() => {
        lastFocusedElement.focus();
      }, 0);
    }
  };

  const handleEditorOpen = () => {
    // Store currently focused element for restoration
    setLastFocusedElement(document.activeElement as HTMLElement);
    setEditorOpen(true);
  };

  const handleEditorClose = () => {
    setEditorOpen(false);
    // Restore focus to the element that opened the editor
    if (lastFocusedElement) {
      setTimeout(() => {
        lastFocusedElement.focus();
      }, 0);
    }
  };

  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // 원본 이미지 로드 실패 시 토스트 알림
  const handleOriginalLoadError = () => {
    setSnackbar({
      open: true,
      message: '원본 이미지를 찾을 수 없습니다. 썸네일을 표시합니다.',
      severity: 'error'
    });
    // 원본 모드를 해제하여 썸네일로 전환
    setShowOriginal(false);
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
            showOriginal={showOriginal}
            isGif={currentImage?.file_type === 'animated'}
            isVideo={currentImage?.file_type === 'video'}
            onZoomIn={transform.handleZoomIn}
            onZoomOut={transform.handleZoomOut}
            onRotateLeft={transform.handleRotateLeft}
            onRotateRight={transform.handleRotateRight}
            onFlipHorizontal={transform.handleFlipHorizontal}
            onFlipVertical={transform.handleFlipVertical}
            onReset={transform.handleReset}
            onToggleOriginal={() => setShowOriginal(prev => !prev)}
            onEdit={currentImage?.file_type === 'image' ? handleEditorOpen : undefined}
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
            showOriginal={showOriginal}
            onOriginalLoadError={handleOriginalLoadError}
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
              style: { zIndex: 1400 },
              keepMounted: false,
              disablePortal: false
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
        hideBackdrop={false}
        disablePortal={false}
        style={{ zIndex: 1400 }}
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

      {/* Image Editor Modal */}
      {currentImage && currentImage.file_id && (
        <ImageEditorModal
          open={editorOpen}
          onClose={handleEditorClose}
          imageId={currentImage.file_id}
          imageUrl={buildUploadsUrl(showOriginal ? (currentImage.original_file_path || currentImage.thumbnail_path) : currentImage.thumbnail_path)}
          onSaved={async () => {
            // Reload image metadata after save
            if (currentImage.composite_hash) {
              try {
                const response = await imageApi.getImage(currentImage.composite_hash);
                if (response.success && response.data) {
                  setCurrentImage(response.data);
                }
              } catch (err) {
                console.error('Failed to reload image after editing:', err);
              }
            }
          }}
        />
      )}
    </Dialog>
  );
};

export default ImageViewerModal;

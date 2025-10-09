import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  Paper,
  IconButton,
  Drawer,
  useMediaQuery,
  useTheme,
  Skeleton,
  Collapse,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Info as InfoIcon,
  Link as LinkIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RotateLeft as RotateLeftIcon,
  RotateRight as RotateRightIcon,
  Flip as FlipIcon,
  FlipCameraAndroid as FlipVerticalIcon,
  Refresh as ResetIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { ImageRecord, PageSize } from '../../types/image';
import PromptDisplay from '../PromptDisplay';
import ImageNavigation from './ImageNavigation';
import { ImageGridModal } from '../ImageGrid';
import { groupApi } from '../../services/api';
import { buildUploadsUrl, ensureAbsoluteUrl, getBackendOrigin } from '../../utils/backend';

// ImageRecord.groups의 타입 추출
type ImageGroupInfo = NonNullable<ImageRecord['groups']>[number];

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

  const [imageError, setImageError] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(!isMobile);
  const [imageLoading, setImageLoading] = useState(true);
  const [fileInfoExpanded, setFileInfoExpanded] = useState(false);

  // 그룹 이미지 모달 상태
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ImageGroupInfo | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>(25);

  // 이미지 변환 상태
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);

  // 이미지 컨테이너 ref
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // 드래그 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });

  // 이미지 변경 시 에러 상태 및 변환 상태 초기화
  useEffect(() => {
    setImageError(false);
    setImageLoading(true);
    setScale(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setImagePosition({ x: 0, y: 0 });
    setIsDragging(false);
  }, [image?.id]);

  // 이미지 변환 함수들
  const handleZoomIn = () => {
    setScale(prev => Math.min(prev * 1.2, 5));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev / 1.2, 0.1));
  };

  const handleRotateLeft = () => {
    setRotation(prev => (prev - 90) % 360);
  };

  const handleRotateRight = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleFlipHorizontal = () => {
    setFlipX(prev => !prev);
  };

  const handleFlipVertical = () => {
    setFlipY(prev => !prev);
  };

  const handleReset = () => {
    setScale(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setImagePosition({ x: 0, y: 0 });
  };

  // 드래그 함수들 - 글로벌 이벤트 사용
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({
        x: e.clientX - imagePosition.x,
        y: e.clientY - imagePosition.y,
      });
    }
  }, [scale, imagePosition]);

  // 글로벌 마우스 이벤트로 드래그 처리
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (scale > 1) {
        setImagePosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, scale, dragStart]);


  // 휠 이벤트 리스너 등록
  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      const container = imageContainerRef.current;
      if (!container) return;

      const wheelHandler = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -1 : 1;
        const zoomFactor = 1 + (delta * 0.1);

        setScale(prev => {
          const newScale = prev * zoomFactor;
          return Math.max(0.1, Math.min(5, newScale));
        });
      };

      container.addEventListener('wheel', wheelHandler, { passive: false });

      return () => {
        container.removeEventListener('wheel', wheelHandler);
      };
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [open]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0 && onImageChange) {
      onImageChange(currentIndex - 1);
    }
  }, [currentIndex, onImageChange]);

  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1 && onImageChange) {
      onImageChange(currentIndex + 1);
    }
  }, [currentIndex, images.length, onImageChange]);

  const handleRandom = useCallback(() => {
    if (images.length <= 1 || !onImageChange) return;

    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * images.length);
    } while (randomIndex === currentIndex);

    onImageChange(randomIndex);
  }, [currentIndex, images.length, onImageChange]);

  // 키보드 이벤트 핸들러
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          handlePrevious();
          break;
        case 'ArrowRight':
          event.preventDefault();
          handleNext();
          break;
        case ' ':
          event.preventDefault();
          handleRandom();
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handlePrevious, handleNext, handleRandom]);

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

  const handleGroupClick = async (group: ImageGroupInfo) => {
    setSelectedGroup(group);
    setGroupImagesLoading(true);
    setGroupModalOpen(true);
    await fetchGroupImages(group.id, 1, groupImagesPageSize);
  };

  const fetchGroupImages = async (groupId: number, page: number = 1, pageSize?: PageSize) => {
    try {
      setGroupImagesLoading(true);
      const actualPageSize = pageSize || groupImagesPageSize;
      const response = await groupApi.getGroupImages(groupId, page, actualPageSize);

      if (response.success && response.data) {
        setGroupImages(response.data.images || []);
        setGroupImagesPage(response.data.pagination?.page || 1);
        setGroupImagesTotalPages(response.data.pagination?.totalPages || 1);
        setGroupImagesTotal(response.data.pagination?.total || 0);
      } else {
        setGroupImages([]);
      }
    } catch (error) {
      console.error('Error fetching group images:', error);
      setGroupImages([]);
    } finally {
      setGroupImagesLoading(false);
    }
  };

  const handleGroupImagesPageChange = (page: number) => {
    if (selectedGroup) {
      fetchGroupImages(selectedGroup.id, page, groupImagesPageSize);
    }
  };

  const handleGroupImagesPageSizeChange = (size: PageSize) => {
    setGroupImagesPageSize(size);
    if (selectedGroup) {
      fetchGroupImages(selectedGroup.id, 1, size);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ko-KR');
  };

  const truncateFilename = (filename: string, maxLength: number = 40) => {
    if (filename.length <= maxLength) return filename;
    const ext = filename.split('.').pop();
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const truncatedName = nameWithoutExt.substring(0, maxLength - ext!.length - 4) + '...';
    return `${truncatedName}.${ext}`;
  };

  if (!image) return null;

  const imageUrl = ensureAbsoluteUrl(image.image_url) || buildUploadsUrl(image.file_path);
  const fallbackUrl = buildUploadsUrl(image.file_path);

  const detailContent = (
    <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 상단 정보 섹션 - 스크롤 가능 */}
      <Box sx={{ flexShrink: 0, overflowY: 'auto', mb: 2 }}>
        <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
          이미지 정보
        </Typography>

      {/* 파일 정보 - 확대/축소 가능 */}
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
          onClick={() => setFileInfoExpanded(!fileInfoExpanded)}
        >
          <Typography variant="subtitle2" color="primary">
            파일 정보
          </Typography>
          <IconButton size="small" sx={{ p: 0 }}>
            {fileInfoExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
        <Collapse in={fileInfoExpanded}>
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

      {/* 그룹 정보 */}
      {image.groups && image.groups.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom color="primary">
            소속 그룹
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {image.groups.map((group) => (
              <Chip
                key={group.id}
                label={group.name}
                size="small"
                variant="filled"
                clickable
                onClick={() => handleGroupClick(group)}
                sx={{
                  backgroundColor: group.color || (group.collection_type === 'auto' ? '#e3f2fd' : '#f3e5f5'),
                  color: group.color ? '#fff' : (group.collection_type === 'auto' ? '#1976d2' : '#7b1fa2'),
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  '&:hover': {
                    opacity: 0.8,
                  },
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* AI 생성 정보 */}
      {(image.ai_tool || image.model_name || image.steps || image.cfg_scale || image.sampler || image.seed) && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom color="primary">
            AI 생성 정보
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {image.ai_tool && (
              <Typography variant="body2">
                도구: {image.ai_tool}
              </Typography>
            )}
            {image.model_name && (
              <Typography variant="body2">
                모델: {image.model_name}
              </Typography>
            )}
            {image.steps && (
              <Typography variant="body2">
                스텝: {image.steps}
              </Typography>
            )}
            {image.cfg_scale && (
              <Typography variant="body2">
                CFG: {image.cfg_scale}
              </Typography>
            )}
            {image.sampler && (
              <Typography variant="body2">
                샘플러: {image.sampler}
              </Typography>
            )}
            {image.seed && (
              <Typography variant="body2">
                시드: {image.seed}
              </Typography>
            )}
          </Box>
        </Box>
      )}
      </Box>

      {/* 프롬프트 정보 - 남은 공간 모두 사용 */}
      {image.ai_metadata && (image.ai_metadata.prompts.prompt || image.ai_metadata.prompts.negative_prompt) && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PromptDisplay
            prompt={image.ai_metadata.prompts.prompt}
            negativePrompt={image.ai_metadata.prompts.negative_prompt}
            variant="outlined"
            showGrouped={true}
          />
        </Box>
      )}
    </Box>
  );

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
        {/* 메인 콘텐츠 영역 */}
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 이미지 영역 */}
        <Box
          sx={{
            flex: isMobile ? 1 : '0 0 70%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'black',
            position: 'relative',
          }}
        >
          {/* 상단 컨트롤 */}
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
            {/* 이미지 변환 컨트롤 */}
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <IconButton
                onClick={handleZoomOut}
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
                onClick={handleZoomIn}
                sx={{ color: 'white' }}
                size="small"
                title="확대"
              >
                <ZoomInIcon />
              </IconButton>
              <IconButton
                onClick={handleRotateLeft}
                sx={{ color: 'white' }}
                size="small"
                title="왼쪽 회전"
              >
                <RotateLeftIcon />
              </IconButton>
              <IconButton
                onClick={handleRotateRight}
                sx={{ color: 'white' }}
                size="small"
                title="오른쪽 회전"
              >
                <RotateRightIcon />
              </IconButton>
              <IconButton
                onClick={handleFlipHorizontal}
                sx={{ color: 'white' }}
                size="small"
                title="좌우 반전"
              >
                <FlipIcon />
              </IconButton>
              <IconButton
                onClick={handleFlipVertical}
                sx={{ color: 'white' }}
                size="small"
                title="상하 반전"
              >
                <FlipVerticalIcon />
              </IconButton>
              <IconButton
                onClick={handleReset}
                sx={{ color: 'white' }}
                size="small"
                title="원본 크기로 되돌리기"
              >
                <ResetIcon />
              </IconButton>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {isMobile && (
                <IconButton
                  onClick={() => setDrawerOpen(true)}
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

          {/* 이미지 */}
          <Box
            id="image-container"
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden',
              touchAction: 'none',
            }}
            onMouseDown={handleMouseDown}
            ref={imageContainerRef}
          >
            {imageLoading && (
              <Skeleton
                variant="rectangular"
                sx={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  bgcolor: 'grey.800',
                }}
              />
            )}
            <Box
              component="img"
              src={imageError ? fallbackUrl : imageUrl}
              alt={image.original_name}
              draggable={false}
              onError={() => setImageError(true)}
              onLoad={() => setImageLoading(false)}
              sx={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                opacity: imageLoading ? 0 : 1,
                transition: isDragging ? 'opacity 0.3s ease' : 'opacity 0.3s ease, transform 0.15s ease-out',
                transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${scale}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
                transformOrigin: 'center center',
                cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          </Box>
        </Box>

        {/* 데스크톱 사이드바 */}
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
            {detailContent}
          </Paper>
        )}

        {/* 모바일 드로어 */}
        {isMobile && (
          <Drawer
            anchor="right"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            ModalProps={{
              // 모달 내부의 드로어가 제대로 표시되도록 z-index 조정
              style: { zIndex: 1400 }
            }}
            PaperProps={{
              sx: {
                width: '80vw',
                maxWidth: 400,
              },
            }}
          >
            {detailContent}
          </Drawer>
        )}
        </Box>

      {/* 하단 액션 바 */}
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
          onPrevious={handlePrevious}
          onNext={handleNext}
          onRandom={handleRandom}
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

      {/* 그룹 이미지 모달 */}
      {groupModalOpen && (
        <ImageGridModal
          open={groupModalOpen}
          onClose={() => setGroupModalOpen(false)}
          images={groupImages}
          loading={groupImagesLoading}
          title={selectedGroup ? `${selectedGroup.name} 그룹` : '그룹 이미지'}
          pageSize={groupImagesPageSize}
          onPageSizeChange={handleGroupImagesPageSizeChange}
          currentPage={groupImagesPage}
          totalPages={groupImagesTotalPages}
          total={groupImagesTotal}
          onPageChange={handleGroupImagesPageChange}
        />
      )}
    </Dialog>
  );
};

export default ImageViewerModal;
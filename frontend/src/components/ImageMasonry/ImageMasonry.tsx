import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Typography, Skeleton } from '@mui/material';
import { useTranslation } from 'react-i18next';
import Masonry from 'react-masonry-css';
import InfiniteScroll from 'react-infinite-scroll-component';
import type { ImageRecord } from '../../types/image';
import MasonryImageCard from './MasonryImageCard';
import ImageViewerModal from '../ImageViewerModal';
import { ImageEditorModal } from '../ImageEditorModal';
import './ImageMasonry.css';

interface ImageMasonryProps {
  images: ImageRecord[];
  loading?: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  selectable?: boolean;
  selectedIds?: number[];  // ✅ image_files.id[]
  onSelectionChange?: (selectedIds: number[]) => void;
}

const ImageMasonry: React.FC<ImageMasonryProps> = ({
  images,
  loading = false,
  hasMore,
  onLoadMore,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
}) => {
  const { t } = useTranslation(['gallery']);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [lastClickedIndex, setLastClickedIndex] = useState<number>(-1);

  // 이미지 에디터 모달 상태 (ImageViewerModal과 독립적으로 관리)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorImageId, setEditorImageId] = useState<number | null>(null);

  // 선택 상태를 Set으로 변환하여 O(1) 조회 성능 확보
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // react-masonry-css breakpoint 설정
  const breakpointColumns = {
    default: 6, // xl
    1536: 5,    // lg+
    1200: 4,    // lg
    900: 3,     // md
    600: 2,     // sm
  };

  const handleImageClick = useCallback((imageIndex: number) => {
    setCurrentImageIndex(imageIndex);
    setViewerOpen(true);
  }, []);

  const handleImageChange = useCallback((newIndex: number) => {
    setCurrentImageIndex(newIndex);
  }, []);

  const handleSelectionChange = useCallback((id: number, event?: React.MouseEvent) => {
    console.log('[ImageMasonry] handleSelectionChange called:', {
      id,
      hasCallback: !!onSelectionChange,
      imageIndex: images.findIndex(img => img.id === id)
    });
    if (!onSelectionChange) return;

    const imageIndex = images.findIndex(img => img.id === id);

    // Ctrl/Cmd + Click: 토글 선택
    if (event && (event.ctrlKey || event.metaKey)) {
      const newSelectedIds = selectedSet.has(id)
        ? selectedIds.filter(selectedId => selectedId !== id)
        : [...selectedIds, id];
      onSelectionChange(newSelectedIds);
      setLastClickedIndex(imageIndex);
      return;
    }

    // Shift + Click: 범위 선택
    if (event && event.shiftKey && lastClickedIndex >= 0) {
      const start = Math.min(lastClickedIndex, imageIndex);
      const end = Math.max(lastClickedIndex, imageIndex);
      const rangeIds = images.slice(start, end + 1)
        .map(img => img.id)
        .filter((id): id is number => id !== undefined && id !== null);
      const newSelectedIds = Array.from(new Set([...selectedIds, ...rangeIds]));
      onSelectionChange(newSelectedIds);
      return;
    }

    // 일반 클릭: 토글 선택 (체크박스 방식)
    const newSelectedIds = selectedSet.has(id)
      ? selectedIds.filter(selectedId => selectedId !== id)
      : [...selectedIds, id];
    onSelectionChange(newSelectedIds);
    setLastClickedIndex(imageIndex);
  }, [images, selectedIds, selectedSet, onSelectionChange, lastClickedIndex]);

  // 컨테이너 클릭 핸들러 (빈 공간 클릭 시 선택 해제)
  const handleContainerClick = (e: React.MouseEvent) => {
    // 이미지나 체크박스를 클릭한 경우가 아니면
    const target = e.target as HTMLElement;
    const isImageCard = target.closest('.selectable-image');
    const isCheckbox = target.closest('.image-card-actions');
    const isBulkActionBar = target.closest('.no-drag-select');

    // 빈 공간 클릭인 경우에만 선택 해제
    if (!isImageCard && !isCheckbox && !isBulkActionBar && onSelectionChange && selectedIds.length > 0) {
      onSelectionChange([]);
      setLastClickedIndex(-1);
    }
  };

  // 키보드 단축키 핸들러
  useEffect(() => {
    if (!selectable || !onSelectionChange) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A: 전체 선택
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allIds = images
          .map(img => img.id)
          .filter((id): id is number => id !== undefined && id !== null);
        onSelectionChange(allIds);
      }

      // ESC: 선택 해제
      if (e.key === 'Escape') {
        e.preventDefault();
        onSelectionChange([]);
        setLastClickedIndex(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectable, onSelectionChange, images]);

  // 이미지 에디터 열기 핸들러 (ImageViewerModal에서 호출됨)
  const handleOpenEditor = useCallback((imageId: number) => {
    setEditorImageId(imageId);
    setEditorOpen(true);
  }, []);

  // 이미지 에디터 닫기 핸들러
  const handleCloseEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorImageId(null);
  }, []);

  // 초기 로딩 중
  if (loading && images.length === 0) {
    return (
      <Box sx={{ width: '100%' }}>
        <Masonry
          breakpointCols={breakpointColumns}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {Array.from({ length: 20 }, (_, index) => (
            <Skeleton
              key={index}
              variant="rectangular"
              height={Math.random() * 200 + 150}
              sx={{ borderRadius: 1 }}
            />
          ))}
        </Masonry>
      </Box>
    );
  }

  // 이미지가 없는 경우
  if (images.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          {t('gallery:emptyState.noImages')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('gallery:emptyState.uploadPrompt')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      onClick={handleContainerClick}
      sx={{ width: '100%', position: 'relative' }}
    >
      <InfiniteScroll
        dataLength={images.length}
        next={onLoadMore}
        hasMore={hasMore}
        loader={
          <Box sx={{ mt: 2, width: '100%' }}>
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('gallery:loading')}
              </Typography>
            </Box>
          </Box>
        }
        endMessage={
          <Box sx={{ textAlign: 'center', py: 4, mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('gallery:allImagesLoaded')}
            </Typography>
          </Box>
        }
        scrollThreshold={0.8}
        style={{ overflow: 'visible' }}
      >
        <Masonry
          breakpointCols={breakpointColumns}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {images.map((image, index) => (
            <MasonryImageCard
              key={image.id ? `id-${image.id}` : `hash-${image.composite_hash || 'processing'}-${index}`}
              image={image}
              onClick={() => handleImageClick(index)}
              selected={image.id ? selectedSet.has(image.id) : false}
              selectable={selectable}
              onSelectionChange={handleSelectionChange}
            />
          ))}
        </Masonry>
      </InfiniteScroll>

      {/* 이미지 뷰어 모달 */}
      <ImageViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        image={images[currentImageIndex] || null}
        images={images}
        currentIndex={currentImageIndex}
        onImageChange={handleImageChange}
        onOpenEditor={handleOpenEditor}
      />

      {/* 이미지 에디터 모달 (ImageViewerModal과 독립적으로 관리) */}
      {editorImageId && (
        <ImageEditorModal
          open={editorOpen}
          onClose={handleCloseEditor}
          imageId={editorImageId}
          onSaved={handleCloseEditor}
        />
      )}
    </Box>
  );
};

export default ImageMasonry;

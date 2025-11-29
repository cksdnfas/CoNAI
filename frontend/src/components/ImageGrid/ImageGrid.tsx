import React, { useState, useEffect, useCallback } from 'react';
import {
  Grid,
  Box,
  Typography,
  Pagination,
  Skeleton,
  FormControlLabel,
  Checkbox,
  Stack,
  Divider,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord, PageSize, ImageSearchParams } from '../../types/image';
import ImageCard from '../ImageCard/ImageCard';
import PageSizeSelector from '../PageSizeSelector/PageSizeSelector';
import ImageViewerModal from '../ImageViewerModal';
import { ImageEditorModal } from '../ImageEditorModal';
import { imageApi, groupApi } from '../../services/api';
import './ImageGrid.css';

// ✅ id 기반으로 변경 (중복 이미지 개별 선택)
export interface ImageGridProps {
  images: ImageRecord[];
  loading?: boolean;
  selectable?: boolean;
  selectedIds?: number[];  // ✅ image_files.id[]
  onSelectionChange?: (selectedIds: number[]) => void;
  pageSize?: PageSize;
  onPageSizeChange?: (size: PageSize) => void;
  currentPage?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onImageDelete?: (compositeHash: string) => void;  // composite_hash (메타데이터 작업용)
  showCollectionType?: boolean;
  currentGroupId?: number;
  searchParams?: ImageSearchParams;
  allImageIds?: number[]; // ✅ 외부에서 전달된 전체 image_files.id 목록 (우선순위)
}

const ImageGrid: React.FC<ImageGridProps> = ({
  images = [],
  loading = false,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  pageSize = 25,
  onPageSizeChange,
  currentPage = 1,
  totalPages = 1,
  total = 0,
  onPageChange,
  onImageDelete,
  showCollectionType = false,
  currentGroupId,
  searchParams,
  allImageIds: externalAllImageIds,
}) => {
  const { t } = useTranslation(['common', 'gallery']);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [lastClickedIndex, setLastClickedIndex] = useState<number>(-1);
  const [internalAllImageIds, setInternalAllImageIds] = useState<number[]>([]);  // ✅ image_files.id[]

  // 이미지 에디터 모달 상태 (ImageViewerModal과 독립적으로 관리)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorImageId, setEditorImageId] = useState<number | null>(null);

  // images가 undefined일 경우 방어
  const safeImages = images || [];

  // 외부에서 전달된 ID 목록이 있으면 우선 사용, 없으면 내부적으로 조회
  const allImageIds = externalAllImageIds || internalAllImageIds;

  // ✅ 그룹/검색 컨텍스트에서 전체 image_files.id 목록 조회
  useEffect(() => {
    // 외부에서 이미 전달된 경우 조회하지 않음
    if (externalAllImageIds && externalAllImageIds.length > 0) {
      return;
    }

    const fetchAllImageIds = async () => {
      try{
        if (currentGroupId) {
          // 그룹 모드: 그룹 전체 image_files.id 조회
          const result = await groupApi.getImageIdsForGroup(currentGroupId);
          if (result.success && result.data) {
            setInternalAllImageIds(result.data.ids);
          }
        } else if (searchParams) {
          // 검색 모드: 검색 결과 전체 image_files.id 조회
          const result = await imageApi.searchImageIds(searchParams);
          if (result.success && result.data) {
            setInternalAllImageIds(result.data.ids);
          }
        } else {
          // 전체 모드: ID 목록 없음 (기존 방식 사용)
          setInternalAllImageIds([]);
        }
      } catch (error) {
        console.error('Failed to fetch all image IDs:', error);
        setInternalAllImageIds([]);
      }
    };

    fetchAllImageIds();
  }, [currentGroupId, searchParams, externalAllImageIds]);

  // ✅ id 기반으로 변경 (중복 이미지 개별 선택)
  const handleSelectionChange = (id: number, event?: React.MouseEvent) => {
    if (!onSelectionChange) return;

    const imageIndex = safeImages.findIndex(img => img.id === id);

    // Ctrl/Cmd + Click: 토글 선택
    if (event && (event.ctrlKey || event.metaKey)) {
      const newSelectedIds = selectedIds.includes(id)
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
      const rangeIds = safeImages.slice(start, end + 1)
        .map(img => img.id)
        .filter((id): id is number => id !== undefined && id !== null);
      const newSelectedIds = Array.from(new Set([...selectedIds, ...rangeIds]));
      onSelectionChange(newSelectedIds);
      return;
    }

    // 일반 클릭: 토글 선택
    const newSelectedIds = selectedIds.includes(id)
      ? selectedIds.filter(selectedId => selectedId !== id)
        : [...selectedIds, id];
    onSelectionChange(newSelectedIds);
    setLastClickedIndex(imageIndex);
  };

  const handleSelectAll = (checked: boolean) => {
    if (!onSelectionChange) return;

    if (checked) {
      const allIds = safeImages
        .map(image => image.id)
        .filter((id): id is number => id !== undefined && id !== null);
      onSelectionChange(allIds);
    } else {
      onSelectionChange([]);
    }
  };

  // ✅ ID가 있는 이미지만 선택 가능하므로, 선택 가능한 이미지 개수 계산
  const selectableImagesCount = safeImages.filter(img => img.id !== undefined && img.id !== null).length;
  const isAllSelected = selectableImagesCount > 0 && selectedIds.length === selectableImagesCount;
  const isIndeterminate = selectedIds.length > 0 && selectedIds.length < selectableImagesCount;

  const handleImageClick = (imageIndex: number) => {
    setCurrentImageIndex(imageIndex);
    setViewerOpen(true);
  };

  const handleImageChange = (newIndex: number) => {
    setCurrentImageIndex(newIndex);
  };

  // 컨테이너 클릭 핸들러 (빈 공간 클릭 시 선택 해제)
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isImageCard = target.closest('.MuiCard-root');
    const isCheckbox = target.closest('.image-card-actions');
    const isBulkActionBar = target.closest('.no-drag-select');
    const isPagination = target.closest('.MuiPagination-root');

    // 빈 공간 클릭인 경우에만 선택 해제
    if (!isImageCard && !isCheckbox && !isBulkActionBar && !isPagination && onSelectionChange && selectedIds.length > 0) {
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
        const allIds = safeImages
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
  }, [selectable, onSelectionChange, safeImages]);

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

  if (loading) {
    return (
      <Box>
        <Grid container spacing={2}>
          {Array.from({ length: pageSize }, (_, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 2 }} key={index}>
              <Skeleton variant="rectangular" height={200} />
              <Box sx={{ pt: 0.5 }}>
                <Skeleton />
                <Skeleton width="60%" />
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  if (safeImages.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          {t('gallery:status.noImages')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('gallery:emptyState.uploadOrSearch')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      onClick={handleContainerClick}
      sx={{ position: 'relative' }}
    >
      {/* 컨트롤 바 */}
      <Box sx={{ mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={isAllSelected}
                  indeterminate={isIndeterminate}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  disabled={!selectable}
                />
              }
              label={t('gallery:selection.selectAllWithCount', {
                selected: selectedIds.length,
                total: safeImages.length
              })}
            />
            <Typography variant="body2" color="text.secondary">
              {t('gallery:totalImages', { count: total })}
            </Typography>
          </Box>

          {onPageSizeChange && (
            <PageSizeSelector
              value={pageSize}
              onChange={onPageSizeChange}
              disabled={loading}
            />
          )}
        </Stack>

        <Divider sx={{ mt: 2 }} />
      </Box>

      {/* 이미지 그리드 */}
      <Grid container spacing={3}>
        {safeImages.map((image, index) => (
          <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2, xl: 1.5 }} key={image.id ? `id-${image.id}` : `hash-${image.composite_hash || 'processing'}-${index}`}>
            <ImageCard
              image={image}
              selected={image.id ? selectedIds.includes(image.id) : false}
              selectable={selectable}
              onSelectionChange={(id, event) => handleSelectionChange(id, event)}
              onDelete={onImageDelete}
              onImageClick={() => handleImageClick(index)}
              showCollectionType={showCollectionType}
              currentGroupId={currentGroupId}
            />
          </Grid>
        ))}
      </Grid>

      {/* 페이지네이션 */}
      {totalPages > 1 && onPageChange && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <Pagination
            count={totalPages}
            page={currentPage}
            onChange={(_, page) => onPageChange(page)}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
          />
        </Box>
      )}

      {/* 이미지 뷰어 모달 */}
      <ImageViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        image={safeImages[currentImageIndex] || null}
        images={safeImages}
        currentIndex={currentImageIndex}
        onImageChange={handleImageChange}
        onImageDeleted={onImageDelete}
        searchContext={searchParams ? 'search' : currentGroupId ? 'group' : 'all'}
        searchParams={searchParams}
        groupId={currentGroupId}
        allImageIds={allImageIds}
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

export default ImageGrid;